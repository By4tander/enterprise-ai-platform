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
        {"name": "deepseek-v4-pro", "label": "DeepSeek V4 Pro (快速)", "thinking": False},
        {"name": "deepseek-v4-flash", "label": "DeepSeek V4 Flash", "thinking": True},
        {"name": "deepseek-v4-flash", "label": "DeepSeek V4 Flash (快速)", "thinking": False},
        {"name": "deepseek-reasoner", "label": "DeepSeek R1 (Legacy)", "thinking": True},
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

# Hermes auth.json provider key → our preset key
_PROVIDER_ALIASES = {
    "chatgpt": "openai",
    "claude": "anthropic",
    "gemini": "google",
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
    return {"model": model.get("default", ""), "provider": model.get("provider", ""), "base_url": model.get("base_url", "")}


@router.get("/providers")
async def list_providers(current_user: Annotated[User, Depends(get_current_user)]):
    auth = _read_hermes_auth()
    providers = []
    pool = auth.get("credential_pool", {})
    for name, creds in pool.items():
        if isinstance(creds, list) and len(creds) > 0:
            providers.append({"name": name, "label": creds[0].get("label", name)})
    return {"providers": providers, "active_provider": auth.get("active_provider")}


# ── Shared model list builder ──

async def _build_model_list(db: AsyncSession) -> dict:
    config = _read_hermes_config()
    curent = config.get("model", {})
    curent_default = curent.get("default", "")
    curent_provider = curent.get("provider", "")

    auth = _read_hermes_auth()
    pool = auth.get("credential_pool", {})
    available_providers = [p for p in pool.keys() if isinstance(pool[p], list) and len(pool[p]) > 0]

    # ── Read all models from database ──
    result = await db.execute(text(
        "SELECT id, provider, model_name, display_name, thinking_mode FROM model_configs ORDER BY provider, created_at ASC"
    ))
    db_models = result.fetchall()

    models_out = []
    for row in db_models:
        cid, cprov, cmodel, cdisp, cthink = row
        models_out.append({
            "id": f"db:{cid}",
            "name": cmodel, "provider": cprov,
            "label": cdisp or cmodel,
            "thinking": bool(cthink),
            "thinking_effort": "high" if cthink else None,
            "active": False, "can_delete": True,
        })

    if not models_out:
        # Empty DB → generate from presets + save
        for provider in available_providers:
            mapped = _PROVIDER_ALIASES.get(provider, provider)
            for preset in PROVIDER_MODELS.get(mapped, []):
                if preset["thinking"]:
                    sid = f"{provider}_{preset['name']}_think"
                    await db.execute(text(
                        "INSERT OR IGNORE INTO model_configs (id,provider,model_name,display_name,thinking_mode,thinking_effort,is_active,created_at) VALUES (:id,:p,:m,:d,1,'high',0,datetime('now'))"
                    ), {"id": sid, "p": provider, "m": preset["name"], "d": f"{preset['label']} (思考)"})
                sid = f"{provider}_{preset['name']}"
                await db.execute(text(
                    "INSERT OR IGNORE INTO model_configs (id,provider,model_name,display_name,thinking_mode,thinking_effort,is_active,created_at) VALUES (:id,:p,:m,:d,0,'',0,datetime('now'))"
                ), {"id": sid, "p": provider, "m": preset["name"], "d": preset['label']})
        await db.commit()
        # Re-read
        result = await db.execute(text(
            "SELECT id, provider, model_name, display_name, thinking_mode FROM model_configs ORDER BY provider, created_at ASC"
        ))
        db_models = result.fetchall()
        models_out = []
        for row in db_models:
            cid, cprov, cmodel, cdisp, cthink = row
            models_out.append({
                "id": f"db:{cid}",
                "name": cmodel, "provider": cprov,
                "label": cdisp or cmodel,
                "thinking": bool(cthink),
                "thinking_effort": "high" if cthink else None,
                "active": False, "can_delete": True,
            })

    # Mark current model as active
    for m in models_out:
        if m["name"] == curent_default and m["provider"] == curent_provider:
            m["active"] = True
            break

    return {"models": models_out, "current": {"model": curent_default, "provider": curent_provider}, "available_providers": available_providers}


@router.get("/all")
async def list_available_models(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    return await _build_model_list(db)


@router.get("/refresh")
async def refresh_models(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    return await _build_model_list(db)


@router.put("/switch")
async def switch_model(data: dict, current_user: Annotated[User, Depends(get_current_user)]):
    model_name = data.get("model")
    provider = data.get("provider")
    thinking = data.get("thinking", False)
    if not model_name or not provider:
        raise HTTPException(status_code=400, detail="缺少模型名称或提供商")

    config = _read_hermes_config()
    if "model" not in config:
        config["model"] = {}
    config["model"]["default"] = model_name
    # Map provider back to Hermes auth key (openai → chatgpt, etc.)
    _REVERSE_ALIASES = {"openai": "chatgpt", "anthropic": "claude"}
    hermes_provider = _REVERSE_ALIASES.get(provider, provider)
    config["model"]["provider"] = hermes_provider

    provider_base_urls = {
        "deepseek": "https://api.deepseek.com/v1",
        "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "openai": "https://api.openai.com/v1",
        "chatgpt": "https://api.openai.com/v1",
        "anthropic": "https://api.anthropic.com",
    }
    if provider in provider_base_urls:
        config["model"]["base_url"] = provider_base_urls[provider]

    if "agent" not in config:
        config["agent"] = {}
    if thinking:
        config["agent"]["reasoning_effort"] = "high"

    if HERMES_CONFIG.exists():
        import shutil
        shutil.copy(HERMES_CONFIG, HERMES_CONFIG.with_suffix(".yaml.bak.switch"))

    with open(HERMES_CONFIG, "w") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False)

    return {"ok": True, "model": model_name, "provider": provider, "thinking": thinking}


@router.post("/custom")
async def add_custom_model(data: dict, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    model_name = data.get("model", "").strip()
    provider = data.get("provider", "").strip()
    display_name = data.get("display_name", "").strip() or model_name
    thinking = data.get("thinking", False)
    if not model_name or not provider:
        raise HTTPException(status_code=400, detail="模型名称和提供商不能为空")
    import uuid
    model_id = str(uuid.uuid4())[:8]
    await db.execute(text(
        "INSERT INTO model_configs (id, provider, model_name, display_name, thinking_mode, thinking_effort, is_active, created_at) "
        "VALUES (:id, :provider, :model_name, :display_name, :thinking, :effort, 0, datetime('now'))"
    ), {"id": model_id, "provider": provider, "model_name": model_name, "display_name": display_name, "thinking": 1 if thinking else 0, "effort": "high" if thinking else ""})
    await db.commit()
    return {"ok": True, "id": model_id}


@router.delete("/custom/{model_id}")
async def delete_custom_model(model_id: str, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    await db.execute(text("DELETE FROM model_configs WHERE id=:id"), {"id": model_id})
    await db.commit()
    return {"ok": True}


@router.get("/custom")
async def list_custom_models(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(text("SELECT id, provider, model_name, display_name, thinking_mode FROM model_configs ORDER BY created_at DESC"))
    return [{"id": r[0], "provider": r[1], "model_name": r[2], "display_name": r[3], "thinking": bool(r[4])} for r in result.fetchall()]


@router.get("/project/{project_id}")
async def get_project_model(project_id: str, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(text("SELECT model_config_json FROM projects WHERE id=:id"), {"id": project_id})
    row = result.fetchone()
    if row and row[0]:
        return json.loads(row[0])
    config = _read_hermes_config()
    model = config.get("model", {})
    return {"model": model.get("default", ""), "provider": model.get("provider", ""), "thinking": False, "is_global": True}


@router.put("/project/{project_id}")
async def set_project_model(project_id: str, data: dict, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    config_json = json.dumps({"model": data.get("model", ""), "provider": data.get("provider", ""), "thinking": data.get("thinking", False), "thinking_effort": "high" if data.get("thinking") else None})
    await db.execute(text("UPDATE projects SET model_config_json=:cfg WHERE id=:id"), {"cfg": config_json, "id": project_id})
    await db.commit()
    return {"ok": True}
