"""
项目模型
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
import enum
from app.database import Base


class ProjectStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    department_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    folder_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("project_folders.id", ondelete="SET NULL"), nullable=True
    )
    model_config_json: Mapped[str] = mapped_column(
        Text, nullable=False, default=""
    )
    status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(ProjectStatus), default=ProjectStatus.ACTIVE, nullable=False
    )
    system_prompt_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 关联
    department: Mapped["Department"] = relationship(
        "Department", back_populates="projects", lazy="selectin"
    )
    owner: Mapped["User"] = relationship(
        "User", back_populates="projects", lazy="selectin"
    )
    folder: Mapped["ProjectFolder | None"] = relationship(
        "ProjectFolder", back_populates="projects", lazy="selectin"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="project", lazy="selectin",
        cascade="all, delete-orphan"
    )
    artifacts: Mapped[list["Artifact"]] = relationship(
        "Artifact", back_populates="project", lazy="selectin",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Project {self.name} status={self.status.value}>"
