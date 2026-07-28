"""
用户模型
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
import enum
from app.database import Base


class UserRole(str, enum.Enum):
    """用户角色枚举"""
    SUPER_ADMIN = "super_admin"    # 全平台管理员
    DEPT_ADMIN = "dept_admin"      # 部门管理员
    MEMBER = "member"              # 普通成员


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(256), nullable=True)
    department_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole), default=UserRole.MEMBER, nullable=False
    )
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    # 关联
    department: Mapped["Department | None"] = relationship(
        "Department", back_populates="users", lazy="selectin"
    )
    projects: Mapped[list["Project"]] = relationship(
        "Project", back_populates="owner", lazy="selectin"
    )

    def __repr__(self):
        return f"<User {self.username} role={self.role.value}>"

