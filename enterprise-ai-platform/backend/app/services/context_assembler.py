"""
上下文拼装器 — 三层叠加策略

在发起 Hermes 对话前，自动从数据库提取并拼装完整的 System Prompt：
  Layer 1: 全局激活的 Global Skills（全公司共享 SOP）
  Layer 2: 当前部门激活的 Department Skills（部门私有记忆）
  Layer 3: 当前项目历史 Memory/Context（最近 N 轮对话 + 项目专属指令）
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.message import Message
from app.models.skill import DepartmentSkill

logger = logging.getLogger(__name__)


class ContextAssembler:
    """
    上下文拼装服务 — 三层叠加策略

    System Prompt = [Global Skills] + [Department Skills] + [Project Context]
    """

    MAX_HISTORY_MESSAGES = 40  # 最多带入最近 40 条消息

    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.project_id = project_id

    async def assemble_prompt(self, user_input: str) -> str:
        """
        拼装完整的 Prompt（三层叠加）

        Returns:
            str: Global Skills + Department Skills + Project Context + 用户输入
        """
        project = await self.db.get(Project, self.project_id)
        if project is None:
            logger.warning(f"[ContextAssembler] 项目 {self.project_id} 不存在")
            return user_input

        parts = []

        # ── Layer 1: 全局 Global Skills ──
        global_skills_prompt = await self._get_global_skills_prompt(user_input)
        if global_skills_prompt:
            parts.append(global_skills_prompt)

        # ── Layer 2: 部门 Department Skills ──
        if project.department_id:
            dept_skills_prompt = await self._get_department_skills_prompt(
                project.department_id, user_input
            )
            if dept_skills_prompt:
                parts.append(dept_skills_prompt)

        # ── Layer 3: 项目专属指令 + 历史上下文 ──
        if project.system_prompt_override:
            parts.append(f"## 项目专属指令\n{project.system_prompt_override}")

        history_prompt = await self._get_history_context()
        if history_prompt:
            parts.append(history_prompt)

        # ── 用户当前输入 ──
        parts.append(f"## 当前任务\n{user_input}")

        full_prompt = "\n\n".join(parts)
        logger.debug(
            f"[ContextAssembler] 三层拼装完成, 总长度: {len(full_prompt)} 字符 "
            f"(global={bool(global_skills_prompt)}, dept={bool(project.department_id)})"
        )
        return full_prompt

    async def _get_global_skills_prompt(self, user_input: str = "") -> str | None:
        """Layer 1: 获取全局已批准的 Global Skills"""
        result = await self.db.execute(
            select(DepartmentSkill)
            .where(
                DepartmentSkill.scope == "global",
                DepartmentSkill.is_approved == True,
            )
            .order_by(DepartmentSkill.rating.desc())
        )
        all_skills = result.scalars().all()

        if not all_skills:
            return None

        # 关键词匹配 + auto_inject
        selected = self._match_skills(all_skills, user_input, max_count=8)
        if not selected:
            return None

        skill_texts = []
        for i, skill in enumerate(selected, 1):
            skill_texts.append(f"### ⚡ {i}. {skill.skill_name}\n{skill.content_prompt}")
            skill.usage_count += 1

        await self.db.commit()

        header = "## 全局核心技能（全公司共享 SOP）\n以下是你必须遵循的平台级核心能力与规范：\n"
        return header + "\n\n".join(skill_texts)

    async def _get_department_skills_prompt(self, department_id: str, user_input: str = "") -> str | None:
        """Layer 2: 获取部门已批准的 Department Skills"""
        result = await self.db.execute(
            select(DepartmentSkill)
            .where(
                DepartmentSkill.scope == "department",
                DepartmentSkill.department_id == department_id,
                DepartmentSkill.is_approved == True,
            )
            .order_by(DepartmentSkill.rating.desc())
        )
        all_skills = result.scalars().all()

        if not all_skills:
            return None

        selected = self._match_skills(all_skills, user_input, max_count=10)
        if not selected:
            return None

        skill_texts = []
        for i, skill in enumerate(selected, 1):
            match_tag = "🔍" if self._is_keyword_match(skill, user_input) else "⚙️"
            skill_texts.append(f"### {match_tag} {i}. {skill.skill_name}\n{skill.content_prompt}")
            skill.usage_count += 1

        await self.db.commit()

        header = "## 部门公共技能与记忆\n以下是你需要遵循的部门共享 SOP 和最佳实践：\n"
        return header + "\n\n".join(skill_texts)

    def _match_skills(self, skills: list, user_input: str, max_count: int = 10) -> list:
        """通用技能匹配：关键词匹配优先，然后 auto_inject 补充"""
        keyword_matched = []
        auto_inject_skills = []

        if user_input:
            for skill in skills:
                if self._is_keyword_match(skill, user_input):
                    keyword_matched.append(skill)
                elif skill.auto_inject:
                    auto_inject_skills.append(skill)
        else:
            auto_inject_skills = [s for s in skills if s.auto_inject]

        selected = keyword_matched[:max_count] + auto_inject_skills[:5]
        # 去重
        seen = set()
        unique = []
        for s in selected:
            if s.id not in seen:
                seen.add(s.id)
                unique.append(s)
        return unique[:max_count]

    @staticmethod
    def _is_keyword_match(skill, user_input: str) -> bool:
        """检查技能是否与用户输入关键词匹配"""
        if not user_input:
            return False
        input_lower = user_input.lower()
        name_match = skill.skill_name.lower() in input_lower or any(
            word in input_lower for word in skill.skill_name.lower().split()
        )
        category_match = skill.category and skill.category.lower() in input_lower
        return name_match or category_match

    async def _get_history_context(self) -> str | None:
        """Layer 3: 获取项目最近 N 轮对话历史"""
        result = await self.db.execute(
            select(Message)
            .where(Message.project_id == self.project_id)
            .order_by(Message.timestamp.desc())
            .limit(self.MAX_HISTORY_MESSAGES)
        )
        messages = result.scalars().all()

        if not messages:
            return None

        messages = list(reversed(messages))
        history_lines = ["## 对话历史"]
        for msg in messages:
            role = "用户" if msg.sender_type.value == "user" else "Agent"
            history_lines.append(f"**{role}**: {msg.content}")

        return "\n".join(history_lines)
