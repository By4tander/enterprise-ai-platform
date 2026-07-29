"""
项目文件夹模型 — 用于项目归类与集群记忆
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
from app.database import Base


class ProjectFolder(Base):
    __tablename__ = "project_folders"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#6366f1")  # Hex color
    department_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    # 关联
    projects: Mapped[list["Project"]] = relationship(
        "Project", back_populates="folder", lazy="selectin"
    )

    def __repr__(self):
        return f"<ProjectFolder {self.name}>"
