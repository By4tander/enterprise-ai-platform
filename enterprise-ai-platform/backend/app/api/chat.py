"""
对话聊天 API — 后台任务持久化版 v2
"""
import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse
import os as _os

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.message import Message, SenderType
from app.models.artifact import Artifact
from app.middleware.auth import get_current_user
from app.schemas.message import ChatRequest
from app.services.hermes_bridge import get_bridge
from app.services.artifact_extractor import artifact_extractor
from app.services.context_assembler import ContextAssembler
from app.services.background_tasks import ChatBackgroundTask, register_task, get_task, remove_task, stream_resume
from app.services.session_isolation import SessionIsolationEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["对话"])


def _snapshot_files(root: str) -> dict:
    snap = {}
    if _os.path.isdir(root):
        for dirpath, dirnames, filenames in _os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            for fn in filenames:
                if fn.startswith('.') or fn == '.DS_Store':
                    continue
                fp = _os.path.join(dirpath, fn)
                try:
                    snap[_os.path.relpath(fp, root)] = _os.path.getmtime(fp)
                except OSError:
                    pass
    return snap


@router.post("/stream")
async def chat_stream(req: ChatRequest, request: Request, db: Annotated[AsyncSession, Depends(get_db)], current_user: Annotated[User, Depends(get_current_user)]):
    project = await db.get(Project, req.project_id)
    if not project: raise HTTPException(404, detail="项目不存在")
    if current_user.role != UserRole.SUPER_ADMIN and current_user.department_id != project.department_id:
        raise HTTPException(403, detail="无权访问")
    if project.status.value != "active":
        raise HTTPException(400, detail="项目已归档")

    user_msg = Message(project_id=req.project_id, sender_type=SenderType.USER, sender_name=current_user.username, content=req.content)
    db.add(user_msg)
    await db.commit()

    assembler = ContextAssembler(db, req.project_id)
    full_prompt = await assembler.assemble_prompt(req.content)
    bridge = get_bridge()
    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(req.project_id)
    pre_snapshot = _snapshot_files(str(sandbox)) if sandbox.exists() else {}

    model_config = None
    try:
        if project.model_config_json:
            model_config = json.loads(project.model_config_json)
    except Exception:
        pass

    # Create background task
    bk_task = ChatBackgroundTask(req.project_id, current_user.id)
    register_task(bk_task)

    async def event_generator():
        content_parts = []
        thinking_parts = []
        total_tokens_used = 0  # track from context events
        bk_chunks = bk_task.chunks

        # Producer: runs bridge.chat() → appends to chunks list
        async def producer():
            try:
                async for chunk in bridge.chat(prompt=full_prompt, project_id=req.project_id, file_paths=req.file_paths, model_config=model_config):
                    bk_task.push(chunk.get("type", "content"), chunk.get("delta", ""))
            except asyncio.CancelledError:
                logger.info(f"[Producer] cancelled")
            except Exception as e:
                logger.exception(f"[Producer] error: {e}")
                bk_task.push("__error__", str(e))
            finally:
                bk_task.mark_done()

        producer_task = asyncio.create_task(producer())
        yield {"event": "status", "data": json.dumps({"type": "status", "content": "Agent 已连接"}, ensure_ascii=False)}

        try:
            idx = 0
            while True:
                # Yield all new chunks from the list buffer
                while idx < len(bk_chunks):
                    event_type, event_data = bk_chunks[idx]
                    idx += 1

                    if event_type == "__done__":
                        done_data = json.loads(event_data) if isinstance(event_data, str) and event_data else {}
                        full_content = "".join(content_parts)
                        full_thinking = "".join(thinking_parts)
                        if full_content or full_thinking:
                            agent_msg = Message(project_id=req.project_id, sender_type=SenderType.AGENT, sender_name="Hermes Agent",
                                content=full_content or "(思考过程)", thinking_content=full_thinking,
                                tokens_used=total_tokens_used or done_data.get("total_tokens", 0))
                            db.add(agent_msg)
                            await db.commit()
                            await db.refresh(agent_msg)
                            post = _snapshot_files(str(sandbox)) if sandbox.exists() else {}
                            for rp, mt in post.items():
                                if not rp.startswith('attachments/') and (rp not in pre_snapshot or pre_snapshot[rp] != mt):
                                    ex = (await db.execute(select(Artifact).where(Artifact.project_id == req.project_id, Artifact.artifact_path == rp))).scalar_one_or_none()
                                    if not ex:
                                        ext = _os.path.splitext(rp)[1].lower()
                                        db.add(Artifact(project_id=req.project_id, title=_os.path.basename(rp), content="", file_type=ext.lstrip('.') or 'file', artifact_path=rp))
                            await db.commit()
                            await artifact_extractor.extract_and_save(db, req.project_id, full_content)
                            bk_task.message_id = agent_msg.id
                            yield {"event": "done", "data": json.dumps({"type": "done", "message_id": agent_msg.id}, ensure_ascii=False)}
                        else:
                            yield {"event": "done", "data": json.dumps({"type": "done", "message_id": None}, ensure_ascii=False)}
                        remove_task(req.project_id)
                        producer_task.cancel()
                        return

                    elif event_type == "__error__":
                        yield {"event": "error", "data": json.dumps({"type": "error", "content": event_data}, ensure_ascii=False)}
                        remove_task(req.project_id)
                        producer_task.cancel()
                        return

                    elif event_type in ("content", "content_chunk"):
                        content_parts.append(event_data)
                        yield {"event": "content", "data": json.dumps({"type": "content_chunk", "content": event_data}, ensure_ascii=False)}
                    elif event_type in ("thinking", "thinking_chunk"):
                        thinking_parts.append(event_data)
                        yield {"event": "thinking", "data": json.dumps({"type": "thinking_chunk", "content": event_data}, ensure_ascii=False)}
                    elif event_type == "context":
                        # Parse context data from bridge (includes tokens_used)
                        ctx_data = json.loads(event_data) if isinstance(event_data, str) else event_data
                        total_tokens_used = ctx_data.get("tokens_used", 0) or ctx_data.get("total_tokens", 0)
                        yield {"event": "context", "data": json.dumps(ctx_data, ensure_ascii=False)}
                    elif event_type == "queue":
                        yield {"event": "status", "data": json.dumps({"type": "status", "content": event_data}, ensure_ascii=False)}
                    else:
                        yield {"event": "status", "data": json.dumps({"type": "status", "content": str(event_data)[:200]}, ensure_ascii=False)}

                if bk_task.status != "running":
                    remove_task(req.project_id)
                    return
                # Wait then check for new chunks
                await asyncio.sleep(0.3)

        except asyncio.CancelledError:
            logger.info(f"[SSE] 客户端断开, project={req.project_id}, 后台继续运行")
            # Producer stays alive — chunks continue to be appended to list

        except Exception as e:
            logger.exception("[SSE] 异常")
            yield {"event": "error", "data": json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)}
            remove_task(req.project_id)
            producer_task.cancel()

    return EventSourceResponse(event_generator(), headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache", "Pragma": "no-cache", "Connection": "keep-alive"})


@router.get("/status/{project_id}")
async def get_chat_status(project_id: str, current_user: Annotated[User, Depends(get_current_user)]):
    task = get_task(project_id)
    return task.to_status() if task else {"project_id": project_id, "status": "idle"}


@router.get("/resume/{project_id}")
async def resume_chat(project_id: str, request: Request, current_user: Annotated[User, Depends(get_current_user)]):
    task = get_task(project_id)
    if not task:
        raise HTTPException(status_code=404, detail="无运行中的后台任务")
    if task.status not in ("running", "done", "error"):
        raise HTTPException(status_code=404, detail="任务已结束")

    async def replay():
        async for event_name, data_str in stream_resume(task):
            yield {"event": event_name, "data": data_str}
        remove_task(project_id)

    return EventSourceResponse(replay(), headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache", "Connection": "keep-alive"})
