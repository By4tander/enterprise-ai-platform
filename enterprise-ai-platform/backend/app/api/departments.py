"""
部门管理 API 路由
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.department import Department
from app.models.project import Project
from app.middleware.auth import get_current_user, require_role
from app.schemas.department import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/api/departments", tags=["部门管理"])


@router.get("/", response_model=list[DepartmentOut])
async def list_departments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取所有部门列表"""
    result = await db.execute(select(Department).order_by(Department.created_at))
    departments = result.scalars().all()

    out_list = []
    for dept in departments:
        # 统计用户数
        user_count_result = await db.execute(
            select(func.count(User.id)).where(User.department_id == dept.id)
        )
        user_count = user_count_result.scalar() or 0

        # 统计项目数
        project_count_result = await db.execute(
            select(func.count(Project.id)).where(Project.department_id == dept.id)
        )
        project_count = project_count_result.scalar() or 0

        out_list.append(DepartmentOut(
            id=dept.id,
            name=dept.name,
            description=dept.description,
            created_at=dept.created_at,
            user_count=user_count,
            project_count=project_count,
        ))

    return out_list


@router.post("/", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
async def create_department(
    req: DepartmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_role(UserRole.SUPER_ADMIN))],
):
    """创建新部门（仅 Super Admin）"""
    existing = await db.execute(select(Department).where(Department.name == req.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="部门名称已存在")

    dept = Department(name=req.name, description=req.description)
    db.add(dept)
    await db.commit()
    await db.refresh(dept)

    return DepartmentOut(
        id=dept.id,
        name=dept.name,
        description=dept.description,
        created_at=dept.created_at,
    )


@router.get("/{department_id}", response_model=DepartmentOut)
async def get_department(
    department_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取部门详情"""
    dept = await db.get(Department, department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

    user_count_result = await db.execute(
        select(func.count(User.id)).where(User.department_id == dept.id)
    )
    user_count = user_count_result.scalar() or 0

    project_count_result = await db.execute(
        select(func.count(Project.id)).where(Project.department_id == dept.id)
    )
    project_count = project_count_result.scalar() or 0

    return DepartmentOut(
        id=dept.id,
        name=dept.name,
        description=dept.description,
        created_at=dept.created_at,
        user_count=user_count,
        project_count=project_count,
    )


@router.put("/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: str,
    req: DepartmentUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_role(UserRole.SUPER_ADMIN))],
):
    """更新部门信息（仅 Super Admin）"""
    dept = await db.get(Department, department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

    if req.name is not None:
        dept.name = req.name
    if req.description is not None:
        dept.description = req.description

    await db.commit()
    await db.refresh(dept)
    return DepartmentOut(
        id=dept.id,
        name=dept.name,
        description=dept.description,
        created_at=dept.created_at,
    )
