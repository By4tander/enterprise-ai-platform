"""
认证相关 Pydantic 模型
"""
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)
    display_name: str = Field(default="", max_length=128)
    email: str | None = None
    department_id: str | None = None  # 注册时可选绑定部门


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str
    department_id: str | None = None
    department_name: str | None = None
