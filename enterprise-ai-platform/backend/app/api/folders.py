"""
项目文件夹管理 API
"""
import logging
from typing import Annotated
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.project_folder import ProjectFolder
from app.models.department import Department
from app.middleware.auth import get_current_user
from app.services.folder_service import FolderService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/folders", tags=["项目文件夹"])


class FolderCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    department_id: str


class FolderUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class MoveProject(BaseModel):
    folder_id: str | None = None  # None = move out of folder


class FolderOut(BaseModel):
    id: str
    name: str
    color: str
    department_id: str
    position: int
    project_count: int = 0

    class Config:
        from_attributes = True


class ClusterMemoryRequest(BaseModel):
    """触发集群记忆归档"""
    pass


@router.get("/", response_model=list[FolderOut])
async def list_folders(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    department_id: str | None = None,
):
    """列出文件夹"""
    query = select(ProjectFolder)
    if current_user.role == UserRole.SUPER_ADMIN:
        if department_id:
            query = query.where(ProjectFolder.department_id == department_id)
    else:
        dept = department_id or current_user.department_id
        if dept:
            query = query.where(ProjectFolder.department_id == dept)

    query = query.order_by(ProjectFolder.position.asc())
    result = await db.execute(query)
    folders = result.scalars().all()

    out = []
    for f in folders:
        count_result = await db.execute(
            select(Project).where(Project.folder_id == f.id, Project.status == "active")
        )
        count = len(count_result.scalars().all())
        out.append(FolderOut(
            id=f.id, name=f.name, color=f.color,
            department_id=f.department_id, position=f.position,
            project_count=count,
        ))
    return out


@router.post("/", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    req: FolderCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """创建文件夹"""
    # 权限
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="成员无权创建文件夹")

    dept = await db.get(Department, req.department_id)
    if dept is None:
        raise HTTPException(status_code=400, detail="部门不存在")

    # 获取当前最大 position
    result = await db.execute(
        select(ProjectFolder)
        .where(ProjectFolder.department_id == req.department_id)
        .order_by(ProjectFolder.position.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    next_pos = (last.position + 1) if last else 0

    folder = ProjectFolder(
        name=req.name,
        color=req.color,
        department_id=req.department_id,
        position=next_pos,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)

    # 创建文件夹存储目录
    FolderService().ensure_folder_dir(folder.id)

    return FolderOut(
        id=folder.id, name=folder.name, color=folder.color,
        department_id=folder.department_id, position=folder.position,
        project_count=0,
    )


@router.put("/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: str,
    req: FolderUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """更新文件夹（仅管理员）"""
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=403, detail="成员无权修改文件夹")

    folder = await db.get(ProjectFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    if req.name is not None:
        folder.name = req.name
    if req.color is not None:
        folder.color = req.color
    await db.commit()
    await db.refresh(folder)

    return FolderOut(
        id=folder.id, name=folder.name, color=folder.color,
        department_id=folder.department_id, position=folder.position,
    )


@router.delete("/{folder_id}")
async def delete_folder(
    folder_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """删除文件夹（仅管理员）"""
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=403, detail="成员无权删除文件夹")

    folder = await db.get(ProjectFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 将文件夹内所有项目的 folder_id 置空
    await db.execute(
        update(Project).where(Project.folder_id == folder_id).values(folder_id=None)
    )

    # 清理文件夹共享技能目录的软链接
    svc = FolderService()
    projects_result = await db.execute(select(Project).where(Project.folder_id == folder_id))
    for proj in projects_result.scalars().all():
        svc.remove_symlink(proj.id, folder_id)

    await db.delete(folder)
    await db.commit()

    return {"success": True, "message": "文件夹已删除"}


@router.post("/{folder_id}/move-project")
async def move_project_to_folder(
    folder_id: str,
    body: MoveProject,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    project_id: str | None = None,
):
    """将项目移入/移出文件夹"""
    # 从 query param 或 body 获取 project_id
    pid = project_id
    if not pid:
        raise HTTPException(status_code=400, detail="缺少 project_id")

    project = await db.get(Project, pid)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    old_folder_id = project.folder_id
    svc = FolderService()

    if body.folder_id:
        # 移入文件夹
        folder = await db.get(ProjectFolder, body.folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="目标文件夹不存在")

        project.folder_id = body.folder_id

        # 创建共享技能目录 + 软链接
        svc.ensure_folder_dir(body.folder_id)
        svc.mount_shared_skills(pid, body.folder_id)
    else:
        # 移出文件夹
        project.folder_id = None
        if old_folder_id:
            svc.remove_symlink(pid, old_folder_id)

    await db.commit()
    return {"success": True, "project_id": pid, "folder_id": body.folder_id}


@router.post("/{folder_id}/cluster-memory")
async def trigger_cluster_memory(
    folder_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """触发文件夹集群记忆归档（调用 Hermes CLI 提炼跨项目技能）"""
    folder = await db.get(ProjectFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 权限检查
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=403, detail="成员无权触发集群记忆")

    from app.services.cluster_memory_service import ClusterMemoryService
    svc = ClusterMemoryService()

    try:
        result = await svc.distill_folder(folder_id, db)
        return {
            "success": True,
            "skills_generated": result.get("skills", []),
            "message": f"集群记忆归档完成，生成 {len(result.get('skills', []))} 个共享技能",
        }
    except Exception as e:
        logger.error(f"集群记忆归档失败: {e}")
        raise HTTPException(status_code=500, detail=f"归档失败: {str(e)}")
