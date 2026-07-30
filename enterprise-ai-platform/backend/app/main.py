"""
企业AI智能工作台 — FastAPI 主应用入口
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api import auth, departments, projects, skills, messages, artifacts, chat, files, locks, folders, models

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
    """增量迁移：为旧版数据库添加新列/表（不存在时才加）"""
    from app.database import engine
    from sqlalchemy import text

    async with engine.begin() as conn:
        # messages.attachments_json
        try:
            result = await conn.execute(text("PRAGMA table_info(messages)"))
            columns = [row[1] for row in result.fetchall()]
            if 'attachments_json' not in columns:
                await conn.execute(text("ALTER TABLE messages ADD COLUMN attachments_json TEXT"))
                logger.info("✅ 迁移：messages.attachments_json 已添加")
        except Exception as e:
            logger.warning(f"messages 迁移失败: {e}")

        # projects.folder_id
        try:
            result = await conn.execute(text("PRAGMA table_info(projects)"))
            columns = [row[1] for row in result.fetchall()]
            if 'folder_id' not in columns:
                await conn.execute(text("ALTER TABLE projects ADD COLUMN folder_id CHAR(36)"))
                logger.info("✅ 迁移：projects.folder_id 已添加")
        except Exception as e:
            logger.warning(f"projects.folder_id 迁移失败: {e}")

        # projects.model_config_json
        try:
            result = await conn.execute(text("PRAGMA table_info(projects)"))
            columns = [row[1] for row in result.fetchall()]
            if 'model_config_json' not in columns:
                await conn.execute(text("ALTER TABLE projects ADD COLUMN model_config_json TEXT DEFAULT ''"))
                logger.info("✅ 迁移：projects.model_config_json 已添加")
        except Exception as e:
            logger.warning(f"projects.model_config_json 迁移失败: {e}")

        # project_folders.department_ids
        try:
            result = await conn.execute(text("PRAGMA table_info(project_folders)"))
            columns = [row[1] for row in result.fetchall()]
            if 'department_ids' not in columns:
                await conn.execute(text("ALTER TABLE project_folders ADD COLUMN department_ids TEXT DEFAULT ''"))
                logger.info("✅ 迁移：project_folders.department_ids 已添加")
        except Exception as e:
            logger.warning(f"project_folders.department_ids 迁移失败: {e}")

        logger.debug("数据库迁移检查完成")


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
app.include_router(folders.router)
app.include_router(models.router)


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


@app.get("/api/health/hermes-model")
async def hermes_model_info():
    """读取 Hermes 配置的模型信息"""
    import yaml
    from pathlib import Path
    
    config_path = Path.home() / ".hermes" / "config.yaml"
    if not config_path.exists():
        return {"model": None}
    
    try:
        with open(config_path) as f:
            config = yaml.safe_load(f)
        model = config.get("model", {})
        return {
            "model": model.get("default"),
            "provider": model.get("provider"),
            "base_url": model.get("base_url"),
        }
    except Exception:
        return {"model": None}
