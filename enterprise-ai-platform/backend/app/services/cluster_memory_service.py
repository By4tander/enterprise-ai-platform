"""
集群记忆服务 — 利用 Hermes 原生 CLI 提炼跨项目技能

核心流程：
1. 收集文件夹内所有项目的 MEMORY.md 和对话记录
2. 将所有记忆写入一个临时汇总文件
3. 调用 Hermes CLI（以该汇总文件所在目录为 cwd），让它提炼跨项目 SOP
4. Hermes 输出的技能文件自动存入文件夹的 shared_skills/ 目录
5. 软链接自动让文件夹内所有项目可加载这些技能

零魔改：完全通过 Hermes CLI 子进程调用，不修改 Hermes 任何源码。
"""
import logging
import json
from pathlib import Path
from datetime import datetime

from app.config import settings

logger = logging.getLogger(__name__)


class ClusterMemoryService:
    def __init__(self):
        self.storage_root = Path(settings.PROJECT_STORAGE_ROOT)
        self.hermes_cli = settings.HERMES_CLI_PATH

    async def distill_folder(self, folder_id: str, db) -> dict:
        """
        执行文件夹集群记忆归档。

        Args:
            folder_id: 文件夹 ID
            db: 数据库会话

        Returns:
            dict: { "skills": [{"name": str, "path": str}] }
        """
        from app.models.project import Project
        from sqlalchemy import select
        from app.services.folder_service import FolderService

        folder_svc = FolderService()
        shared_skills_dir = folder_svc.get_shared_skills_dir(folder_id)
        shared_skills_dir.mkdir(parents=True, exist_ok=True)

        # 1. 获取文件夹内所有项目
        result = await db.execute(
            select(Project).where(
                Project.folder_id == folder_id,
                Project.status == "active"
            )
        )
        projects = result.scalars().all()

        if not projects:
            return {"skills": [], "message": "文件夹内没有活跃项目"}

        # 2. 收集所有项目的记忆
        memories = []
        for proj in projects:
            project_dir = self.storage_root / f"project_{proj.id}"
            memory_file = project_dir / "memory" / "MEMORY.md"
            if memory_file.exists():
                content = memory_file.read_text(encoding="utf-8", errors="replace")
                memories.append(f"## 项目: {proj.name}\n\n{content}")

            # 也收集对话记录摘要（最近 20 条消息）
            messages_dir = project_dir / "outputs"
            # 从数据库获取消息
            from app.models.message import Message
            msg_result = await db.execute(
                select(Message)
                .where(Message.project_id == proj.id)
                .order_by(Message.timestamp.desc())
                .limit(20)
            )
            msgs = msg_result.scalars().all()
            if msgs:
                msg_summary = []
                for m in reversed(msgs):
                    role = "用户" if m.sender_type.value == "user" else "AI"
                    content = m.content[:200] + "..." if len(m.content) > 200 else m.content
                    msg_summary.append(f"[{role}]: {content}")
                memories.append(f"### {proj.name} 最近对话:\n" + "\n".join(msg_summary))

        if not memories:
            return {"skills": [], "message": "没有可分析的记忆数据"}

        # 3. 写入汇总文件到文件夹目录
        folder_dir = folder_svc.get_folder_dir(folder_id)
        folder_dir.mkdir(parents=True, exist_ok=True)

        summary_file = folder_dir / "cluster_memory_summary.md"
        summary_content = f"""# 文件夹集群记忆汇总
生成时间: {datetime.now().isoformat()}
项目数量: {len(projects)}

{"".join(memories)}
"""
        summary_file.write_text(summary_content, encoding="utf-8")

        # 4. 调用 Hermes CLI 提炼技能
        prompt = """请分析当前目录下的 cluster_memory_summary.md 文件，该文件包含多个项目的记忆和对话记录。

你的任务是：
1. 识别跨项目的通用规律、SOP、最佳实践
2. 将提炼出的知识按照 Hermes Skill 规范写入 ./shared_skills/ 目录
3. 每个技能一个 .md 文件，包含 YAML frontmatter（name, description, category）和 markdown 正文
4. 技能名称使用英文小写下划线格式
5. 最多提炼 5 个最有价值的技能

请开始分析并生成技能文件。"""

        skills_generated = await self._run_hermes_cli(
            cwd=str(folder_dir),
            prompt=prompt,
        )

        # 5. 扫描生成的技能文件
        generated = []
        if shared_skills_dir.exists():
            for f in shared_skills_dir.iterdir():
                if f.suffix == ".md" and f.name != "cluster_memory_summary.md":
                    generated.append({"name": f.stem, "path": str(f)})

        # 6. 重建所有项目的软链接
        project_ids = [p.id for p in projects]
        folder_svc.rebuild_all_symlinks(folder_id, project_ids)

        return {
            "skills": generated,
            "projects_analyzed": len(projects),
            "memories_collected": len(memories),
        }

    async def _run_hermes_cli(self, cwd: str, prompt: str) -> str:
        """
        以子进程方式调用 Hermes CLI。

        Args:
            cwd: 工作目录（Hermes 在此目录执行）
            prompt: 要执行的指令

        Returns:
            str: Hermes 的输出
        """
        import asyncio

        env = {
            "HOME": str(Path.home()),
            "PATH": os.environ.get("PATH", ""),
            "TERM": "dumb",
        }

        # 移除代理设置，避免影响 DeepSeek API 调用
        for key in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]:
            env.pop(key, None)

        try:
            proc = await asyncio.create_subprocess_exec(
                self.hermes_cli, "-p", prompt,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

            output = stdout.decode("utf-8", errors="replace")
            if proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace")
                logger.warning(f"[ClusterMemory] Hermes CLI 返回非零: {proc.returncode}\nstderr: {err}")

            return output

        except asyncio.TimeoutError:
            logger.error("[ClusterMemory] Hermes CLI 超时 (300s)")
            return ""
        except FileNotFoundError:
            logger.error(f"[ClusterMemory] Hermes CLI 未找到: {self.hermes_cli}")
            return ""


import os
