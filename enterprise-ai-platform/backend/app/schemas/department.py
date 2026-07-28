"""部门 Schema"""
from pydantic import BaseModel
from datetime import datetime


class DepartmentCreate(BaseModel):
    name: str
    description: str | None = None


class DepartmentOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    user_count: int = 0
    project_count: int = 0

    class Config:
        from_attributes = True


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
