"""
部门模型
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    # 关联
    users: Mapped[list["User"]] = relationship(
        "User", back_populates="department", lazy="selectin"
    )
    projects: Mapped[list["Project"]] = relationship(
        "Project", back_populates="department", lazy="selectin"
    )
    skills: Mapped[list["DepartmentSkill"]] = relationship(
        "DepartmentSkill", back_populates="department", lazy="selectin"
    )

    def __repr__(self):
        return f"<Department {self.name}>"
