"""
项目协作锁定 API

实现冲突访问控制：
- 用户进入项目时自动锁定
- 管理员/部门管理员进入他人项目时为只读模式（不自动接管）
- 管理员可选择手动强制接管
- 部门管理员可强制接管本部门成员的项目
- 接管后通知原编辑者
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

# ── 内存存储 ──
_project_locks: dict[str, dict] = {}
_transfer_requests: dict[str, dict] = {}
# ── 接管通知：{ target_user_id: [{ message, project_name, timestamp }] } ──
_takeover_notifications: dict[str, list[dict]] = {}


class LockAcquireRequest(BaseModel):
    project_id: str


class TransferRequest(BaseModel):
    project_id: str


class TransferResponse(BaseModel):
    request_id: str
    approved: bool


def _is_dept_admin_of(user: User, target_user_id: str) -> bool:
    """检查 user 是否是 target_user 所在部门的部门管理员"""
    if user.role not in (UserRole.SUPER_ADMIN, UserRole.DEPT_ADMIN):
        return False
    return True  # Will be checked against actual dept membership


@router.get("/status/{project_id}")
async def get_lock_status(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取项目锁定状态"""
    lock = _project_locks.get(project_id)
    
    # Check if current user can takeover (admin or dept_admin of same dept)
    can_takeover = current_user.role == UserRole.SUPER_ADMIN
    if not can_takeover and lock and current_user.role == UserRole.DEPT_ADMIN:
        # Check if the editor is in the same department
        result = await db.execute(select(User).where(User.id == lock["user_id"]))
        editor = result.scalar_one_or_none()
        if editor and editor.department_id == current_user.department_id:
            can_takeover = True
    
    if lock:
        return {
            "locked": True,
            "editor_id": lock["user_id"],
            "editor_username": lock["username"],
            "editor_display_name": lock["display_name"],
            "locked_at": lock["locked_at"],
            "is_me": lock["user_id"] == current_user.id,
            "is_admin": current_user.role == UserRole.SUPER_ADMIN,
            "is_dept_admin": current_user.role == UserRole.DEPT_ADMIN,
            "can_takeover": can_takeover,
        }
    return {"locked": False, "is_me": False, "is_admin": current_user.role == UserRole.SUPER_ADMIN, "is_dept_admin": current_user.role == UserRole.DEPT_ADMIN, "can_takeover": False}


@router.post("/acquire")
async def acquire_lock(
    req: LockAcquireRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取项目编辑锁（进入项目时调用）。
    管理员/部门管理员进入他人项目时，默认不接管，只获取只读权限。
    """
    project_id = req.project_id
    lock = _project_locks.get(project_id)

    # 项目未锁定 → 直接获取
    if not lock:
        _project_locks[project_id] = {
            "user_id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name,
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"acquired": True, "forced": False, "is_admin_viewer": False}

    # 自己已锁定 → 续期
    if lock["user_id"] == current_user.id:
        lock["locked_at"] = datetime.now(timezone.utc).isoformat()
        return {"acquired": True, "forced": False, "is_admin_viewer": False}

    # 管理员 → 不自动接管，返回只读 + can_takeover 标记
    can_takeover = current_user.role == UserRole.SUPER_ADMIN
    if not can_takeover and current_user.role == UserRole.DEPT_ADMIN:
        result = await db.execute(select(User).where(User.id == lock["user_id"]))
        editor = result.scalar_one_or_none()
        if editor and editor.department_id == current_user.department_id:
            can_takeover = True

    if can_takeover:
        return {"acquired": False, "editor": lock["display_name"], "can_takeover": True, "is_admin_viewer": True}

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
    pending = [
        r for r in _transfer_requests.values()
        if r["to_user_id"] == current_user.id and r["status"] == "pending"
    ]
    return pending


@router.get("/my-requests")
async def get_my_requests(
    current_user: Annotated[User, Depends(get_current_user)],
):
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
    req = _transfer_requests.get(resp.request_id)
    if not req:
        raise HTTPException(status_code=404, detail="请求不存在")
    if req["to_user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="只有当前编辑者可以响应")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="请求已处理")

    if resp.approved:
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
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """管理员或部门管理员强制接管"""
    lock = _project_locks.get(req.project_id)
    if not lock:
        # No lock → just acquire
        _project_locks[req.project_id] = {
            "user_id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name,
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"acquired": True, "notified": False}

    if lock["user_id"] == current_user.id:
        return {"acquired": True, "notified": False}

    # Check takeover permission
    can_takeover = current_user.role == UserRole.SUPER_ADMIN
    if not can_takeover and current_user.role == UserRole.DEPT_ADMIN:
        result = await db.execute(select(User).where(User.id == lock["user_id"]))
        editor = result.scalar_one_or_none()
        if editor and editor.department_id == current_user.department_id:
            can_takeover = True

    if not can_takeover:
        raise HTTPException(status_code=403, detail="无权接管该项目")

    # Get project name for notification
    from app.models.project import Project
    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    project_name = project.name if project else req.project_id

    # Notify the original editor
    target_user_id = lock["user_id"]
    notification = {
        "message": f"您的工作流「{project_name}」已被 {current_user.display_name} 接管",
        "project_id": req.project_id,
        "project_name": project_name,
        "by_user": current_user.display_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if target_user_id not in _takeover_notifications:
        _takeover_notifications[target_user_id] = []
    _takeover_notifications[target_user_id].append(notification)

    # Force take over
    _project_locks[req.project_id] = {
        "user_id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "locked_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"acquired": True, "notified": True, "previous_editor": lock["display_name"]}


@router.get("/notifications")
async def get_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取接管通知"""
    notifications = _takeover_notifications.get(current_user.id, [])
    # Clear after reading
    _takeover_notifications[current_user.id] = []
    return notifications


@router.get("/all-locks")
async def get_all_locks(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取所有项目锁定状态（用于侧边栏显示编辑者）"""
    return {
        pid: {
            "editor_display_name": lock["display_name"],
            "editor_id": lock["user_id"],
        }
        for pid, lock in _project_locks.items()
    }
