"""
上下文拼装器

在发起 Hermes 对话前，自动从数据库提取并拼装完整的 System Prompt，
包括：部门公共技能/记忆 + 项目历史上下文 + 用户最新输入
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
    上下文拼装服务

    拼装优先级：
    1. 部门已批准且标记为 auto_inject 的公共技能（System Prompt）
    2. 项目特有的 System Prompt Override（项目级别覆盖）
    3. 项目历史对话上下文（最近 N 轮）
    4. 用户最新输入
    """

    MAX_HISTORY_MESSAGES = 40  # 最多带入最近 40 条消息

    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.project_id = project_id

    async def assemble_prompt(self, user_input: str) -> str:
        """
        拼装完整的 Prompt

        Returns:
            str: 包含 System Prompt + 历史上下文 + 用户输入的完整 Prompt
        """
        # 1. 获取项目信息
        project = await self.db.get(Project, self.project_id)
        if project is None:
            logger.warning(f"[ContextAssembler] 项目 {self.project_id} 不存在")
            return user_input

        parts = []

        # 2. 拼装部门公共技能/记忆（关键词匹配 + auto_inject）
        dept_skills_prompt = await self._get_department_skills_prompt(
            project.department_id, user_input
        )
        if dept_skills_prompt:
            parts.append(dept_skills_prompt)

        # 3. 项目特有 System Prompt（覆盖/追加）
        if project.system_prompt_override:
            parts.append(f"## 项目专属指令\n{project.system_prompt_override}")

        # 4. 项目历史对话上下文
        history_prompt = await self._get_history_context()
        if history_prompt:
            parts.append(history_prompt)

        # 5. 用户当前输入
        parts.append(f"## 当前任务\n{user_input}")

        full_prompt = "\n\n".join(parts)
        logger.debug(f"[ContextAssembler] 拼装完成, 总长度: {len(full_prompt)} 字符")
        return full_prompt

    async def _get_department_skills_prompt(self, department_id: str, user_input: str = "") -> str | None:
        """获取部门已批准技能。优先关键词匹配 → 回退 auto_inject"""
        result = await self.db.execute(
            select(DepartmentSkill)
            .where(
                DepartmentSkill.department_id == department_id,
                DepartmentSkill.is_approved == True,
            )
            .order_by(DepartmentSkill.rating.desc())
        )
        all_skills = result.scalars().all()

        if not all_skills:
            return None

        # ── 关键词匹配 ──
        keyword_matched: list[DepartmentSkill] = []
        auto_inject_skills: list[DepartmentSkill] = []

        if user_input:
            input_lower = user_input.lower()
            for skill in all_skills:
                # 检查 skill_name, category, content_prompt 是否匹配
                name_match = skill.skill_name.lower() in input_lower or any(
                    word in input_lower for word in skill.skill_name.lower().split()
                )
                category_match = skill.category and skill.category.lower() in input_lower
                content_match = any(
                    word in skill.content_prompt.lower()
                    for word in input_lower.split()
                    if len(word) >= 2
                )

                if name_match or category_match:
                    keyword_matched.append(skill)
                elif skill.auto_inject:
                    auto_inject_skills.append(skill)
        else:
            auto_inject_skills = [s for s in all_skills if s.auto_inject]

        # 合并：关键词匹配优先，然后 auto_inject
        selected = keyword_matched[:8] + auto_inject_skills[:5]
        # 去重
        seen = set()
        unique = []
        for s in selected:
            if s.id not in seen:
                seen.add(s.id)
                unique.append(s)
        selected = unique[:10]

        if not selected:
            return None

        skill_texts = []
        for i, skill in enumerate(selected, 1):
            match_tag = "🔍" if skill in keyword_matched else "⚙️"
            skill_texts.append(
                f"### {match_tag} {i}. {skill.skill_name}\n{skill.content_prompt}"
            )
            skill.usage_count += 1

        await self.db.commit()

        header = "## 部门公共技能与记忆\n以下是你需要遵循的部门共享 SOP 和最佳实践：\n"
        return header + "\n\n".join(skill_texts)

    async def _get_history_context(self) -> str | None:
        """获取项目最近 N 轮对话历史"""
        result = await self.db.execute(
            select(Message)
            .where(Message.project_id == self.project_id)
            .order_by(Message.timestamp.desc())
            .limit(self.MAX_HISTORY_MESSAGES)
        )
        messages = result.scalars().all()

        if not messages:
            return None

        # 按时间正序排列
        messages = list(reversed(messages))

        history_lines = ["## 对话历史"]
        for msg in messages:
            role = "用户" if msg.sender_type.value == "user" else "Agent"
            history_lines.append(f"**{role}**: {msg.content}")

        return "\n".join(history_lines)
