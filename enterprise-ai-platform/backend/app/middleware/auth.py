"""
JWT 认证中间件
提供 token 生成、验证、以及 FastAPI 依赖注入
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole

# ---- 密码哈希 ----
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ---- HTTP Bearer 认证方案 ----
security_scheme = HTTPBearer(auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)


def hash_password(password: str) -> str:
    """哈希密码"""
    return pwd_context.hash(password)


def create_access_token(data: dict) -> str:
    """创建 JWT Access Token"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """解码 JWT Token，返回 payload 或 None"""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    FastAPI 依赖：从 Bearer Token 获取当前登录用户
    若未提供 Token 或无效则抛出 401
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证凭证",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="认证凭证无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 格式错误")

    result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    return user


async def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    """可选认证：不强制要求 Token"""
    if credentials is None:
        return None
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        return None
    user_id = payload.get("sub")
    if user_id is None:
        return None
    result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


def require_role(*roles: UserRole):
    """
    权限检查工厂函数：限制接口只能由特定角色访问
    用法: @app.get("/admin", dependencies=[Depends(require_role(UserRole.SUPER_ADMIN))])
    """

    async def role_checker(current_user: Annotated[User, Depends(get_current_user)]):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要角色: {[r.value for r in roles]}",
            )
        return current_user

    return role_checker


def require_dept_member():
    """
    检查当前用户属于目标部门（通过路径参数 department_id）
    Super Admin 可通过所有检查
    """

    async def checker(
        department_id: str,
        current_user: Annotated[User, Depends(get_current_user)],
    ):
        if current_user.role == UserRole.SUPER_ADMIN:
            return current_user
        if current_user.department_id != department_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您不属于该部门，无法访问此资源",
            )
        return current_user

    return checker
