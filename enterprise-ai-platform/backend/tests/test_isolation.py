"""
Phase 3 — 并发隔离自动化测试套件

测试目标：
1. 多个用户同时对话时，沙盒目录独立、上下文不穿绕
2. 并发控制信号量排队机制正常工作
3. 异常情况下信号量正确释放
4. SessionIsolationEngine 路径校验与清理
"""
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

# 将 backend 路径加入 Python 搜索路径
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.session_isolation import SessionIsolationEngine
from app.core.concurrency import HermesConcurrencyManager


# ════════════════════════════════════════════════════════════════════
#  Fixtures
# ════════════════════════════════════════════════════════════════════

@pytest.fixture
def temp_storage_dir():
    """创建临时存储目录，测试后自动清理"""
    tmp = tempfile.mkdtemp(prefix="test_isolation_")
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def isolation_engine(temp_storage_dir):
    """创建 SessionIsolationEngine 实例"""
    return SessionIsolationEngine(base_storage_dir=temp_storage_dir)


# ════════════════════════════════════════════════════════════════════
#  SessionIsolationEngine 测试
# ════════════════════════════════════════════════════════════════════

class TestSessionIsolation:
    """沙盒隔离引擎单元测试"""

    def test_create_sandbox(self, isolation_engine):
        """测试沙盒目录创建及子目录结构"""
        sandbox = isolation_engine.get_project_sandbox("test-project-001")
        assert sandbox.exists()
        assert (sandbox / "memory").exists()
        assert (sandbox / "outputs").exists()

    def test_isolation_env_vars(self, isolation_engine):
        """测试隔离环境变量包含所有必要键"""
        env = isolation_engine.get_isolation_env("proj-env-001")
        assert env["HERMES_PROJECT_ID"] == "proj-env-001"
        assert env["HERMES_NO_GLOBAL_MEMORY"] == "1"
        assert "HERMES_MEMORY_DIR" in env
        assert "HERMES_OUTPUT_DIR" in env
        assert "HERMES_STORAGE_DIR" in env

    def test_sandbox_independence(self, isolation_engine):
        """测试不同项目沙盒路径完全独立"""
        sandbox_a = isolation_engine.get_project_sandbox("project-A")
        sandbox_b = isolation_engine.get_project_sandbox("project-B")

        assert sandbox_a != sandbox_b
        assert str(sandbox_a) != str(sandbox_b)

        # 在 A 中创建文件，B 中不应存在
        (sandbox_a / "memory" / "test.txt").write_text("data from A")
        assert not (sandbox_b / "memory" / "test.txt").exists()

    def test_cleanup_sandbox(self, isolation_engine):
        """测试沙盒清理"""
        sandbox = isolation_engine.get_project_sandbox("to-clean-001")
        assert sandbox.exists()

        isolation_engine.cleanup_sandbox("to-clean-001")
        assert not sandbox.exists()

    def test_cleanup_nonexistent_no_error(self, isolation_engine):
        """清理不存在的沙盒不应报错"""
        isolation_engine.cleanup_sandbox("nonexistent-project")

    def test_list_sandboxes(self, isolation_engine):
        """测试列出所有沙盒"""
        isolation_engine.get_project_sandbox("proj-1")
        isolation_engine.get_project_sandbox("proj-2")
        isolation_engine.get_project_sandbox("proj-3")

        boxes = isolation_engine.list_sandboxes()
        assert len(boxes) == 3

    # ── 路径穿越攻击测试 ──

    def test_reject_path_traversal_dotdot(self, isolation_engine):
        """测试拒绝 ../ 路径穿越"""
        with pytest.raises(ValueError, match="非法路径字符"):
            isolation_engine.get_project_sandbox("../../../etc/passwd")

    def test_reject_special_chars(self, isolation_engine):
        """测试拒绝特殊字符 ID"""
        with pytest.raises(ValueError, match="非法字符"):
            isolation_engine.get_project_sandbox("test; rm -rf /")

    def test_reject_empty_id(self, isolation_engine):
        """测试拒绝空 ID"""
        with pytest.raises(ValueError):
            isolation_engine.get_project_sandbox("")

    def test_reject_too_long_id(self, isolation_engine):
        """测试拒绝过长 ID"""
        with pytest.raises(ValueError, match="过长"):
            isolation_engine.get_project_sandbox("a" * 200)


# ════════════════════════════════════════════════════════════════════
#  HermesConcurrencyManager 测试
# ════════════════════════════════════════════════════════════════════

class TestConcurrencyManager:
    """并发控制管理器测试"""

    def test_initial_state(self):
        """测试初始状态"""
        mgr = HermesConcurrencyManager(max_concurrent=4)
        assert mgr.active_jobs == 0
        assert mgr.waiting_jobs == 0
        assert mgr.available_slots == 4

    def test_acquire_release(self):
        """测试基本的获取与释放"""
        mgr = HermesConcurrencyManager(max_concurrent=2)

        async def worker():
            pos = await mgr.acquire()
            await asyncio.sleep(0.01)
            mgr.release()
            return pos

        pos = asyncio.run(worker())
        assert pos == 0  # 第一个任务立即执行

    @pytest.mark.asyncio
    async def test_concurrent_limit(self):
        """测试并发限制：第3个任务应排队"""
        mgr = HermesConcurrencyManager(max_concurrent=2)

        results = []

        async def worker(task_id: int):
            pos = await mgr.acquire()
            results.append((task_id, pos))
            await asyncio.sleep(0.05)
            mgr.release()

        # 同时启动 4 个任务
        tasks = [asyncio.create_task(worker(i)) for i in range(4)]
        await asyncio.gather(*tasks)

        # 前 2 个应该立即执行 (position=0)，后 2 个应该排队 (position>0)
        positions = [r[1] for r in sorted(results)]
        assert positions[0] == 0
        assert positions[1] == 0
        assert positions[2] > 0  # 需要排队
        assert positions[3] > 0  # 需要排队

    @pytest.mark.asyncio
    async def test_semaphore_release_on_exception(self):
        """测试异常时信号量也会被释放"""
        mgr = HermesConcurrencyManager(max_concurrent=1)

        async def faulty_worker():
            await mgr.acquire()
            try:
                raise RuntimeError("模拟崩溃")
            finally:
                mgr.release()

        try:
            await faulty_worker()
        except RuntimeError:
            pass  # 预期异常

        # 异常发生后，信号量应被释放，下一个任务可立即获取
        assert mgr.active_jobs == 0
        assert mgr.available_slots == 1

        async def normal_worker():
            pos = await mgr.acquire()
            mgr.release()
            return pos

        pos = await normal_worker()
        assert pos == 0  # 应立即执行，不需要排队

    @pytest.mark.asyncio
    async def test_context_manager(self):
        """测试 async with 上下文管理器"""
        mgr = HermesConcurrencyManager(max_concurrent=2)

        async with mgr as pos:
            assert pos == 0
            assert mgr.active_jobs == 1

        assert mgr.active_jobs == 0

    @pytest.mark.asyncio
    async def test_high_concurrency_queue(self):
        """高并发压力测试：20 个任务抢 4 个槽位"""
        mgr = HermesConcurrencyManager(max_concurrent=4)
        completed = []

        async def worker(i: int):
            pos = await mgr.acquire()
            completed.append(i)
            # 模拟工作
            await asyncio.sleep(0.01)
            mgr.release()

        tasks = [asyncio.create_task(worker(i)) for i in range(20)]
        await asyncio.gather(*tasks)

        assert len(completed) == 20
        assert mgr.active_jobs == 0
        assert mgr.waiting_jobs == 0


# ════════════════════════════════════════════════════════════════════
#  集成测试：并发隔离
# ════════════════════════════════════════════════════════════════════

class TestIsolationIntegration:
    """并发 + 隔离集成测试"""

    @pytest.mark.asyncio
    async def test_concurrent_projects_isolation(self, temp_storage_dir):
        """模拟编剧 A(项目1) 与编剧 B(项目2) 同时对话，验证沙盒独立"""
        engine = SessionIsolationEngine(base_storage_dir=temp_storage_dir)
        mgr = HermesConcurrencyManager(max_concurrent=4)

        results = {}

        async def simulate_chat(project_id: str, user: str, message: str):
            async with mgr:
                sandbox = engine.get_project_sandbox(project_id)
                # 模拟在沙盒中写入工作文件
                work_file = sandbox / "memory" / "last_prompt.txt"
                work_file.write_text(message)

                # 模拟读取（通常由 hermes CLI 完成）
                results[(user, project_id)] = {
                    "sandbox": str(sandbox),
                    "message": message,
                    "read_back": work_file.read_text(),
                }

        # 两个用户同时对话
        await asyncio.gather(
            simulate_chat("proj-editor-A", "writer_zhang", "写一段爱情剧本"),
            simulate_chat("proj-editor-B", "writer_li", "写一段悬疑剧本"),
        )

        # 验证两个沙盒完全独立
        a = results[("writer_zhang", "proj-editor-A")]
        b = results[("writer_li", "proj-editor-B")]

        assert a["sandbox"] != b["sandbox"]
        assert a["message"] != b["message"]
        assert a["read_back"] == "写一段爱情剧本"
        assert b["read_back"] == "写一段悬疑剧本"


# ════════════════════════════════════════════════════════════════════
#  main
# ════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
