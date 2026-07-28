"""消息 Schema"""
from pydantic import BaseModel
from datetime import datetime
from typing import Any


class MessageOut(BaseModel):
    id: str
    project_id: str
    sender_type: str
    sender_name: str
    content: str
    thinking_content: str | None = None
    attachments: list[dict[str, Any]] | None = None
    timestamp: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_model(cls, msg):
        """从 ORM 模型构建，同时解析 attachments_json"""
        import json
        attachments = None
        if hasattr(msg, 'attachments_json') and msg.attachments_json:
            try:
                attachments = json.loads(msg.attachments_json)
            except (json.JSONDecodeError, TypeError):
                attachments = None
        return cls(
            id=msg.id,
            project_id=msg.project_id,
            sender_type=msg.sender_type.value if hasattr(msg.sender_type, 'value') else msg.sender_type,
            sender_name=msg.sender_name,
            content=msg.content,
            thinking_content=msg.thinking_content,
            attachments=attachments,
            timestamp=msg.timestamp,
        )


class ChatRequest(BaseModel):
    """前端发送聊天请求"""
    project_id: str
    content: str
    show_thinking: bool = True
    file_paths: list[str] | None = None
    attachments: list[dict[str, Any]] | None = None  # 附件元数据
