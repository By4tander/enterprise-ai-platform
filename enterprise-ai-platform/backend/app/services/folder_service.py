"""
文件夹服务 — 管理项目文件夹的共享技能目录和软链接

核心机制：
- 每个文件夹在 /storage/folders/{folder_id}/shared_skills/ 存放共享技能
- 项目移入文件夹时，在项目沙盒内创建 .hermes/skills/folder_shared → 共享目录的软链接
- Hermes 原生 Skill Loader 扫描 cwd/.hermes/skills/ 时，自动发现并加载文件夹共享技能
- 零魔改：完全利用 Hermes 原生机制，不修改任何 Hermes 源码
"""
import logging
import os
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class FolderService:
    def __init__(self):
        self.storage_root = Path(settings.PROJECT_STORAGE_ROOT)

    def get_folder_dir(self, folder_id: str) -> Path:
        """获取文件夹的存储根目录"""
        return self.storage_root / "folders" / f"folder_{folder_id}"

    def get_shared_skills_dir(self, folder_id: str) -> Path:
        """获取文件夹的共享技能目录"""
        return self.get_folder_dir(folder_id) / "shared_skills"

    def ensure_folder_dir(self, folder_id: str) -> Path:
        """确保文件夹目录和共享技能目录存在"""
        folder_dir = self.get_folder_dir(folder_id)
        folder_dir.mkdir(parents=True, exist_ok=True)
        shared = folder_dir / "shared_skills"
        shared.mkdir(exist_ok=True)
        return shared

    def mount_shared_skills(self, project_id: str, folder_id: str):
        """
        将文件夹的共享技能目录通过软链接挂载到项目的 .hermes/skills/folder_shared。

        Hermes 原生 Skill Loader 会扫描 cwd/.hermes/skills/ 下的所有子目录，
        因此创建软链接后，Hermes 自动发现并加载文件夹共享技能。
        """
        project_sandbox = self.storage_root / f"project_{project_id}"
        if not project_sandbox.exists():
            logger.warning(f"[FolderService] 项目沙盒不存在: {project_sandbox}")
            return

        # 确保 .hermes/skills/ 目录存在
        hermes_skills_dir = project_sandbox / ".hermes" / "skills"
        hermes_skills_dir.mkdir(parents=True, exist_ok=True)

        # 确保文件夹共享技能目录存在
        shared_dir = self.get_shared_skills_dir(folder_id)

        # 软链接路径
        link_path = hermes_skills_dir / "folder_shared"

        # 如果已有软链接，先移除
        if link_path.is_symlink():
            link_path.unlink()
        elif link_path.exists():
            # 如果存在同名实体目录（非软链接），跳过
            logger.warning(f"[FolderService] folder_shared 是实体目录，跳过软链接创建: {link_path}")
            return

        # 创建软链接：.hermes/skills/folder_shared → /storage/folders/folder_xxx/shared_skills/
        try:
            os.symlink(str(shared_dir), str(link_path))
            logger.info(f"[FolderService] 软链接创建成功: {link_path} -> {shared_dir}")
        except OSError as e:
            logger.error(f"[FolderService] 软链接创建失败: {e}")

    def remove_symlink(self, project_id: str, folder_id: str):
        """移除项目中的文件夹共享技能软链接"""
        project_sandbox = self.storage_root / f"project_{project_id}"
        link_path = project_sandbox / ".hermes" / "skills" / "folder_shared"

        if link_path.is_symlink():
            link_path.unlink()
            logger.info(f"[FolderService] 软链接已移除: {link_path}")

    def get_project_memory_files(self, folder_id: str) -> list[Path]:
        """获取文件夹内所有项目的 MEMORY.md 文件路径"""
        from app.models.project import Project
        # 这个方法需要在调用方传入 projects 列表，这里只是工具方法
        memory_files = []
        folder_dir = self.get_folder_dir(folder_id)
        # 扫描项目存储目录下属于该文件夹的项目
        for project_dir in self.storage_root.iterdir():
            if not project_dir.is_dir() or not project_dir.name.startswith("project_"):
                continue
            memory_file = project_dir / "memory" / "MEMORY.md"
            if memory_file.exists():
                memory_files.append(memory_file)
        return memory_files

    def rebuild_all_symlinks(self, folder_id: str, project_ids: list[str]):
        """重建文件夹内所有项目的软链接（用于修复或初始化）"""
        for pid in project_ids:
            self.mount_shared_skills(pid, folder_id)
