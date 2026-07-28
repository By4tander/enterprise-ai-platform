"""
并发控制模块 — Phase 3

使用 asyncio.Semaphore 限制同时运行的 Hermes 子进程数，
防止多用户并发对话时系统 CPU/RAM 过载。
"""
import asyncio
import logging
import time
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


class HermesConcurrencyManager:
    """
    Hermes CLI 子进程并发调度器

    特性：
    - asyncio.Semaphore 限制最大并发数
    - 查询当前活跃任务数与排队位置
    - 异步上下文管理器支持 (async with)

    用法:
        mgr = concurrency_manager
        async with mgr as position:
            if position > 0:
                yield_queue_event(position)
            # ... 执行 hermes 调用 ...
    """

    def __init__(self, max_concurrent: Optional[int] = None):
        self.max_concurrent = max_concurrent or getattr(
            settings, "MAX_CONCURRENT_HERMES", 4
        )
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        self._active_count = 0
        self._waiting_count = 0
        self._lock = asyncio.Lock()
        logger.info(f"[Concurrency] 最大并发: {self.max_concurrent}")

    async def acquire(self) -> int:
        """
        获取并发槽位。若当前无可用槽位，挂起等待。

        Returns:
            int: 前面排队的任务数 (0 = 无需等待立即执行, >0 = 需等待)
        """
        # 计算需要等待的任务数
        # active_jobs 是当前正在运行的任务数，它们占用了槽位
        # 如果 active_jobs >= max_concurrent，则新任务需要等待
        async with self._lock:
            ahead = max(0, self._active_count - self.max_concurrent + 1)
            self._waiting_count += 1

        if ahead > 0:
            logger.info(
                f"[Concurrency] 排队中 (前面约 {ahead} 个任务)... "
                f"活跃: {self._active_count}/{self.max_concurrent}"
            )

        await self._semaphore.acquire()

        async with self._lock:
            self._waiting_count -= 1
            self._active_count += 1

        return ahead

    def release(self):
        """释放并发槽位"""
        self._active_count = max(0, self._active_count - 1)
        self._semaphore.release()

    @property
    def active_jobs(self) -> int:
        """当前活跃任务数"""
        return self._active_count

    @property
    def waiting_jobs(self) -> int:
        """当前排队等待数"""
        return self._waiting_count

    @property
    def available_slots(self) -> int:
        """当前可用槽位数"""
        return max(0, self.max_concurrent - self._active_count)

    # ── 异步上下文管理器 ──

    async def __aenter__(self):
        self._ctx_position = await self.acquire()
        return self._ctx_position

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self.release()
        return False

    def __repr__(self):
        return (
            f"<HermesConcurrencyManager max={self.max_concurrent} "
            f"active={self._active_count} waiting={self._waiting_count}>"
        )


# ── 全局单例 ──
concurrency_manager = HermesConcurrencyManager()
