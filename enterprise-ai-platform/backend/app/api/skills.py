"""
部门技能管理 API 路由
"""
import json
import logging
import os
import re
import tempfile
import shutil
import zipfile
from pathlib import Path as _Path
from typing import Annotated

import yaml as _yaml_global
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.department import Department
from app.models.skill import DepartmentSkill
from app.models.project import Project
from app.middleware.auth import get_current_user
from app.schemas.skill import SkillCreate, SkillOut, SkillUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skills", tags=["部门技能"])


@router.get("/", response_model=list[SkillOut])
async def list_skills(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    department_id: str | None = None,
    approved_only: bool = True,
):
    """获取技能列表"""
    query = select(DepartmentSkill).options(
        selectinload(DepartmentSkill.department),
        selectinload(DepartmentSkill.derived_from_project),
        selectinload(DepartmentSkill.created_by_user),
    )

    # 部门权限：同 projects 逻辑
    if current_user.role == UserRole.SUPER_ADMIN:
        if department_id:
            query = query.where(DepartmentSkill.department_id == department_id)
    elif current_user.role == UserRole.DEPT_ADMIN:
        effective_dept = department_id if department_id == current_user.department_id else current_user.department_id
        if effective_dept:
            query = query.where(DepartmentSkill.department_id == effective_dept)
    else:  # MEMBER
        if current_user.department_id:
            query = query.where(DepartmentSkill.department_id == current_user.department_id)

    if approved_only:
        query = query.where(DepartmentSkill.is_approved == True)

    query = query.order_by(DepartmentSkill.rating.desc(), DepartmentSkill.usage_count.desc())
    result = await db.execute(query)
    skills = result.scalars().all()

    return [
        SkillOut(
            id=s.id, department_id=s.department_id,
            skill_name=s.skill_name, content_prompt=s.content_prompt,
            derived_from_project_id=s.derived_from_project_id,
            derived_from_project_name=s.derived_from_project.name if s.derived_from_project else None,
            category=s.category, is_approved=s.is_approved,
            usage_count=s.usage_count, rating=s.rating, auto_inject=s.auto_inject,
            created_at=s.created_at,
            created_by_user_id=s.created_by_user_id,
            created_by_username=s.created_by_user.username if s.created_by_user else None,
            import_source=s.import_source,
            original_source_url=s.original_source_url,
            metadata_json=s.metadata_json,
        )
        for s in skills
    ]


@router.post("/", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
async def create_skill(
    req: SkillCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """手动创建技能"""
    dept = await db.get(Department, req.department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")

    skill = DepartmentSkill(
        department_id=req.department_id,
        skill_name=req.skill_name,
        content_prompt=req.content_prompt,
        derived_from_project_id=req.derived_from_project_id,
        category=req.category,
        # Dept Admin 创建的技能默认批准
        is_approved=(current_user.role in (UserRole.SUPER_ADMIN, UserRole.DEPT_ADMIN)),
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    return SkillOut(
        id=skill.id,
        department_id=skill.department_id,
        skill_name=skill.skill_name,
        content_prompt=skill.content_prompt,
        derived_from_project_id=skill.derived_from_project_id,
        category=skill.category,
        is_approved=skill.is_approved,
        usage_count=skill.usage_count,
        rating=skill.rating,
        auto_inject=skill.auto_inject,
        created_at=skill.created_at,
    )


@router.put("/{skill_id}", response_model=SkillOut)
async def update_skill(
    skill_id: str,
    req: SkillUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """更新技能"""
    skill = await db.get(DepartmentSkill, skill_id)
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="技能不存在")

    # 权限检查：部门管理员和超级管理员可以审核/修改技能
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")

    if req.skill_name is not None:
        skill.skill_name = req.skill_name
    if req.content_prompt is not None:
        skill.content_prompt = req.content_prompt
    if req.category is not None:
        skill.category = req.category
    if req.is_approved is not None:
        skill.is_approved = req.is_approved
    if req.auto_inject is not None:
        skill.auto_inject = req.auto_inject
    if req.rating is not None:
        skill.rating = req.rating

    await db.commit()
    await db.refresh(skill)

    return SkillOut(
        id=skill.id,
        department_id=skill.department_id,
        skill_name=skill.skill_name,
        content_prompt=skill.content_prompt,
        derived_from_project_id=skill.derived_from_project_id,
        category=skill.category,
        is_approved=skill.is_approved,
        usage_count=skill.usage_count,
        rating=skill.rating,
        auto_inject=skill.auto_inject,
        created_at=skill.created_at,
    )


# ════════════════════════════════════════════════════════════════
#  技能导入端点
# ════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field


class SkillImportRequest(BaseModel):
    department_id: str
    content: str = Field(..., description="JSON / YAML / Markdown 文本")


@router.post("/import", response_model=list[SkillOut], status_code=status.HTTP_201_CREATED)
async def import_skills(
    req: SkillImportRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """导入外部技能 (JSON/YAML/Markdown)"""
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")

    dept = await db.get(Department, req.department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")

    parsed = _parse_skill_content(req.content)
    imported = []

    for item in parsed:
        skill = DepartmentSkill(
            department_id=req.department_id,
            skill_name=item.get("skill_name", item.get("name", "未命名技能")),
            content_prompt=item.get("content_prompt", item.get("prompt", item.get("content", ""))),
            category=item.get("category", ""),
            is_approved=True,
        )
        db.add(skill)
        await db.flush()
        imported.append(SkillOut(
            id=skill.id, department_id=skill.department_id,
            skill_name=skill.skill_name, content_prompt=skill.content_prompt,
            derived_from_project_id=None, derived_from_project_name=None,
            category=skill.category, is_approved=skill.is_approved,
            usage_count=0, rating=0.0, auto_inject=False,
            created_at=skill.created_at,
        ))

    await db.commit()
    return imported


def _parse_skill_content(content: str) -> list[dict]:
    """解析导入内容为技能列表 (JSON > YAML > Markdown)"""
    # JSON
    try:
        data = json.loads(content)
        if isinstance(data, list): return data
        if isinstance(data, dict): return [data]
    except: pass

    # YAML
    try:
        data = _yaml_global.safe_load(content)
        if isinstance(data, list): return data
        if isinstance(data, dict):
            return data.get("skills", [data])
    except: pass

    # Markdown (按 # 标题分割)
    sections = []
    cur_title, cur_lines = "", []
    for line in content.split("\n"):
        if line.startswith("# "):
            if cur_title:
                sections.append({"skill_name": cur_title, "content_prompt": "\n".join(cur_lines).strip()})
            cur_title = line[2:].strip()
            cur_lines = []
        else:
            cur_lines.append(line)
    if cur_title:
        sections.append({"skill_name": cur_title, "content_prompt": "\n".join(cur_lines).strip()})
    if sections: return sections

    return [{"skill_name": "导入技能", "content_prompt": content}]


# ════════════════════════════════════════════════════════════════
#  ZIP 技能包导入端点
# ════════════════════════════════════════════════════════════════


@router.post("/import/zip", response_model=list[SkillOut], status_code=status.HTTP_201_CREATED)
async def import_skills_zip(
    file: Annotated[UploadFile, File(...)],
    department_id: Annotated[str, Form(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    导入 ZIP 技能包文件。

    支持格式:
    - WorkBuddy Skill (SKILL.md + _meta.json)
    - Claude Code (.claude/skills/ 结构)
    - OpenClaw Skill Hub (SKILL.md with YAML frontmatter)
    - Generic (任意包含 .md 文件的目录)

    自动解压 → 检测格式 → 解析元数据 → 存入 DB → 同步到 Hermes 技能库
    """
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")

    dept = await db.get(Department, department_id)
    if dept is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")

    # 校验文件类型
    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 .zip 文件")

    # 读取 ZIP 到临时目录
    content = await file.read()
    tmp_dir = tempfile.mkdtemp(prefix="skill_import_")
    imported = []

    try:
        zip_path = _Path(tmp_dir) / file.filename
        zip_path.write_bytes(content)

        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(tmp_dir)

        # 遍历检测技能文件
        for root, dirs, files in os.walk(tmp_dir):
            # 跳过 __MACOSX, .git 等
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__MACOSX']

            for fname in files:
                if fname == 'SKILL.md':
                    skill_data = _parse_skill_md_file(_Path(root) / fname, _Path(root))
                elif fname.endswith('.md') and fname != 'README.md':
                    # 通用 markdown → 作为独立技能
                    skill_data = _parse_generic_md(_Path(root) / fname)
                else:
                    continue

                if not skill_data:
                    continue

                # 同步到 Hermes 技能库
                _sync_to_hermes_skills(skill_data, department_id, _Path(root))

                # 存入数据库
                skill = DepartmentSkill(
                    department_id=department_id,
                    skill_name=skill_data.get("skill_name", fname.replace('.md', '')),
                    content_prompt=skill_data.get("content_prompt", ""),
                    category=skill_data.get("category", ""),
                    is_approved=True,
                    created_by_user_id=current_user.id,
                    import_source="import_zip",
                    original_source_url=skill_data.get("source_url"),
                    metadata_json=json.dumps({
                        "original_filename": file.filename,
                        "skill_format": skill_data.get("format", "generic"),
                        "original_engine": skill_data.get("engine"),
                        "tags": skill_data.get("tags", []),
                    }),
                )
                db.add(skill)
                await db.flush()
                imported.append(SkillOut(
                    id=skill.id, department_id=skill.department_id,
                    skill_name=skill.skill_name, content_prompt=skill.content_prompt,
                    derived_from_project_id=None, derived_from_project_name=None,
                    category=skill.category, is_approved=skill.is_approved,
                    usage_count=0, rating=skill.rating or 0.0, auto_inject=False,
                    created_at=skill.created_at,
                    created_by_user_id=skill.created_by_user_id,
                    created_by_username=current_user.username,
                    import_source=skill.import_source,
                    original_source_url=skill.original_source_url,
                    metadata_json=skill.metadata_json,
                ))

        await db.commit()

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if not imported:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未在 ZIP 中找到任何可识别的技能文件")

    logger.info(f"[Skills] ZIP 导入完成: {len(imported)} 个技能 from {file.filename}")
    return imported


def _parse_skill_md_file(md_path: _Path, skill_dir: _Path) -> dict | None:
    """解析 SKILL.md 文件，支持 WorkBuddy / Claude / OpenClaw 格式"""
    content = md_path.read_text(encoding="utf-8", errors="replace")
    data: dict = {"content_prompt": content, "format": "generic"}

    # 检测 YAML frontmatter (OpenClaw, Claude Code 常用)
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
    if fm_match:
        try:
            frontmatter = _yaml_global.safe_load(fm_match.group(1))
            body = fm_match.group(2)
            if isinstance(frontmatter, dict):
                data["skill_name"] = frontmatter.get("name") or frontmatter.get("title") or data.get("skill_name")
                data["category"] = frontmatter.get("category") or frontmatter.get("tags", [None])[0]
                data["engine"] = frontmatter.get("engine") or frontmatter.get("platform")
                data["source_url"] = frontmatter.get("source") or frontmatter.get("homepage")
                data["tags"] = frontmatter.get("tags", [])
            data["content_prompt"] = body.strip()
            data["format"] = "yaml_frontmatter"
            return data
        except Exception:
            pass

    # 检测 _meta.json (WorkBuddy 格式)
    meta_path = skill_dir / "_meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            data["skill_name"] = meta.get("name") or meta.get("displayName") or data.get("skill_name")
            data["category"] = meta.get("category") or (meta.get("labels", {}).get("category"))
            data["engine"] = "workbuddy"
            data["source_url"] = meta.get("homepage") or meta.get("source")
            data["tags"] = meta.get("tags", [])
            data["format"] = "workbuddy"
        except Exception:
            pass

    # 从文件名推断
    if not data.get("skill_name"):
        data["skill_name"] = md_path.parent.name or md_path.stem

    return data


def _parse_generic_md(md_path: _Path) -> dict | None:
    """解析通用 markdown 文件为技能"""
    content = md_path.read_text(encoding="utf-8", errors="replace")
    if len(content.strip()) < 20:
        return None
    return {
        "skill_name": md_path.stem.replace('_', ' ').replace('-', ' ').title(),
        "content_prompt": content.strip(),
        "category": "",
        "format": "generic_md",
    }


def _sync_to_hermes_skills(skill_data: dict, department_id: str, skill_dir: _Path):
    """
    将导入的技能同步到 Hermes 本地技能库目录。
    默认路径: ~/.hermes/skills/{department_id}/{skill_name}/
    """
    import os as _os
    hermes_home = _Path(_os.path.expanduser("~")) / ".hermes" / "skills" / department_id
    try:
        skill_name = skill_data.get("skill_name", "unnamed")
        safe_name = re.sub(r'[^\w\-]', '_', skill_name)
        target_dir = hermes_home / safe_name
        target_dir.mkdir(parents=True, exist_ok=True)

        # 写入 SKILL.md
        (target_dir / "SKILL.md").write_text(
            skill_data.get("content_prompt", ""), encoding="utf-8"
        )
        # 写入 _meta.json
        (target_dir / "_meta.json").write_text(
            json.dumps({
                "name": skill_name,
                "source": skill_data.get("engine", "imported"),
                "department_id": department_id,
                "category": skill_data.get("category", ""),
                "tags": skill_data.get("tags", []),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        logger.debug(f"[Skills] 已同步到 Hermes: {target_dir}")
    except Exception as e:
        logger.warning(f"[Skills] Hermes 同步失败 (非致命): {e}")


# ── 全局技能搜索 ──

@router.get("/search")
async def search_skills(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    q: str = "",
):
    """搜索所有技能（Hermes原生 + 部门技能），按名称、描述匹配"""
    results = []
    keyword = q.strip().lower()

    # 1. Hermes 原生技能
    try:
        home = str(Path(Path.home()) / ".hermes" / "skills")
        all_native = []
        if Path(home).exists():
            for dirpath, dirnames, filenames in os.walk(home):
                dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                for fn in filenames:
                    if fn == "SKILL.md":
                        fp = Path(dirpath) / fn
                        try:
                            content = fp.read_text(encoding='utf-8', errors='ignore')
                            name = fp.parent.name
                            # Parse frontmatter or first heading
                            desc = ""
                            for line in content.split('\n'):
                                line_s = line.strip()
                                if line_s.startswith('# ') and not desc:
                                    desc = line_s[2:].strip()
                                elif line_s and not line_s.startswith('#'):
                                    if len(desc) < 20:
                                        desc = line_s[:100]
                                    break
                            all_native.append({
                                "id": f"native-{name}",
                                "skill_name": name,
                                "category": "native",
                                "source": "hermes",
                                "description": desc or "",
                            })
                        except Exception:
                            continue
        if keyword:
            results += [s for s in all_native 
                       if keyword in s["skill_name"].lower() or keyword in s.get("description","").lower()]
        else:
            results += all_native[:30]
    except Exception as e:
        logger.warning(f"[Skills] Hermes 搜索失败: {e}")

    # 2. 部门技能 (DB)
    dept_query = select(DepartmentSkill)
    if current_user.role != UserRole.SUPER_ADMIN and current_user.department_id:
        dept_query = dept_query.where(DepartmentSkill.department_id == current_user.department_id)
    dept_result = await db.execute(dept_query)
    dept_skills = dept_result.scalars().all()
    for ds in dept_skills:
        if keyword and keyword not in ds.skill_name.lower() and keyword not in (ds.content_prompt or "").lower():
            continue
        # Extract first line as description
        desc = ""
        if ds.content_prompt:
            first_line = ds.content_prompt.strip().split('\n')[0]
            desc = first_line[:100]
        results.append({
            "id": ds.id,
            "skill_name": ds.skill_name,
            "category": ds.category or "department",
            "source": ds.import_source or "manual",
            "description": desc,
            "department_id": ds.department_id,
        })

    return results


# ── Hermes 原生技能查询 ──

@router.get("/native", response_model=list[dict])
async def get_native_skills(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    获取 Hermes 原生内置技能列表（不依赖部门，所有项目可用）
    通过调用 hermes skills list 获取
    """
    import asyncio
    import shutil as _shutil

    # 查找 hermes 命令
    hermes_path = os.environ.get("HERMES_CLI_PATH", "/Users/jiayiren/.local/bin/hermes")
    if not _shutil.which(hermes_path) and not os.path.isfile(hermes_path):
        # 尝试默认路径
        alt_paths = [
            "/Users/jiayiren/.local/bin/hermes",
            os.path.expanduser("~/.local/bin/hermes"),
        ]
        hermes_path = None
        for p in alt_paths:
            if os.path.isfile(p) or _shutil.which(p):
                hermes_path = p
                break
        if not hermes_path:
            return []

    try:
        proc = await asyncio.create_subprocess_exec(
            hermes_path, "skills", "list",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        output = stdout.decode("utf-8", errors="replace")

        # 解析表格输出（简易解析器）
        skills = []
        for line in output.split("\n"):
            line = line.strip()
            if not line or line.startswith("┏") or line.startswith("┡") or line.startswith("└") or "Name" in line:
                continue
            # 匹配: │ skill-name │ category │ source │ trust │ status │
            parts = [p.strip() for p in line.split("│")]
            if len(parts) >= 5:
                name = parts[1] if len(parts) > 1 else ""
                category = parts[2] if len(parts) > 2 else ""
                source = parts[3] if len(parts) > 3 else ""
                if name and name not in ["Name", ""]:
                    skills.append({
                        "id": f"native-{name}",
                        "skill_name": name,
                        "category": category or "general",
                        "source": source,
                        "is_native": True,
                    })
        return skills
    except Exception as e:
        logger.warning(f"[Skills] 获取原生技能失败: {e}")
        return []
