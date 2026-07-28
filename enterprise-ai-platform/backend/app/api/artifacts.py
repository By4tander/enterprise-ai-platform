"""
项目产出物（Artifact）API 路由
"""
import os as _os
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.artifact import Artifact
from app.middleware.auth import get_current_user
from app.schemas.artifact import ArtifactCreate, ArtifactOut, ArtifactUpdate
from app.services.session_isolation import SessionIsolationEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/artifacts", tags=["项目产出物"])


@router.get("/project/{project_id}", response_model=list[ArtifactOut])
async def list_artifacts(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取项目的所有产出物"""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    result = await db.execute(
        select(Artifact)
        .where(Artifact.project_id == project_id)
        .order_by(Artifact.created_at.desc())
    )
    artifacts = result.scalars().all()

    return [
        ArtifactOut(
            id=a.id,
            project_id=a.project_id,
            title=a.title,
            content=a.content,
            file_type=a.file_type,
            artifact_path=a.artifact_path,
            created_at=a.created_at,
        )
        for a in artifacts
    ]


@router.post("/", response_model=ArtifactOut, status_code=status.HTTP_201_CREATED)
async def create_artifact(
    req: ArtifactCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """创建/保存产出物"""
    project = await db.get(Project, req.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目不存在")

    artifact = Artifact(
        project_id=req.project_id,
        title=req.title,
        content=req.content,
        file_type=req.file_type,
        artifact_path=req.artifact_path,
    )
    db.add(artifact)
    await db.commit()
    await db.refresh(artifact)

    # Return the last artifact + add scan/download endpoints below
    pass
# (endpoints continue below)


# ── 历史扫描 ──
@router.post("/scan/{project_id}")
async def scan_project_artifacts(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """扫描项目沙盒，为未入库的文件创建 artifact 记录"""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(project_id)
    if not sandbox.exists():
        return {"scanned": 0, "created": 0, "message": "项目沙盒为空"}

    existing_result = await db.execute(
        select(Artifact.artifact_path).where(Artifact.project_id == project_id)
    )
    existing_paths = {row[0] for row in existing_result if row[0]}

    created = 0
    for dirpath, dirnames, filenames in _os.walk(str(sandbox)):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for fn in filenames:
            if fn.startswith('.') or fn == '.DS_Store':
                continue
            fp = _os.path.join(dirpath, fn)
            rel = _os.path.relpath(fp, str(sandbox))
            if rel.startswith('attachments/'):
                continue
            if rel in existing_paths:
                continue
            ext = _os.path.splitext(fn)[1].lower()
            db.add(Artifact(
                project_id=project_id,
                title=fn,
                content="",
                file_type=ext.lstrip('.') or 'file',
                artifact_path=rel,
            ))
            created += 1
    await db.commit()
    return {"scanned": 0, "created": created, "message": f"已创建 {created} 个产出物记录"}


# ── 产出物文件服务 ──
@router.get("/file/{project_id}/{artifact_path:path}")
async def serve_artifact_file(
    project_id: str,
    artifact_path: str,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """提供产出物文件内容"""
    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(project_id)
    file_path = sandbox / artifact_path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(str(file_path))


@router.put("/{artifact_id}", response_model=ArtifactOut)
async def update_artifact(
    artifact_id: str,
    req: ArtifactUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """更新产出物"""
    artifact = await db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="产出物不存在")

    if req.title is not None:
        artifact.title = req.title
    if req.content is not None:
        artifact.content = req.content
    if req.file_type is not None:
        artifact.file_type = req.file_type
    if req.artifact_path is not None:
        artifact.artifact_path = req.artifact_path

    await db.commit()
    await db.refresh(artifact)

    return ArtifactOut(
        id=artifact.id,
        project_id=artifact.project_id,
        title=artifact.title,
        content=artifact.content,
        file_type=artifact.file_type,
        artifact_path=artifact.artifact_path,
        created_at=artifact.created_at,
    )
