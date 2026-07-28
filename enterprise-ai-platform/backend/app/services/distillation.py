"""
记忆提炼与技能沉淀服务

在项目结案归档时，通过 LLM 自动分析项目对话日志与产出物，
提炼出可复用的高效指令、工作流与模板，存入 department_skills 表。
"""
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.project import Project
from app.models.message import Message
from app.models.artifact import Artifact
from app.models.skill import DepartmentSkill
from app.schemas.skill import SkillDistillationResult, SkillOut

logger = logging.getLogger(__name__)


DISTILLATION_SYSTEM_PROMPT = """你是一个知识提炼专家。你的任务是从一个已完成的 AI 协作项目中，提取可复用的技能、模板和最佳实践。

请分析以下项目对话历史和产出物，找出：

1. **高效指令模式**：用户在项目中使用了哪些特别有效的 Prompt 或指令组合？
2. **工作流模板**：项目中形成了哪些可复用的工作流程？请总结为 SOP。
3. **领域知识沉淀**：项目中积累了什么领域特定的知识、术语、规范？
4. **踩坑经验**：项目中遇到了什么问题？是如何解决的？

请输出 JSON 格式，包含：
{
  "skills": [
    {
      "skill_name": "技能名称（简洁明了）",
      "category": "分类标签（如：剧本大纲/代码模板/美术风格/部署流程）",
      "content_prompt": "详细的 Prompt 模板或 SOP 内容",
      "rating": 3.0-5.0 的推荐评分
    }
  ],
  "summary": "整体提炼总结（2-3句话）"
}

只输出 JSON，不要输出其他内容。"""


class DistillationService:
    """
    项目结案技能提炼服务

    流程：
    1. 读取项目所有对话和产出物
    2. 调用 LLM 进行提炼
    3. 结构化存储到 department_skills 表
    """

    async def distill_project(
        self, project_id: str, db: AsyncSession
    ) -> SkillDistillationResult:
        """
        对指定项目执行技能提炼

        Returns:
            SkillDistillationResult: 提炼结果
        """
        # 1. 获取项目信息
        project = await db.get(Project, project_id)
        if project is None:
            raise ValueError(f"项目 {project_id} 不存在")

        # 2. 收集所有对话消息
        messages_result = await db.execute(
            select(Message)
            .where(Message.project_id == project_id)
            .order_by(Message.timestamp.asc())
        )
        messages = messages_result.scalars().all()

        # 3. 收集所有产出物
        artifacts_result = await db.execute(
            select(Artifact)
            .where(Artifact.project_id == project_id)
            .order_by(Artifact.created_at.asc())
        )
        artifacts = artifacts_result.scalars().all()

        # 4. 构建提炼请求
        conversation_text = "\n".join([
            f"[{m.sender_type.value}] {m.content[:2000]}"
            for m in messages
        ])
        artifacts_text = "\n\n".join([
            f"### {a.title} ({a.file_type})\n{a.content[:2000]}"
            for a in artifacts
        ])

        distillation_input = f"""## 项目名称
{project.name}

## 项目描述
{project.description or '无'}

## 对话历史（摘要）
{conversation_text[:8000]}

## 项目产出物
{artifacts_text[:8000]}
"""

        # 5. 调用 LLM 执行提炼
        try:
            skills_data = await self._call_distillation_llm(distillation_input)

            # 6. 存储到数据库
            saved_skills = []
            for skill_info in skills_data.get("skills", []):
                skill = DepartmentSkill(
                    department_id=project.department_id,
                    skill_name=skill_info["skill_name"],
                    content_prompt=skill_info["content_prompt"],
                    derived_from_project_id=project_id,
                    category=skill_info.get("category", ""),
                    is_approved=False,  # 待部门管理员审核
                    rating=skill_info.get("rating", 3.0),
                )
                db.add(skill)
                await db.flush()

                saved_skills.append(SkillOut(
                    id=skill.id,
                    department_id=skill.department_id,
                    skill_name=skill.skill_name,
                    content_prompt=skill.content_prompt,
                    derived_from_project_id=skill.derived_from_project_id,
                    category=skill.category,
                    is_approved=skill.is_approved,
                    usage_count=0,
                    rating=skill.rating,
                    auto_inject=False,
                    created_at=skill.created_at,
                ))

            await db.commit()

            summary = skills_data.get("summary", f"从项目「{project.name}」中提炼了 {len(saved_skills)} 个技能。")
            logger.info(f"[Distillation] 项目 {project_id} 提炼完成: {len(saved_skills)} 个技能")

            return SkillDistillationResult(
                skills_generated=saved_skills,
                summary=summary,
            )

        except Exception as e:
            logger.exception(f"[Distillation] 提炼失败: {e}")
            raise

    async def _call_distillation_llm(self, input_text: str) -> dict:
        """
        调用 LLM API 进行提炼

        实际部署时替换为真实的 API 调用（OpenAI / DeepSeek / 等）
        """
        if not settings.DISTILLATION_API_KEY:
            logger.warning("[Distillation] 未配置 API Key，使用模拟提炼")

            # 模拟提炼结果（开发阶段占位）
            return {
                "skills": [
                    {
                        "skill_name": "高效剧本大纲生成",
                        "category": "剧本大纲",
                        "content_prompt": (
                            "请按照以下结构生成剧本大纲：\n"
                            "1. 主题概述（100字）\n"
                            "2. 分幕结构（起承转合）\n"
                            "3. 关键情节节点（至少5个）\n"
                            "4. 情感曲线设计\n"
                            "5. 伏笔与回收"
                        ),
                        "rating": 4.5,
                    },
                    {
                        "skill_name": "Markdown 文档自动排版",
                        "category": "文档模板",
                        "content_prompt": (
                            "输出时请遵循以下 Markdown 排版规范：\n"
                            "- 标题层级清晰，H2 作为主要分段\n"
                            "- 代码块标注语言类型\n"
                            "- 列表使用 - 开头\n"
                            "- 重要内容使用 **加粗**\n"
                            "- 每个段落不超过 5 行"
                        ),
                        "rating": 4.0,
                    },
                ],
                "summary": "该项目积累了两个核心工作流：结构化的剧本大纲生成模板和 Markdown 自动排版规范。建议默认注入编剧部新项目。",
            }

        # 真实 API 调用（以 OpenAI 为例）
        import aiohttp

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.DISTILLATION_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.DISTILLATION_MODEL,
                    "messages": [
                        {"role": "system", "content": DISTILLATION_SYSTEM_PROMPT},
                        {"role": "user", "content": input_text},
                    ],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                },
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                data = await resp.json()
                content = data["choices"][0]["message"]["content"]
                return json.loads(content)
