"""
应用全局配置模块
使用 pydantic-settings 管理环境变量与运行时配置
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """全局应用配置"""

    # ---- 应用基础 ----
    APP_NAME: str = "企业AI智能工作台"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    # ---- 数据库 ----
    # 开发阶段使用 SQLite，生产阶段切换为 PostgreSQL
    DATABASE_URL: str = f"sqlite+aiosqlite:///{Path(__file__).resolve().parent.parent / 'storage' / 'app.db'}"

    # ---- JWT 认证 ----
    JWT_SECRET_KEY: str = "dev-secret-key-change-in-production-please"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8小时

    # ---- Hermes CLI ----
    HERMES_CLI_PATH: str = "/Users/jiayiren/.local/bin/hermes"  # 本地 hermes 命令路径，可在 .env 中覆盖
    HERMES_PYTHON_PATH: str = "/Users/jiayiren/.hermes/hermes-agent/venv/bin/python3"  # Hermes venv Python 3.11
    HERMES_STREAM_BRIDGE: str = str(Path(__file__).resolve().parent.parent / "hermes_stream_bridge.py")
    HERMES_TIMEOUT_SECONDS: int = 600  # 单次对话超时（秒）
    MAX_CONCURRENT_HERMES: int = 3  # 最大并发 Hermes 子进程数

    # ---- 存储路径 ----
    PROJECT_STORAGE_ROOT: str = str(Path(__file__).resolve().parent.parent / "storage" / "projects")

    # ---- CORS ----
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://192.168.1.124:5173",
        "http://192.168.1.124:5174",
        "http://192.168.194.193:5173",
        "http://192.168.194.193:5174",
    ]
    CORS_ALLOW_ALL: bool = True  # 开发模式：允许所有来源（局域网IP可能变化）

    # ---- 蒸馏 Agent ----
    DISTILLATION_MODEL: str = "gpt-4o"  # 用于结案提炼的模型
    DISTILLATION_API_KEY: str = ""       # API Key，通过 .env 注入

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
