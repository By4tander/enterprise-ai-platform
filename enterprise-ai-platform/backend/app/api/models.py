"""
模型管理 API
读取 Hermes 配置 + 数据库模型配置，支持思考模式切换
所有 API Key 存储在 Hermes 后端，前端不可见
"""
import json
import yaml
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.models.user import User
from app.middleware.auth import get_current_user

router = APIRouter(prefix="/api/models", tags=["模型管理"])

HERMES_CONFIG = Path.home() / ".hermes" / "config.yaml"
HERMES_AUTH = Path.home() / ".hermes" / "auth.json"

# Known models per provider with thinking support info
PROVIDER_MODELS: dict[str, list[dict]] = {
    "deepseek": [
        {"name": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "thinking": True},
        {"name": "deepseek-v4-flash", "label": "DeepSeek V4 Flash", "thinking": False},
        {"name": "deepseek-reasoner", "label": "DeepSeek Reasoner", "thinking": True},
        {"name": "deepseek-chat", "label": "DeepSeek Chat", "thinking": True},
    ],
    "dashscope": [
        {"name": "qwen-max", "label": "Qwen Max", "thinking": True},
        {"name": "qwen-plus", "label": "Qwen Plus", "thinking": True},
        {"name": "qwen-flash", "label": "Qwen Flash", "thinking": False},
        {"name": "qwen-turbo", "label": "Qwen Turbo", "thinking": False},
        {"name": "qwen3-max", "label": "Qwen3 Max", "thinking": True},
        {"name": "qwen3.5-plus", "label": "Qwen 3.5 Plus", "thinking": True},
        {"name": "qwq-plus", "label": "QwQ Plus (Reasoning)", "thinking": True},
        {"name": "qwen-max", "label": "Qwen Max (No Think)", "thinking": False},
        {"name": "qwen-plus", "label": "Qwen Plus (No Think)", "thinking": False},
    ],
    "openai": [
        {"name": "gpt-4o", "label": "GPT-4o", "thinking": False},
        {"name": "gpt-4o-mini", "label": "GPT-4o Mini", "thinking": False},
        {"name": "o1", "label": "O1", "thinking": True},
        {"name": "o3-mini", "label": "O3 Mini", "thinking": True},
    ],
    "anthropic": [
        {"name": "claude-4-opus", "label": "Claude 4 Opus", "thinking": True},
        {"name": "claude-4-sonnet", "label": "Claude 4 Sonnet", "thinking": True},
        {"name": "claude-3.5-sonnet", "label": "Claude 3.5 Sonnet", "thinking": False},
    ],
}


def _read_hermes_config() -> dict:
    if not HERMES_CONFIG.exists():
        return {}
    with open(HERMES_CONFIG) as f:
        return yaml.safe_load(f) or {}


def _read_hermes_auth() -> dict:
    if not HERMES_AUTH.exists():
        return {}
    with open(HERMES_AUTH) as f:
        return json.load(f) or {}


@router.get("/current")
async def get_current_model(current_user: Annotated[User, Depends(get_current_user)]):
    config = _read_hermes_config()
    model = config.get("model", {})
    return {
        "model": model.get("default", ""),
        "provider": model.get("provider", ""),
        "base_url": model.get("base_url", ""),
    }


@router.get("/providers")
async def list_providers(current_user: Annotated[User, Depends(get_current_user)]):
    """列出 Hermes 已配置的提供商（不返回 API Key）"""
    auth = _read_hermes_auth()
    providers = []
    pool = auth.get("credential_pool", {})
    for name, creds in pool.items():
        if isinstance(creds, list) and len(creds) > 0:
            providers.append({"name": name, "label": creds[0].get("label", name)})
    return {"providers": providers, "active_provider": auth.get("active_provider")}


@router.get("/all")
async def list_available_models(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    """
    自动检测 + 同步：从 Hermes auth 读取可用提供商，
    为每个提供商生成可选模型列表，写入数据库。
    返回所有可用于切换的模型。
    """
    config = _read_hermes_config()
    curent = config.get("model", {})
    curent_default = curent.get("default", "")
    curent_provider = curent.get("provider", "")

    auth = _read_hermes_auth()
    pool = auth.get("credential_pool", {})
    available_providers = [p for p in pool.keys() if isinstance(pool[p], list) and len(pool[p]) > 0]

    models_out = []

    for provider in available_providers:
        presets = PROVIDER_MODELS.get(provider, [])
        if not presets:
            continue
        for preset in presets:
            if preset["thinking"]:
                # Generate two entries: with and without thinking
                models_out.append({
                    "id": f"{provider}:{preset['name']}:think",
                    "name": preset["name"],
                    "provider": provider,
                    "label": f"{preset['label']} (思考)",
                    "thinking": True,
                    "thinking_effort": "high",
                    "active": False,
                })
                models_out.append({
                    "id": f"{provider}:{preset['name']}:fast",
                    "name": preset["name"],
                    "provider": provider,
                    "label": f"{preset['label']}",
                    "thinking": False,
                    "thinking_effort": None,
                    "active": False,
                })
            else:
                models_out.append({
                    "id": f"{provider}:{preset['name']}",
                    "name": preset["name"],
                    "provider": provider,
                    "label": preset["label"],
                    "thinking": False,
                    "thinking_effort": None,
                    "active": False,
                })

    # Deduplicate by id
    seen = set()
    deduped = []
    for m in models_out:
        if m["id"] not in seen:
            seen.add(m["id"])
            deduped.append(m)

    # Mark current model as active
    for m in deduped:
        if m["name"] == curent_default and m["provider"] == curent_provider:
            m["active"] = True
            break

    return {"models": deduped, "current": {"model": curent_default, "provider": curent_provider}, "available_providers": available_providers}


@router.put("/switch")
async def switch_model(data: dict, current_user: Annotated[User, Depends(get_current_user)]):
    """切换模型并更新 Hermes config.yaml"""
    model_name = data.get("model")
    provider = data.get("provider")
    thinking = data.get("thinking", False)
    thinking_effort = data.get("thinking_effort", "high") if thinking else None

    if not model_name or not provider:
        raise HTTPException(status_code=400, detail="缺少模型名称或提供商")

    config = _read_hermes_config()
    if "model" not in config:
        config["model"] = {}

    config["model"]["default"] = model_name
    config["model"]["provider"] = provider

    # Set base_url from known providers
    provider_base_urls = {
        "deepseek": "https://api.deepseek.com/v1",
        "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "openai": "https://api.openai.com/v1",
        "anthropic": "https://api.anthropic.com",
    }
    if provider in provider_base_urls:
        config["model"]["base_url"] = provider_base_urls[provider]

    # Set agent reasoning_effort if thinking is enabled
    if "agent" not in config:
        config["agent"] = {}
    if thinking and thinking_effort == "high":
        config["agent"]["reasoning_effort"] = "high"

    # Back up
    if HERMES_CONFIG.exists():
        import shutil
        bak = HERMES_CONFIG.with_suffix(f".yaml.bak.switch")
        shutil.copy(HERMES_CONFIG, bak)

    with open(HERMES_CONFIG, "w") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False)

    return {"ok": True, "model": model_name, "provider": provider, "thinking": thinking}
