"""
成果物自动提取流水线 — Phase 3

从 Agent 回复的 Markdown 内容中自动解析结构化产出物：
- 代码块 (<artifact> 标签或标准 Markdown 代码块)
- 结构化文档块 (以 ## 开头的独立章节)
- 特殊标记卡片 (```artifact title="..." file_type="..." 格式)

提取后自动写入 artifacts 表，同名产出物按 project_id + title 去重更新。
"""
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact

logger = logging.getLogger(__name__)

# ── 匹配模式 ──

# 模式 1: ```artifact title="标题" file_type="类型"
#          内容
#          ```
_ARTIFACT_TAG_RE = re.compile(
    r'```artifact\s+title="(?P<title>[^"]+)"\s+file_type="(?P<file_type>[^"]+)"\s*\n'
    r'(?P<content>.*?)```',
    re.DOTALL
)

# 模式 2: 标准 Markdown 代码块 ```python ... ```
_CODE_BLOCK_RE = re.compile(
    r'```(?P<lang>\w+)?\s*\n(?P<content>.*?)```',
    re.DOTALL
)

# 模式 3: 以 ## 标题开头的大段结构化内容（≥ 200 字符）
_STRUCTURED_SECTION_RE = re.compile(
    r'(##\s+(?P<title>[^\n]+)\n(?P<content>(?:(?!##\s).)+))',
    re.DOTALL
)


class ArtifactExtractor:
    """
    成果物提取器

    从 Agent 回复内容中识别并提取结构化产出物，
    写入数据库 artifacts 表。

    提取优先级：
    1. <artifact> 专用标签 (最精确)
    2. 大段代码块 (≥ 80 字符)
    3. 结构化 Markdown 章节 (≥ 200 字符)
    """

    # 需要忽略的常见非产出物标题
    _SKIP_TITLES = {
        "思考过程", "说明", "总结", "分析", "评估", "建议",
        "thinking", "summary", "analysis", "note", "notes",
    }

    async def extract_and_save(
        self,
        db: AsyncSession,
        project_id: str,
        content: str,
    ) -> list[Artifact]:
        """
        从 Agent 回复中提取所有产出物并写入数据库。

        Args:
            db: 数据库会话
            project_id: 项目 ID
            content: Agent 回复的完整文本

        Returns:
            list[Artifact]: 新创建或更新的产出物列表
        """
        saved = []

        # ── 优先级 1: 专用 <artifact> 标签 ──
        for match in _ARTIFACT_TAG_RE.finditer(content):
            try:
                artifact = await self._upsert_artifact(
                    db, project_id,
                    title=match.group("title"),
                    content=match.group("content").strip(),
                    file_type=match.group("file_type"),
                    path=f"_extracted/{match.group('title')}",
                )
                if artifact:
                    saved.append(artifact)
            except Exception as e:
                logger.warning(f"[ArtifactExtractor] 标签解析失败: {e}")

        # ── 优先级 2: 大段代码块 ──
        for i, match in enumerate(_CODE_BLOCK_RE.finditer(content)):
            code = match.group("content").strip()
            lang = match.group("lang") or "text"

            # 跳过 artifact 标签块 (已在优先级1处理)
            if lang == "artifact":
                continue

            if len(code) >= 80:
                title = f"代码片段 #{i + 1} ({lang})"
                try:
                    artifact = await self._upsert_artifact(
                        db, project_id,
                        title=title,
                        content=code,
                        file_type=lang,
                        path=f"_extracted/code_{i + 1}.{lang}",
                    )
                    if artifact:
                        saved.append(artifact)
                except Exception as e:
                    logger.warning(f"[ArtifactExtractor] 代码块提取失败: {e}")

        # ── 优先级 3: 结构化 Markdown 章节 ──
        for match in _STRUCTURED_SECTION_RE.finditer(content):
            title = match.group("title").strip()
            section_content = match.group("content").strip()

            # 跳过太短或应忽略的标题
            if len(section_content) < 200:
                continue
            if any(skip.lower() in title.lower() for skip in self._SKIP_TITLES):
                continue

            try:
                artifact = await self._upsert_artifact(
                    db, project_id,
                    title=title,
                    content=section_content,
                    file_type="markdown",
                    path=f"_extracted/{title}",
                )
                if artifact:
                    saved.append(artifact)
            except Exception as e:
                logger.warning(f"[ArtifactExtractor] 章节提取失败: {e}")

        if saved:
            logger.info(
                f"[ArtifactExtractor] 项目 {project_id} 提取 {len(saved)} 个产出物: "
                f"{[a.title for a in saved]}"
            )

        return saved

    async def _upsert_artifact(
        self,
        db: AsyncSession,
        project_id: str,
        title: str,
        content: str,
        file_type: str,
        path: str,
    ) -> Artifact | None:
        """
        插入或更新产出物（按 project_id + title 去重）。
        如果同名产出物已存在，更新其内容和时间戳。
        """
        # 查找是否已存在
        result = await db.execute(
            select(Artifact).where(
                Artifact.project_id == project_id,
                Artifact.title == title,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            # 更新已有产出物
            existing.content = content
            existing.file_type = file_type
            existing.artifact_path = path
            existing.created_at = datetime.now(timezone.utc)
            logger.debug(f"[ArtifactExtractor] 更新: {title}")
            await db.commit()
            await db.refresh(existing)
            return existing
        else:
            # 创建新产出物
            artifact = Artifact(
                project_id=project_id,
                title=title,
                content=content,
                file_type=file_type,
                artifact_path=path,
            )
            db.add(artifact)
            await db.commit()
            await db.refresh(artifact)
            logger.debug(f"[ArtifactExtractor] 新建: {title}")
            return artifact


# ── 全局单例 ──
artifact_extractor = ArtifactExtractor()
