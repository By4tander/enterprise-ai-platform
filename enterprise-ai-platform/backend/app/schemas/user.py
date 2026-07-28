"""
用户相关 Pydantic 模型
"""
from pydantic import BaseModel
from datetime import datetime


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    department_id: str | None
    role: str
    avatar_url: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    department_id: str | None = None
    role: str | None = None
