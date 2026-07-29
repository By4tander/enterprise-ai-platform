"""消息 Schema"""
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Any


class MessageOut(BaseModel):
    id: str
    project_id: str
    sender_type: str
    sender_name: str
    content: str
    thinking_content: str | None = None
    attachments: list[dict[str, Any]] | None = None
    tokens_used: int = 0
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
        # 确保 timestamp 包含 UTC 时区信息
        ts = msg.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        return cls(
            id=msg.id,
            project_id=msg.project_id,
            sender_type=msg.sender_type.value if hasattr(msg.sender_type, 'value') else msg.sender_type,
            sender_name=msg.sender_name,
            content=msg.content,
            thinking_content=msg.thinking_content,
            attachments=attachments,
            tokens_used=getattr(msg, 'tokens_used', 0) or 0,
            timestamp=ts,
        )


class ChatRequest(BaseModel):
    """前端发送聊天请求"""
    project_id: str
    content: str
    show_thinking: bool = True
    file_paths: list[str] | None = None
    attachments: list[dict[str, Any]] | None = None  # 附件元数据
