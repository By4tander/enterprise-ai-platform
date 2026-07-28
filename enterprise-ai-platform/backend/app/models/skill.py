"""
部门技能/记忆模型 — 含来源追溯字段

存储从结案项目中提炼或外部导入的标准化 Prompt、SOP、模板等。
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean, Integer, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.sqlite import CHAR
from app.database import Base


class DepartmentSkill(Base):
    __tablename__ = "department_skills"

    id: Mapped[str] = mapped_column(
        CHAR(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    department_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_name: Mapped[str] = mapped_column(String(256), nullable=False)
    content_prompt: Mapped[str] = mapped_column(Text, nullable=False)
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

    # ── Phase 5: 来源追溯字段 ──
    # 创建者
    created_by_user_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # 导入来源: distillation | manual | import | import_zip | skill_hub
    import_source: Mapped[str | None] = mapped_column(String(32), nullable=True, default="manual")
    # 外部原始 URL（从 Skill Hub 等来源导入时记录）
    original_source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # 额外元数据 JSON（格式版本、原始文件名、适配的 skill 引擎等）
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 关联
    department: Mapped["Department"] = relationship(
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
                f"approved={self.is_approved} source={self.import_source}>")
