"""
企业AI智能工作台 — FastAPI 主应用入口
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api import auth, departments, projects, skills, messages, artifacts, chat, files, locks

# ---- 日志配置 ----
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} 启动中...")
    await init_db()
    await _migrate_db()
    logger.info("✅ 数据库初始化完成")
    yield
    logger.info("🛑 应用关闭")


async def _migrate_db():
    """增量迁移：为旧版数据库添加新列（不存在时才加）"""
    from app.database import engine
    from sqlalchemy import text

    async with engine.begin() as conn:
        # 检查 messages 表是否有 attachments_json 列
        try:
            result = await conn.execute(text("PRAGMA table_info(messages)"))
            columns = [row[1] for row in result.fetchall()]
            if 'attachments_json' not in columns:
                await conn.execute(text("ALTER TABLE messages ADD COLUMN attachments_json TEXT"))
                logger.info("✅ 数据库迁移：messages 表已添加 attachments_json 列")
            else:
                logger.debug("数据库已是最新版本（attachments_json 列已存在）")
        except Exception as e:
            logger.warning(f"数据库迁移检查失败（首次启动时正常）: {e}")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="企业级多租户 AI 协作 Web 平台",
    lifespan=lifespan,
)

# ---- CORS 中间件 ----
# 注意：allow_origins=["*"] 与 allow_credentials=True 违反 CORS 规范
# 当 CORS_ALLOW_ALL 时使用 allow_origin_regex 匹配所有来源，避免浏览器拒绝响应
if settings.CORS_ALLOW_ALL:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ---- 注册路由 ----
app.include_router(auth.router)
app.include_router(departments.router)
app.include_router(projects.router)
app.include_router(skills.router)
app.include_router(messages.router)
app.include_router(artifacts.router)
app.include_router(chat.router)
app.include_router(files.router)
app.include_router(locks.router)


@app.get("/")
async def root():
    """健康检查"""
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
    }


@app.get("/api/health")
async def health_check():
    """API 健康检查"""
    import shutil
    from app.services.hermes_bridge import HERMES_AVAILABLE
    return {
        "status": "healthy",
        "hermes_available": HERMES_AVAILABLE,
        "database": "connected",
    }
