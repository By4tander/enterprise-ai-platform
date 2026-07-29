"""项目 Schema"""
from pydantic import BaseModel, Field
from datetime import datetime


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    description: str | None = None
    department_id: str
    system_prompt_override: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None
    department_id: str
    department_name: str = ""
    owner_id: str
    owner_name: str = ""
    folder_id: str | None = None
    status: str
    created_at: datetime
    archived_at: datetime | None = None
    message_count: int = 0
    artifact_count: int = 0

    class Config:
        from_attributes = True


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt_override: str | None = None
    status: str | None = None  # 用于恢复归档项目为 active


class ProjectArchiveRequest(BaseModel):
    """结案归档请求"""
    generate_skills: bool = True  # 是否自动生成提炼技能
