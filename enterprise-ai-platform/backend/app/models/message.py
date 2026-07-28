"""
消息记录模型
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
import enum
from app.database import Base


class SenderType(str, enum.Enum):
    USER = "user"
    AGENT = "agent"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_type: Mapped[SenderType] = mapped_column(
        SAEnum(SenderType), nullable=False
    )
    # 发送者标识（用户 username 或 "hermes-agent"）
    sender_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # thinking 过程内容（Agent 思考链，折叠展示用）
    thinking_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 附件元数据（JSON 数组：[{filename, size, stored_path, content_type}]）
    attachments_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True
    )

    # 关联
    project: Mapped["Project"] = relationship(
        "Project", back_populates="messages"
    )

    def __repr__(self):
        return f"<Message {self.sender_type.value} at {self.timestamp}>"
