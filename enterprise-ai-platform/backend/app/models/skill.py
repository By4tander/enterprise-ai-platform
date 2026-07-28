"""
部门技能/记忆模型 — 含来源追溯字段 + 全局/部门分层

存储从结案项目中提炼或外部导入的标准化 Prompt、SOP、模板等。
scope="global" 代表全公司共享的核心能力，department_id 为 None。
scope="department" 代表各部门私有的特定技能。
"""
import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean, Integer, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
from app.database import Base


class SkillScope(str, enum.Enum):
    GLOBAL = "global"
    DEPARTMENT = "department"

    @classmethod
    def _missing_(cls, value):
        """Handle lowercase values from DB"""
        for member in cls:
            if member.value == value.lower() if isinstance(value, str) else False:
                return member
        return None


class DepartmentSkill(Base):
    __tablename__ = "department_skills"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    # ── 分层作用域 ──
    scope: Mapped[str] = mapped_column(
        String(16), default="department", nullable=False, index=True
    )
    department_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    skill_name: Mapped[str] = mapped_column(String(256), nullable=False)
    content_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    derived_from_project_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    auto_inject: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    # ── 来源追溯字段 ──
    created_by_user_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    import_source: Mapped[str | None] = mapped_column(String(32), nullable=True, default="manual")
    original_source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 关联
    department: Mapped["Department | None"] = relationship(
        "Department", back_populates="skills", lazy="selectin"
    )
    derived_from_project: Mapped["Project | None"] = relationship(
        "Project", lazy="selectin"
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User", lazy="selectin", foreign_keys=[created_by_user_id]
    )

    def __repr__(self):
        return (f"<DepartmentSkill {self.skill_name} "
                f"scope={self.scope.value} approved={self.is_approved} source={self.import_source}>")
