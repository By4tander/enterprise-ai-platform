"""
对话聊天 API 路由 — Phase 2

核心端点：POST /api/chat/stream
- 通过 SSE (Server-Sent Events) 流式返回 Hermes CLI / 模拟器输出
- 自动解析 <think> 思考过程与正文，分别推送到前端
- 客户端断开时自动 kill 后台子进程，释放资源
- 对话完成后自动持久化消息与提取产出物
"""
import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.message import Message, SenderType
from app.middleware.auth import get_current_user
from app.schemas.message import ChatRequest
from app.services.hermes_bridge import get_bridge, HermesCLIBridge
from app.services.artifact_extractor import artifact_extractor
from app.services.context_assembler import ContextAssembler

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["对话"])


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    SSE 流式对话端点 (Phase 2 增强版)

    流式推送事件格式：
        event: thinking
        data: {"type":"thinking_chunk","content":"..."}

        event: content
        data: {"type":"content_chunk","content":"..."}

        event: done
        data: {"type":"done","message_id":"..."}

        event: error
        data: {"type":"error","content":"..."}

    特性：
    - 客户端断开 (Cancel/Tab Close) → 自动 kill hermes 子进程
    - <think> 标签实时解析，思考/正文分流
    - 对话完成后落库，自动提取代码块为 Artifact
    """
    # ── 1. 验证项目权限 ──
    project = await db.get(Project, req.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.department_id != project.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该项目")

    if project.status.value != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目已归档，无法对话")

    # ── 2. 保存用户消息（先落库） ──
    import json as _json
    attachments_json_str = None
    if req.attachments:
        attachments_json_str = _json.dumps(req.attachments, ensure_ascii=False)
    user_msg = Message(
        project_id=req.project_id,
        sender_type=SenderType.USER,
        sender_name=current_user.username,
        content=req.content,
        attachments_json=attachments_json_str,
    )
    db.add(user_msg)
    await db.commit()

    # ── 3. 拼装上下文（部门技能 + 项目历史 + 用户输入） ──
    assembler = ContextAssembler(db, req.project_id)
    full_prompt = await assembler.assemble_prompt(req.content)

    # ── 4. 获取 Bridge（自动检测真实 CLI / 模拟器） ──
    bridge = get_bridge()

    # ── 4.5 对话前快照：记录项目沙盒文件（用于产出物检测） ──
    from app.services.session_isolation import SessionIsolationEngine
    from app.models.artifact import Artifact
    import os as _os

    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(req.project_id)

    def _snapshot_files(root: str) -> dict:
        """扫描目录，返回 {relative_path: mtime}"""
        snap = {}
        if _os.path.isdir(root):
            for dirpath, dirnames, filenames in _os.walk(root):
                dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                for fn in filenames:
                    if fn.startswith('.') or fn == '.DS_Store':
                        continue
                    fp = _os.path.join(dirpath, fn)
                    try:
                        rel = _os.path.relpath(fp, root)
                        snap[rel] = _os.path.getmtime(fp)
                    except OSError:
                        pass
        return snap

    pre_snapshot = _snapshot_files(str(sandbox)) if sandbox.exists() else {}

    # ── 5. SSE 事件生成器 ──
    async def event_generator():
        content_parts: list[str] = []
        thinking_parts: list[str] = []
        bridge_instance = bridge  # 闭包引用，用于 disconnect 清理

        # 立即发送一个连接确认事件，让前端知道连接已建立
        yield {
            "event": "status",
            "data": json.dumps({
                "type": "status",
                "content": "SSE 连接已建立",
            }, ensure_ascii=False),
        }

        try:
            async for chunk in bridge.chat(
                prompt=full_prompt,
                project_id=req.project_id,
                file_paths=req.file_paths,
            ):
                chunk_type = chunk.get("type", "content")
                delta = chunk.get("delta", "")

                if chunk_type == "done":
                    # 从 stream bridge 的 done 事件中提取数据
                    done_data = {}
                    try:
                        done_data = json.loads(delta)
                    except (json.JSONDecodeError, TypeError):
                        pass
                    # 保存 done_data 供后续使用
                    break

                if chunk_type == "queue":
                    # 排队提示 → 推送给前端
                    yield {
                        "event": "queue",
                        "data": json.dumps({
                            "type": "queue",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                    continue

                if chunk_type == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "type": "error",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                    continue

                # 累积与推送
                if chunk_type == "thinking":
                    thinking_parts.append(delta)
                    yield {
                        "event": "thinking",
                        "data": json.dumps({
                            "type": "thinking_chunk",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                elif chunk_type == "status":
                    # 状态/进度信息
                    yield {
                        "event": "status",
                        "data": json.dumps({
                            "type": "status",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                elif chunk_type == "context":
                    # 上下文/Token 统计
                    yield {
                        "event": "context",
                        "data": json.dumps({
                            "type": "context",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                elif chunk_type == "tool_call":
                    yield {
                        "event": "tool_call",
                        "data": json.dumps({
                            "type": "tool_call",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                elif chunk_type == "tool_result":
                    yield {
                        "event": "tool_result",
                        "data": json.dumps({
                            "type": "tool_result",
                            "content": delta,
                        }, ensure_ascii=False),
                    }
                else:
                    content_parts.append(delta)
                    yield {
                        "event": "content",
                        "data": json.dumps({
                            "type": "content_chunk",
                            "content": delta,
                        }, ensure_ascii=False),
                    }

            # ── 7. 对话完成 → 持久化 Agent 消息 ──
            full_content = "".join(content_parts).strip()
            full_thinking = "".join(thinking_parts).strip() if thinking_parts else None

            # 优先使用 stream bridge 返回的结构化数据
            if done_data.get("content"):
                full_content = done_data["content"]
            if done_data.get("thinking"):
                full_thinking = done_data["thinking"]

            # 如果思考内容被包在 content 中 (模拟器的降级情况)，分离出来
            if not full_thinking and full_content:
                parsed = HermesCLIBridge.parse_think_tags(full_content)
                if parsed["thinking"]:
                    full_thinking = parsed["thinking"]
                    # 去掉正文中的 <think> 标签
                    full_content = (parsed["before"] + parsed["after"]).strip()

            if full_content or full_thinking:
                agent_msg = Message(
                    project_id=req.project_id,
                    sender_type=SenderType.AGENT,
                    sender_name="hermes-agent",
                    content=full_content or "(思考过程)",
                    thinking_content=full_thinking,
                )
                db.add(agent_msg)
                await db.commit()
                await db.refresh(agent_msg)

                # ── 8. 产出物检测：对比对话前后沙盒文件变化 ──
                post_snapshot = _snapshot_files(str(sandbox)) if sandbox.exists() else {}
                new_files = {
                    path: mtime for path, mtime in post_snapshot.items()
                    if path not in pre_snapshot or pre_snapshot[path] != mtime
                }
                # 过滤掉 attachments/ 中的上传文件（由用户上传，非产出）
                output_files = {
                    path: mtime for path, mtime in new_files.items()
                    if not path.startswith('attachments/')
                }
                for rel_path, _mtime in output_files.items():
                    # 检查是否已有该路径的 artifact（去重）
                    existing = (await db.execute(
                        select(Artifact).where(
                            Artifact.project_id == req.project_id,
                            Artifact.artifact_path == rel_path,
                        )
                    )).scalar_one_or_none()
                    if not existing:
                        ext = _os.path.splitext(rel_path)[1].lower()
                        title = _os.path.basename(rel_path)
                        db.add(Artifact(
                            project_id=req.project_id,
                            title=title,
                            content="",  # 文件内容从磁盘读取
                            file_type=ext.lstrip('.') or 'file',
                            artifact_path=rel_path,
                        ))
                await db.commit()
                if output_files:
                    logger.info(f"[Artifacts] 发现 {len(output_files)} 个新产出物: {list(output_files.keys())[:5]}")

                # 兼容旧的文本提取器（非文件型产出）
                await artifact_extractor.extract_and_save(db, req.project_id, full_content)

                yield {
                    "event": "done",
                    "data": json.dumps({
                        "type": "done",
                        "message_id": agent_msg.id,
                        "input_tokens": done_data.get("input_tokens", 0),
                        "output_tokens": done_data.get("output_tokens", 0),
                    }, ensure_ascii=False),
                }
            else:
                yield {
                    "event": "done",
                    "data": json.dumps({
                        "type": "done",
                        "message_id": None,
                    }, ensure_ascii=False),
                }

        except asyncio.CancelledError:
            # 客户端断开 → 清理 hermes 子进程
            logger.info("[SSE] 客户端断开，终止后台进程")
            if hasattr(bridge_instance, 'kill'):
                bridge_instance.kill()

        except Exception as e:
            logger.exception("[SSE] 流式对话异常")
            yield {
                "event": "error",
                "data": json.dumps({
                    "type": "error",
                    "content": str(e),
                }, ensure_ascii=False),
            }

    return EventSourceResponse(
        event_generator(),
        headers={
            # [Fix 5] 禁用各级缓冲 — 防止 nginx/proxy/浏览器缓存 SSE 流
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
        },
    )
