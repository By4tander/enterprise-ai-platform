"""
认证 API 路由
提供用户注册、登录、Token 刷新等功能
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.department import Department
from app.middleware.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserOut

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    """用户注册"""
    # 检查用户名是否已存在
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名已存在",
        )

    # 如果提供了 department_id，验证部门存在
    if req.department_id:
        dept = await db.get(Department, req.department_id)
        if dept is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        display_name=req.display_name or req.username,
        email=req.email,
        department_id=req.department_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 重新加载用户（含部门关联）
    result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.id == user.id)
    )
    user = result.scalar_one()

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role.value,
        department_id=user.department_id,
        department_name=user.department.name if user.department else None,
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    """用户登录"""
    result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.username == req.username)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role.value,
        department_id=user.department_id,
        department_name=user.department.name if user.department else None,
    )


@router.get("/me", response_model=UserOut)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    """获取当前登录用户信息"""
    return current_user


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(current_user: Annotated[User, Depends(get_current_user)]):
    """刷新 Token"""
    token = create_access_token({
        "sub": current_user.id,
        "username": current_user.username,
        "role": current_user.role.value,
    })
    return TokenResponse(
        access_token=token,
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role.value,
        department_id=current_user.department_id,
        department_name=current_user.department.name if current_user.department else None,
    )
