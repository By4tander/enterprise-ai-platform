"""消息 Schema"""
from pydantic import BaseModel
from datetime import datetime


class MessageOut(BaseModel):
    id: str
    project_id: str
    sender_type: str
    sender_name: str
    content: str
    thinking_content: str | None = None
    timestamp: datetime

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    """前端发送聊天请求"""
    project_id: str
    content: str
    show_thinking: bool = True
    file_paths: list[str] | None = None
