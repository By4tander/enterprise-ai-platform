"""
数据库初始化脚本

创建默认部门和管理员账号，用于开发环境快速启动。
"""
import asyncio
import sys
from pathlib import Path

# 确保项目根路径在 sys.path 中
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import init_db, async_session_factory
from app.models.department import Department
from app.models.user import User, UserRole
from app.middleware.auth import hash_password


async def seed_data():
    """插入初始种子数据"""
    await init_db()

    async with async_session_factory() as session:
        # ---- 创建默认部门 ----
        departments_data = [
            {"name": "编剧部", "description": "负责剧本创作、故事大纲、角色设计等"},
            {"name": "美术部", "description": "负责概念设计、角色美术、场景绘制等"},
            {"name": "发行部", "description": "负责市场策略、发行渠道、用户增长等"},
            {"name": "综合部", "description": "跨部门协调、行政管理、资源统筹"},
        ]

        dept_map = {}
        for d in departments_data:
            dept = Department(name=d["name"], description=d["description"])
            session.add(dept)
            await session.flush()
            dept_map[d["name"]] = dept
            print(f"  ✅ 创建部门: {d['name']} (id={dept.id})")

        # ---- 创建默认用户 ----
        users_data = [
            {
                "username": "admin",
                "password": "admin",
                "display_name": "系统管理员",
                "role": UserRole.SUPER_ADMIN,
                "department_id": None,
            },
            {
                "username": "bianju",
                "password": "bianju",
                "display_name": "编剧部主管",
                "role": UserRole.DEPT_ADMIN,
                "department_id": dept_map["编剧部"].id,
            },
            {
                "username": "bianju1",
                "password": "bianju1",
                "display_name": "编剧1",
                "role": UserRole.MEMBER,
                "department_id": dept_map["编剧部"].id,
            },
            {
                "username": "bianju2",
                "password": "bianju2",
                "display_name": "编剧2",
                "role": UserRole.MEMBER,
                "department_id": dept_map["编剧部"].id,
            },
        ]

        for u in users_data:
            user = User(
                username=u["username"],
                password_hash=hash_password(u["password"]),
                display_name=u["display_name"],
                role=u["role"],
                department_id=u["department_id"],
            )
            session.add(user)
            print(f"  ✅ 创建用户: {u['username']} ({u['role'].value})")

        await session.commit()
        print("\n🎉 种子数据初始化完成！")
        print("\n登录凭据（账号 = 密码）：")
        print("  Super Admin:  admin")
        print("  编剧部主管:   bianju")


if __name__ == "__main__":
    asyncio.run(seed_data())
