"""产出物 Schema"""
from pydantic import BaseModel, Field
from datetime import datetime


class ArtifactCreate(BaseModel):
    project_id: str
    title: str = Field(..., min_length=1, max_length=256)
    content: str
    file_type: str = "markdown"
    artifact_path: str | None = None


class ArtifactOut(BaseModel):
    id: str
    project_id: str
    title: str
    content: str
    file_type: str
    artifact_path: str | None = None
    file_size: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class ArtifactUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    file_type: str | None = None
    artifact_path: str | None = None
