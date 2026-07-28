"""
项目管理 API 路由
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.department import Department
from app.models.project import Project, ProjectStatus
from app.models.message import Message
from app.models.artifact import Artifact
from app.middleware.auth import get_current_user
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate, ProjectArchiveRequest

router = APIRouter(prefix="/api/projects", tags=["项目管理"])


@router.get("/", response_model=list[ProjectOut])
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    department_id: str | None = Query(None, description="按部门筛选"),
    status: str | None = Query(None, description="按状态筛选: active / archived"),
):
    """获取项目列表"""
    query = select(Project).options(
        selectinload(Project.department),
        selectinload(Project.owner),
    )

    # 部门权限逻辑：
    # - Super Admin: department_id 参数控制筛选，无参数则看全部
    # - Dept Admin: department_id 参数（仅可看自己部门），否则默认自己部门
    # - Member: 强制只看自己部门，忽略 department_id 参数
    if current_user.role == UserRole.SUPER_ADMIN:
        if department_id:
            query = query.where(Project.department_id == department_id)
    elif current_user.role == UserRole.DEPT_ADMIN:
        effective_dept = department_id if department_id == current_user.department_id else current_user.department_id
        if effective_dept:
            query = query.where(Project.department_id == effective_dept)
    else:  # MEMBER
        if current_user.department_id:
            query = query.where(Project.department_id == current_user.department_id)
        else:
            query = query.where(Project.owner_id == current_user.id)

    if status:
        query = query.where(Project.status == status)

    query = query.order_by(Project.created_at.desc())
    result = await db.execute(query)
    projects = result.scalars().all()

    out_list = []
    for proj in projects:
        msg_count = await db.execute(
            select(func.count(Message.id)).where(Message.project_id == proj.id)
        )
        art_count = await db.execute(
            select(func.count(Artifact.id)).where(Artifact.project_id == proj.id)
        )
        out_list.append(ProjectOut(
            id=proj.id,
            name=proj.name,
            description=proj.description,
            department_id=proj.department_id,
            department_name=proj.department.name if proj.department else "",
            owner_id=proj.owner_id,
            owner_name=proj.owner.display_name if proj.owner else "",
            status=proj.status.value,
            created_at=proj.created_at,
            archived_at=proj.archived_at,
            message_count=msg_count.scalar() or 0,
            artifact_count=art_count.scalar() or 0,
        ))
    return out_list


@router.post("/", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    req: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """创建新项目"""
    # 验证部门存在
    dept = await db.get(Department, req.department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")

    # 普通成员只能在自己部门创建项目
    if current_user.role == UserRole.MEMBER and current_user.department_id != req.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能在所属部门创建项目")

    project = Project(
        name=req.name,
        description=req.description,
        department_id=req.department_id,
        owner_id=current_user.id,
        system_prompt_override=req.system_prompt_override,
    )
    db.add(project)
    await db.commit()

    # 重新加载关联
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.department), selectinload(Project.owner))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        department_id=project.department_id,
        department_name=project.department.name,
        owner_id=project.owner_id,
        owner_name=project.owner.display_name,
        status=project.status.value,
        created_at=project.created_at,
        archived_at=project.archived_at,
    )


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取项目详情"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.department), selectinload(Project.owner))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    # 权限检查：只能访问本部门项目（Super Admin除外）
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.department_id != project.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该项目")

    msg_count = await db.execute(
        select(func.count(Message.id)).where(Message.project_id == project.id)
    )
    art_count = await db.execute(
        select(func.count(Artifact.id)).where(Artifact.project_id == project.id)
    )

    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        department_id=project.department_id,
        department_name=project.department.name,
        owner_id=project.owner_id,
        owner_name=project.owner.display_name,
        status=project.status.value,
        created_at=project.created_at,
        archived_at=project.archived_at,
        message_count=msg_count.scalar() or 0,
        artifact_count=art_count.scalar() or 0,
    )


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    req: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """更新项目信息"""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    if req.name is not None:
        project.name = req.name
    if req.description is not None:
        project.description = req.description
    if req.system_prompt_override is not None:
        project.system_prompt_override = req.system_prompt_override

    await db.commit()
    await db.refresh(project)

    result = await db.execute(
        select(Project)
        .options(selectinload(Project.department), selectinload(Project.owner))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        department_id=project.department_id,
        department_name=project.department.name,
        owner_id=project.owner_id,
        owner_name=project.owner.display_name,
        status=project.status.value,
        created_at=project.created_at,
        archived_at=project.archived_at,
    )


@router.post("/{project_id}/archive", response_model=ProjectOut)
async def archive_project(
    project_id: str,
    req: ProjectArchiveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """结案归档项目"""
    from datetime import datetime, timezone

    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    project.status = ProjectStatus.ARCHIVED
    project.archived_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)

    # Phase 4: 触发技能提炼流水线
    skills_generated: list = []
    if req.generate_skills:
        try:
            from app.services.distillation import DistillationService
            distiller = DistillationService()
            result = await distiller.distill_project(project_id, db)
            skills_generated = [s.skill_name for s in result.skills_generated]
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"技能提炼失败（不影响归档）: {e}")

    # 重新加载关联
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.department), selectinload(Project.owner))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        department_id=project.department_id,
        department_name=project.department.name if project.department else "",
        owner_id=project.owner_id,
        owner_name=project.owner.display_name if project.owner else "",
        status=project.status.value,
        created_at=project.created_at,
        archived_at=project.archived_at,
    )
