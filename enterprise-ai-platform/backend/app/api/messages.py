"""
消息记录 API 路由
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.message import Message
from app.middleware.auth import get_current_user
from app.schemas.message import MessageOut

router = APIRouter(prefix="/api/messages", tags=["消息记录"])


@router.get("/{project_id}", response_model=list[MessageOut])
async def get_messages(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 100,
    offset: int = 0,
):
    """获取项目对话历史"""
    # 验证项目存在
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    result = await db.execute(
        select(Message)
        .where(Message.project_id == project_id)
        .order_by(Message.timestamp.asc())
        .offset(offset)
        .limit(limit)
    )
    messages = result.scalars().all()

    return [
        MessageOut(
            id=m.id,
            project_id=m.project_id,
            sender_type=m.sender_type.value,
            sender_name=m.sender_name,
            content=m.content,
            thinking_content=m.thinking_content,
            timestamp=m.timestamp,
        )
        for m in messages
    ]
