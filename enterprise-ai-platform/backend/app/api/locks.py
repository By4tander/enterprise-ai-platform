"""
项目协作锁定 API

实现冲突访问控制：
- 用户进入项目时自动锁定
- 其他用户进入同一项目时为只读模式
- 可以发送接管请求，当前编辑者同意后切换
- 管理员随时可以强制接管
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.middleware.auth import get_current_user

router = APIRouter(prefix="/api/locks", tags=["项目协作锁定"])

# ── 内存存储（轻量级，生产可迁移到 Redis） ──
# { project_id: { user_id, username, display_name, locked_at } }
_project_locks: dict[str, dict] = {}
# { request_id: { project_id, from_user, to_user_id, status, created_at } }
_transfer_requests: dict[str, dict] = {}


class LockAcquireRequest(BaseModel):
    project_id: str


class TransferRequest(BaseModel):
    project_id: str


class TransferResponse(BaseModel):
    request_id: str
    approved: bool


@router.get("/status/{project_id}")
async def get_lock_status(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取项目锁定状态"""
    lock = _project_locks.get(project_id)
    if lock:
        return {
            "locked": True,
            "editor_id": lock["user_id"],
            "editor_username": lock["username"],
            "editor_display_name": lock["display_name"],
            "locked_at": lock["locked_at"],
            "is_me": lock["user_id"] == current_user.id,
            "is_admin": current_user.role == UserRole.SUPER_ADMIN,
        }
    return {"locked": False, "is_me": False, "is_admin": current_user.role == UserRole.SUPER_ADMIN}


@router.post("/acquire")
async def acquire_lock(
    req: LockAcquireRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取项目编辑锁（进入项目时调用）"""
    project_id = req.project_id
    lock = _project_locks.get(project_id)

    # 管理员随时可以强制接管
    if current_user.role == UserRole.SUPER_ADMIN:
        _project_locks[project_id] = {
            "user_id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name,
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"acquired": True, "forced": lock is not None and lock["user_id"] != current_user.id}

    # 项目未锁定 → 直接获取
    if not lock:
        _project_locks[project_id] = {
            "user_id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name,
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"acquired": True, "forced": False}

    # 自己已锁定 → 续期
    if lock["user_id"] == current_user.id:
        lock["locked_at"] = datetime.now(timezone.utc).isoformat()
        return {"acquired": True, "forced": False}

    # 其他人已锁定 → 拒绝
    return {"acquired": False, "editor": lock["display_name"]}


@router.post("/release")
async def release_lock(
    req: LockAcquireRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """释放项目编辑锁（离开项目时调用）"""
    lock = _project_locks.get(req.project_id)
    if lock and lock["user_id"] == current_user.id:
        del _project_locks[req.project_id]
        return {"released": True}
    # 管理员也可以释放任何锁
    if current_user.role == UserRole.SUPER_ADMIN and lock:
        del _project_locks[req.project_id]
        return {"released": True}
    return {"released": False}


@router.post("/request-transfer")
async def request_transfer(
    req: TransferRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """请求接管项目编辑权"""
    lock = _project_locks.get(req.project_id)
    if not lock:
        raise HTTPException(status_code=400, detail="项目未锁定，可直接进入")
    if lock["user_id"] == current_user.id:
        raise HTTPException(status_code=400, detail="你已经是编辑者")
    if current_user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="管理员可直接接管")

    request_id = str(uuid.uuid4())[:8]
    _transfer_requests[request_id] = {
        "request_id": request_id,
        "project_id": req.project_id,
        "from_user_id": current_user.id,
        "from_username": current_user.username,
        "from_display_name": current_user.display_name,
        "to_user_id": lock["user_id"],
        "to_username": lock["username"],
        "to_display_name": lock["display_name"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"request_id": request_id, "status": "pending", "target": lock["display_name"]}


@router.get("/pending-requests")
async def get_pending_requests(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取发给我的待处理请求"""
    pending = [
        r for r in _transfer_requests.values()
        if r["to_user_id"] == current_user.id and r["status"] == "pending"
    ]
    return pending


@router.get("/my-requests")
async def get_my_requests(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取我发出的请求状态"""
    my = [
        r for r in _transfer_requests.values()
        if r["from_user_id"] == current_user.id
    ]
    return my


@router.post("/respond-transfer")
async def respond_transfer(
    resp: TransferResponse,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """响应接管请求（同意/拒绝）"""
    req = _transfer_requests.get(resp.request_id)
    if not req:
        raise HTTPException(status_code=404, detail="请求不存在")
    if req["to_user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="只有当前编辑者可以响应")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="请求已处理")

    if resp.approved:
        # 转移锁
        project_id = req["project_id"]
        _project_locks[project_id] = {
            "user_id": req["from_user_id"],
            "username": req["from_username"],
            "display_name": req["from_display_name"],
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }
        req["status"] = "approved"
        return {"accepted": True, "new_editor": req["from_display_name"]}
    else:
        req["status"] = "rejected"
        return {"accepted": False}


@router.post("/force-takeover")
async def force_takeover(
    req: LockAcquireRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """管理员强制接管"""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可强制接管")

    _project_locks[req.project_id] = {
        "user_id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "locked_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"acquired": True}
