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


# ── 外部文件夹浏览 ──
class BrowseFolderRequest(BaseModel):
    path: str


@router.post("/browse")
async def browse_external_folder(
    body: BrowseFolderRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """浏览外部文件夹内容（递归扫描，返回完整树结构）"""
    raw_path = body.path.strip().rstrip('/')
    if not raw_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="路径不能为空")
    folder = Path(raw_path).expanduser().resolve()
    if not folder.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"路径不存在: {folder}")
    if not folder.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不是文件夹")

    tree: dict[str, list] = {"": []}

    def scan_dir(dir_path: Path, rel_prefix: str, depth: int = 0):
        """递归扫描目录，深度限制为 5 层"""
        if depth > 5:
            return
        try:
            for item in sorted(dir_path.iterdir()):
                if item.name.startswith('.') or item.name == '.DS_Store':
                    continue
                rel = f"{rel_prefix}/{item.name}" if rel_prefix else item.name
                if item.is_dir():
                    # 添加到父级的子列表
                    parent_key = rel_prefix if rel_prefix else ""
                    if parent_key not in tree:
                        tree[parent_key] = []
                    tree[parent_key].append({
                        "name": item.name,
                        "relative_path": rel,
                        "type": "directory",
                        "ext": "",
                        "size": 0,
                        "stored_path": str(item),
                        "modified": "",
                    })
                    # 递归扫描子目录
                    scan_dir(item, rel, depth + 1)
                elif item.is_file():
                    parent_key = rel_prefix if rel_prefix else ""
                    if parent_key not in tree:
                        tree[parent_key] = []
                    try:
                        stat = item.stat()
                        tree[parent_key].append({
                            "name": item.name,
                            "relative_path": rel,
                            "stored_path": str(item),
                            "size": stat.st_size,
                            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "ext": item.suffix.lower(),
                        })
                    except OSError:
                        continue
        except PermissionError:
            pass

    scan_dir(folder, "")
    return {"path": str(folder), "name": folder.name, "tree": build_tree(tree, "")}


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


# ── 用默认应用打开文件 ──
@router.post("/open")
async def open_file_with_default_app(
    body: RevealRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """用系统默认应用打开文件"""
    path = Path(body.path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")

    try:
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", str(path)])
        elif system == "Windows":
            subprocess.Popen(["start", "", str(path)], shell=True)
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return {"success": True, "path": str(path)}
    except Exception as e:
        logger.error(f"[Files] open 失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ── 预热 osascript 运行时（减少首次打开延迟） ──
@router.post("/warmup-picker")
async def warmup_picker():
    """预热 osascript 运行时，减少首次打开文件夹选择器的延迟"""
    import asyncio
    if platform.system() == "Darwin":
        try:
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", 'return ""',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=5)
        except Exception:
            pass
    return {"ok": True}


# ── 打开系统文件夹选择器 ──
@router.post("/pick-folder")
async def pick_folder(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """调起操作系统原生文件夹选择器，返回用户选择的文件夹路径"""
    import asyncio

    system = platform.system()
    try:
        if system == "Darwin":
            # macOS: 用 osascript 调起 Finder 文件夹选择器
            script = 'tell application "Finder" to set theFolder to choose folder with prompt "选择要打开的文件夹"\nreturn POSIX path of theFolder'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
            except asyncio.TimeoutError:
                proc.kill()
                return {"cancelled": True, "path": None}
            folder_path = stdout.decode("utf-8").strip().rstrip('/')
            if not folder_path or proc.returncode != 0:
                return {"cancelled": True, "path": None}
            # 验证路径存在且是目录
            if not Path(folder_path).is_dir():
                return {"cancelled": True, "path": None}
            return {"cancelled": False, "path": folder_path}

        elif system == "Windows":
            # Windows: 用 PowerShell 调起文件夹选择器
            script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$f.Description = '选择要打开的文件夹'; "
                "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }"
            )
            proc = await asyncio.create_subprocess_exec(
                "powershell", "-Command", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
            folder_path = stdout.decode("utf-8").strip()
            if not folder_path:
                return {"cancelled": True, "path": None}
            return {"cancelled": False, "path": folder_path}

        else:
            # Linux: 用 zenity 调起文件夹选择器
            proc = await asyncio.create_subprocess_exec(
                "zenity", "--file-selection", "--directory", "--title=选择要打开的文件夹",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
            folder_path = stdout.decode("utf-8").strip()
            if not folder_path:
                return {"cancelled": True, "path": None}
            return {"cancelled": False, "path": folder_path}

    except asyncio.TimeoutError:
        return {"cancelled": True, "path": None}
    except Exception as e:
        logger.error(f"[Files] pick-folder 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/content")
async def get_file_content(
    path: str,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """提供文件内容（图片/视频预览用）"""
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    import mimetypes
    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = "application/octet-stream"

    from fastapi.responses import FileResponse
    return FileResponse(str(file_path), media_type=content_type)
