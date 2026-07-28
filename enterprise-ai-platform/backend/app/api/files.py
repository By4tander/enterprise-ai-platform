"""
文件上传与浏览 API — 项目附件管理

POST /api/files/upload       → 上传文件
GET  /api/files/project/{id} → 列出项目文件树
POST /api/files/reveal       → 在 Finder 中打开文件位置
"""
import logging
import os
import uuid
import subprocess
import platform
from pathlib import Path
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Body
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.middleware.auth import get_current_user
from app.services.session_isolation import SessionIsolationEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/files", tags=["文件上传"])

# 允许的文件类型（全格式覆盖）
ALLOWED_EXTENSIONS = {
    # 文本/代码
    '.txt', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
    '.html', '.css', '.scss', '.less', '.xml', '.csv', '.log', '.ini', '.cfg', '.toml',
    '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.sql', '.sh', '.bash', '.zsh', '.ps1', '.bat',
    # 文档
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.rtf', '.odt', '.ods', '.odp', '.tex',
    # 图片
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.tif',
    '.heic', '.heif', '.avif',
    # 音视频
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv',
    # 压缩包
    '.zip', '.gz', '.tar', '.tar.gz', '.tgz', '.bz2', '.7z', '.rar',
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


class RevealRequest(BaseModel):
    path: str


def build_tree(tree_map: dict, parent: str) -> list:
    """递归构建文件夹树"""
    children = []
    subdirs = set()
    for path in tree_map:
        if path.startswith(parent):
            rest = path[len(parent):].lstrip('/')
            if '/' in rest:
                subdirs.add(rest.split('/')[0])
            elif rest:
                # Direct child directory (e.g. "attachments")
                subdirs.add(rest)

    # Add subdirectories
    for sub in sorted(subdirs):
        full = f"{parent}/{sub}" if parent else sub
        children.append({
            "name": sub,
            "type": "directory",
            "path": full,
            "children": build_tree(tree_map, full),
        })

    # Add files in this directory (skip entries that are themselves directory markers)
    for f in tree_map.get(parent, []):
        if f.get("type") == "directory":
            continue
        children.append({
            "name": f["name"],
            "type": "file",
            "path": f["relative_path"],
            "size": f["size"],
            "ext": f["ext"],
            "stored_path": f["stored_path"],
            "modified": f["modified"],
        })

    return children


@router.post("/upload")
async def upload_file(
    file: Annotated[UploadFile, File(...)],
    project_id: Annotated[str, Form(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    上传文件到项目附件目录。

    返回：
    - file_id: 唯一文件标识
    - filename: 原始文件名
    - stored_path: 项目沙盒内的相对路径
    - size: 文件大小 (bytes)
    """
    # 1. 验证项目权限
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.department_id != project.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权上传文件到该项目")

    # 2. 校验文件扩展名
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件类型: {ext}。允许的类型: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # 3. 校验文件大小（读取内容）
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件大小超过限制 ({MAX_FILE_SIZE // 1024 // 1024}MB)"
        )

    # 4. 存入项目沙盒附件目录
    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(project_id)
    attachments_dir = sandbox / "attachments"
    attachments_dir.mkdir(exist_ok=True)

    # 生成唯一文件名（防冲突）
    unique_name = f"{uuid.uuid4().hex[:8]}_{Path(file.filename).name}"
    file_path = attachments_dir / unique_name
    file_path.write_bytes(content)

    logger.info(f"[Files] 上传: {file.filename} → {file_path} ({len(content)} bytes)")

    return {
        "file_id": unique_name,
        "filename": file.filename,
        "stored_path": str(file_path),
        "relative_path": f"attachments/{unique_name}",
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
    }


# ── 项目文件列表 ──
@router.get("/project/{project_id}")
async def list_project_files(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """列出项目沙盒内的所有文件（含 attachments、outputs、memory 等子目录）"""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.department_id != project.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问")

    isolation = SessionIsolationEngine()
    sandbox = isolation.get_project_sandbox(project_id)

    files = []
    dirs_set = set()
    if sandbox.exists():
        for root, dirs, filenames in os.walk(sandbox):
            # Skip hidden dirs
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for d in dirs:
                rel_dir = str((Path(root) / d).relative_to(sandbox))
                dirs_set.add(rel_dir)
            for fname in filenames:
                if fname.startswith('.') or fname == '.DS_Store':
                    continue
                fp = Path(root) / fname
                try:
                    stat = fp.stat()
                    rel = str(fp.relative_to(sandbox))
                    files.append({
                        "name": fname,
                        "relative_path": rel,
                        "stored_path": str(fp),
                        "size": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "ext": fp.suffix.lower(),
                    })
                except OSError:
                    continue

    # Sort: dirs first (by path), then files (by name)
    files.sort(key=lambda f: (f["relative_path"].count('/'), f["relative_path"]))

    # Build tree structure (files + empty dirs)
    tree: dict[str, list] = {}
    for f in files:
        parts = f["relative_path"].rsplit('/', 1)
        parent = parts[0] if len(parts) == 2 else ""
        if parent not in tree:
            tree[parent] = []
        tree[parent].append(f)
    # Add empty directories as entries in the tree map
    for d in dirs_set:
        parts = d.rsplit('/', 1)
        parent = parts[0] if len(parts) == 2 else ""
        name = parts[1] if len(parts) == 2 else d
        if parent not in tree:
            tree[parent] = []
        # Only add if not already present as a file
        if not any(f.get("name") == name for f in tree.get(parent, [])):
            tree[parent].append({
                "name": name,
                "relative_path": d,
                "type": "directory",
                "ext": "",
                "size": 0,
                "stored_path": str(sandbox / d),
                "modified": "",
            })
        # Ensure the dir itself is a key (for nested lookups)
        if d not in tree:
            tree[d] = []

    return {"project_id": project_id, "sandbox_path": str(sandbox), "files": files, "tree": build_tree(tree, "")}


# ── 在 Finder 中打开文件位置 ──
@router.post("/reveal")
async def reveal_in_finder(
    body: RevealRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """在系统文件管理器中打开文件所在目录"""
    path = Path(body.path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    
    target = path if path.is_dir() else path.parent
    
    try:
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", "-R", str(path)] if path.is_file() else ["open", str(target)])
        elif system == "Windows":
            subprocess.Popen(["explorer", "/select,", str(path)] if path.is_file() else ["explorer", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return {"success": True, "path": str(target)}
    except Exception as e:
        logger.error(f"[Files] reveal 失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
