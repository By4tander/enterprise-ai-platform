"""
运行时会话隔离引擎 — Phase 3 重构版

为每个 project_id 创建独立沙盒目录，防止 Hermes 跨项目数据污染。
支持路径规范化、防穿越校验、以及归档后安全清理。
"""
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# 危险的路径穿越模式
_DANGEROUS_PATHS = re.compile(r'\.\./|\.\.\\|/\\.\\.|\\\\')


class SessionIsolationEngine:
    """
    会话隔离引擎

    职责：
    1. 为每个 project_id 创建独立的沙盒工作目录
    2. 沙盒内含 `memory/` (隔离记忆) 和 `outputs/` (产出文件) 子目录
    3. 生成隔离环境变量，强制 Hermes 不使用全局配置
    4. 路径防穿越校验
    5. 归档后安全清理
    """

    def __init__(self, base_storage_dir: Optional[str] = None):
        self.base_dir = Path(base_storage_dir or settings.PROJECT_STORAGE_ROOT)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[Isolation] 存储根目录: {self.base_dir}")

    def get_project_sandbox(self, project_id: str) -> Path:
        """
        获取或创建项目的独立隔离沙盒目录。

        Args:
            project_id: 项目 UUID 字符串

        Returns:
            Path: 沙盒目录的绝对路径

        Raises:
            ValueError: 如果 project_id 包含非法字符（路径穿越）
        """
        self._validate_project_id(project_id)

        project_dir = self.base_dir / f"project_{project_id}"
        project_dir.mkdir(parents=True, exist_ok=True)

        # 创建子目录
        (project_dir / "memory").mkdir(exist_ok=True)
        (project_dir / "outputs").mkdir(exist_ok=True)

        logger.debug(f"[Isolation] 沙盒就绪: {project_dir}")
        return project_dir

    def get_isolation_env(self, project_id: str) -> dict[str, str]:
        """
        生成隔离环境变量集，强制 Hermes 使用项目沙盒而非全局配置。

        关键变量：
        - HERMES_PROJECT_ID: 当前项目 ID
        - HERMES_STORAGE_DIR: 沙盒根目录
        - HERMES_MEMORY_DIR: 沙盒内的 memory 子目录
        - HERMES_OUTPUT_DIR: 沙盒内的 outputs 子目录
        - HERMES_NO_GLOBAL_MEMORY: 禁用全局记忆读取
        """
        sandbox = self.get_project_sandbox(project_id)

        return {
            "HERMES_PROJECT_ID": project_id,
            "HERMES_STORAGE_DIR": str(sandbox),
            "HERMES_MEMORY_DIR": str(sandbox / "memory"),
            "HERMES_OUTPUT_DIR": str(sandbox / "outputs"),
            "HERMES_NO_GLOBAL_MEMORY": "1",
            "HERMES_CONFIG_OVERRIDE": str(sandbox / ".hermes_config"),
        }

    def get_memory_dir(self, project_id: str) -> Path:
        """获取项目隔离记忆目录"""
        sandbox = self.get_project_sandbox(project_id)
        return sandbox / "memory"

    def get_output_dir(self, project_id: str) -> Path:
        """获取项目产出目录"""
        sandbox = self.get_project_sandbox(project_id)
        return sandbox / "outputs"

    def cleanup_sandbox(self, project_id: str):
        """
        归档或删除项目时，安全移除沙盒目录。

        Args:
            project_id: 项目 ID
        """
        self._validate_project_id(project_id)
        project_dir = self.base_dir / f"project_{project_id}"

        if project_dir.exists():
            try:
                shutil.rmtree(project_dir)
                logger.info(f"[Isolation] 已清理沙盒: {project_dir}")
            except Exception as e:
                logger.error(f"[Isolation] 清理沙盒失败: {project_dir}, 原因: {e}")
        else:
            logger.debug(f"[Isolation] 沙盒不存在，无需清理: {project_dir}")

    def list_sandboxes(self) -> list[Path]:
        """列出所有现有的沙盒目录"""
        if not self.base_dir.exists():
            return []
        return sorted(
            [d for d in self.base_dir.iterdir() if d.is_dir() and d.name.startswith("project_")]
        )

    # ── 内部方法 ──

    @staticmethod
    def _validate_project_id(project_id: str):
        """
        校验 project_id 是否合法。
        防止路径穿越注入（如 ../../etc/passwd）。
        """
        if not project_id or not isinstance(project_id, str):
            raise ValueError(f"非法 project_id: {project_id}")

        # 检查是否包含路径穿越字符
        if _DANGEROUS_PATHS.search(project_id):
            raise ValueError(f"project_id 包含非法路径字符: {project_id}")

        # 检查长度（UUID 通常是 36 字符）
        if len(project_id) > 128:
            raise ValueError(f"project_id 过长: {len(project_id)} 字符")

        # 仅允许字母数字、连字符和下划线
        if not re.match(r'^[a-zA-Z0-9\-_]+$', project_id):
            raise ValueError(f"project_id 包含非法字符: {project_id}")

    def __repr__(self):
        sandboxes = len(self.list_sandboxes())
        return f"<SessionIsolationEngine base={self.base_dir} sandboxes={sandboxes}>"
