"""
后台对话任务管理器 — 简化版

使用 list buffer 而非 asyncio.Queue，避免 chunk 丢失。
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional, AsyncGenerator, Dict

logger = logging.getLogger(__name__)

_chat_tasks: Dict[str, "ChatBackgroundTask"] = {}


class ChatBackgroundTask:
    """后台对话任务 — 使用 list buffer"""

    def __init__(self, project_id: str, user_id: str):
        self.project_id = project_id
        self.user_id = user_id
        self.status = "running"
        self.chunks: list[tuple[str, str]] = []  # list of (event_type, data)
        self.full_content = ""
        self.full_thinking = ""
        self.message_id: Optional[str] = None
        self.started_at = datetime.now(timezone.utc)
        self.completed_at: Optional[datetime] = None
        self.error: Optional[str] = None
        self._done_event = asyncio.Event()
        self._new_chunk = asyncio.Event()

    def push(self, event_type: str, data: str):
        self.chunks.append((event_type, data))
        self._new_chunk.set()
        self._new_chunk = asyncio.Event()  # reset for next notification

    async def wait_for_new(self, timeout: float = 1.0) -> list[tuple[str, str]]:
        """Wait for new chunks and return all since last read, or return empty on timeout."""
        try:
            await asyncio.wait_for(self._new_chunk.wait(), timeout)
        except asyncio.TimeoutError:
            return []
        return []

    def mark_done(self, message_id: Optional[str] = None):
        self.status = "done"
        self.message_id = message_id
        self.completed_at = datetime.now(timezone.utc)
        self.push("__done__", json.dumps({"message_id": message_id}))
        self._done_event.set()

    def mark_error(self, error: str):
        self.status = "error"
        self.error = error
        self.completed_at = datetime.now(timezone.utc)
        self.push("__error__", error)
        self._done_event.set()

    def to_status(self) -> dict:
        return {
            "project_id": self.project_id,
            "status": self.status,
            "chunk_count": len(self.chunks),
            "started_at": self.started_at.isoformat(),
            "error": self.error,
        }


def register_task(task: ChatBackgroundTask):
    prev = _chat_tasks.get(task.project_id)
    if prev and prev.status == "running":
        logger.warning(f"[BgTask] 替换运行中任务: {task.project_id}")
    _chat_tasks[task.project_id] = task


def get_task(project_id: str) -> Optional[ChatBackgroundTask]:
    return _chat_tasks.get(project_id)


def remove_task(project_id: str):
    _chat_tasks.pop(project_id, None)


async def stream_resume(task: ChatBackgroundTask, start_idx: int = 0) -> AsyncGenerator[tuple[str, str], None]:
    """
    从 start_idx 开始重放 + 继续流式推送。
    不消费 chunks，只是从 list 读取。
    """
    last_idx = max(start_idx, 0)
    while True:
        # Yield any new chunks since last read
        while last_idx < len(task.chunks):
            event, data = task.chunks[last_idx]
            last_idx += 1
            if event == "__done__":
                yield ("done", data)
                return
            elif event == "__error__":
                yield ("error", json.dumps({"type": "error", "content": data}))
                return
            else:
                yield (event, data)

        # Check if done
        if task.status != "running":
            if task.status == "done":
                yield ("done", json.dumps({"type": "done", "message_id": task.message_id, "_resumed": True}))
            elif task.status == "error":
                yield ("error", json.dumps({"type": "error", "content": task.error, "_resumed": True}))
            return

        # Wait for new chunks
        await asyncio.sleep(0.5)
