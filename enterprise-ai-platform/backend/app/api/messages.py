"""
消息记录 API 路由
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.message import Message
from app.middleware.auth import get_current_user
from app.schemas.message import MessageOut

router = APIRouter(prefix="/api/messages", tags=["消息记录"])


@router.get("/{project_id}")
async def get_messages(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 200,
    offset: int = 0,
):
    """
    获取项目对话历史。

    返回格式:
    {
      "messages": [...],
      "total": 总消息数,
      "has_more": 是否还有更早的消息,
      "showing": 本次返回的消息数
    }
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    count_result = await db.execute(
        select(func.count()).select_from(Message).where(Message.project_id == project_id)
    )
    total = count_result.scalar() or 0

    # 默认返回最新消息，跳过前面的
    effective_offset = max(0, total - limit) + offset

    result = await db.execute(
        select(Message)
        .where(Message.project_id == project_id)
        .order_by(Message.timestamp.asc())
        .offset(effective_offset)
        .limit(limit)
    )
    messages = result.scalars().all()

    return {
        "messages": [MessageOut.from_orm_model(m) for m in messages],
        "total": total,
        "has_more": effective_offset > 0,
        "showing": len(messages),
    }
