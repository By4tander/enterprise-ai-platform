"""部门技能 Schema"""
from pydantic import BaseModel, Field
from datetime import datetime


class SkillCreate(BaseModel):
    skill_name: str = Field(..., min_length=1, max_length=256)
    content_prompt: str
    department_id: str
    derived_from_project_id: str | None = None
    category: str | None = None


class SkillOut(BaseModel):
    id: str
    department_id: str
    skill_name: str
    content_prompt: str
    derived_from_project_id: str | None = None
    derived_from_project_name: str | None = None
    category: str | None = None
    is_approved: bool
    usage_count: int
    rating: float
    auto_inject: bool
    created_at: datetime
    # Phase 5 来源追溯
    created_by_user_id: str | None = None
    created_by_username: str | None = None
    import_source: str | None = None
    original_source_url: str | None = None
    metadata_json: str | None = None

    class Config:
        from_attributes = True


class SkillUpdate(BaseModel):
    skill_name: str | None = None
    content_prompt: str | None = None
    category: str | None = None
    is_approved: bool | None = None
    auto_inject: bool | None = None
    rating: float | None = None


class SkillDistillationResult(BaseModel):
    skills_generated: list[SkillOut]
    summary: str
