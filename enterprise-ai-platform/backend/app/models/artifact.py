"""
项目产出物（Artifact）模型
存储项目过程中由 Agent 生成并经用户确认的核心文件
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
from app.database import Base


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 文件类型标签：markdown, python, yaml, prompt, image_prompt 等
    file_type: Mapped[str] = mapped_column(String(64), nullable=False, default="markdown")
    # 在项目中的路径（如：剧本大纲/第一幕.md）
    artifact_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    # 关联
    project: Mapped["Project"] = relationship(
        "Project", back_populates="artifacts"
    )

    def __repr__(self):
        return f"<Artifact {self.title} type={self.file_type}>"
