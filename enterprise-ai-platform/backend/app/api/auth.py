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
        display_name=user.display_name or user.username,
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


@router.get("/users")
async def list_users(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取所有用户列表（仅管理员）"""
    if current_user.role.value not in ('super_admin', 'dept_admin'):
        raise HTTPException(status_code=403, detail="权限不足")
    result = await db.execute(select(User).options(selectinload(User.department)))
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "role": u.role.value,
            "department_id": u.department_id,
            "department_name": u.department.name if u.department else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    data: dict,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新用户信息（名称/密码）"""
    # Only self or admin can update
    if current_user.id != user_id and current_user.role.value not in ('super_admin', 'dept_admin'):
        raise HTTPException(status_code=403, detail="权限不足")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    # Update username (check uniqueness)
    if "username" in data and data["username"] != target.username:
        existing = await db.execute(select(User).where(User.username == data["username"]))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="用户名已存在")
        target.username = data["username"]

    # Update display name
    if "display_name" in data:
        target.display_name = data["display_name"]

    # Change password (self requires current_password)
    if "password" in data:
        if current_user.id == user_id:
            current_pwd = data.get("current_password", "")
            if not verify_password(current_pwd, target.password_hash):
                raise HTTPException(status_code=400, detail="当前密码错误")
        target.password_hash = hash_password(data["password"])

    await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除用户（仅超级管理员）"""
    if current_user.role.value != 'super_admin':
        raise HTTPException(status_code=403, detail="仅超级管理员可删除用户")
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    await db.delete(target)
    await db.commit()
    return {"ok": True}
