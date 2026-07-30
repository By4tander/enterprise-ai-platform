"""
Hermes CLI 异步调用桥梁 — Phase 2 重构版

封装对本地 `hermes` CLI 的异步调用，支持：
- asyncio 子进程流式读取
- ANSI 控制码 / 终端特殊字符清洗
- DeepSeek v4pro <think> 思考过程标签解析
- 客户端断开时自动 kill 子进程
- 优雅降级：Hermes 未安装时自动回退到模拟器

⚠️ 设计原则：绝对不修改 Hermes 源码，仅通过 subprocess 调用 CLI 接口。
"""
import asyncio
import json
import logging
import os
import re
import shlex
import shutil
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional

from app.config import settings
from app.core.concurrency import concurrency_manager
from app.services.session_isolation import SessionIsolationEngine

logger = logging.getLogger(__name__)

# ── ANSI / 终端控制码清洗正则 ──
_ANSI_RE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
_CARRIAGE_RE = re.compile(r'\r+')
_BACKSPACE_RE = re.compile(r'.\b')  # 字符 + 退格 = 删除前一个字符
_SPINNER_RE = re.compile(r'[\u2800-\u28FF]+')  # Braille 转圈动画


# ── Hermes 可用性检测 ──
HERMES_AVAILABLE: bool = (
    shutil.which(settings.HERMES_CLI_PATH) is not None
    or os.path.isfile(settings.HERMES_PYTHON_PATH)
)
if not HERMES_AVAILABLE:
    logger.warning(f"⚠️ Hermes 未找到 (CLI: {settings.HERMES_CLI_PATH}, Python: {settings.HERMES_PYTHON_PATH})，将自动回退到模拟器。")
else:
    logger.info(f"✅ Hermes 已就绪 (Stream Bridge: {settings.HERMES_STREAM_BRIDGE})")


# ════════════════════════════════════════════════════════════════════
#  核心类：Hermes CLI 桥接器
# ════════════════════════════════════════════════════════════════════

class HermesCLIBridge:
    """
    Hermes CLI 异步包装器 (Phase 2)

    每次对话启动独立子进程，通过 stdout 逐行流式读取并解析。
    返回结构化增量字典：
        {"type": "thinking" | "content" | "error" | "done",
         "delta": "增量文本"}

    用法:
        bridge = HermesCLIBridge()
        async for chunk in bridge.chat(prompt, system_prompt="..."):
            if chunk["type"] == "thinking":
                # 推送到前端思考折叠区域
            elif chunk["type"] == "content":
                # 推送到前端正文区域
    """

    def __init__(self):
        self.cli_path = settings.HERMES_CLI_PATH
        self.timeout = settings.HERMES_TIMEOUT_SECONDS
        self._process: Optional[asyncio.subprocess.Process] = None

    # ── 静态工具方法 ──

    @staticmethod
    def clean_ansi(text: str) -> str:
        """
        清洗终端 ANSI 控制码、光标移动符、退格覆写、转圈动画等。
        输入：从 hermes stdout 读取的原始字符串
        输出：仅保留可读文本
        """
        # 1. 移除 ANSI escape sequences (颜色、光标控制等)
        text = _ANSI_RE.sub('', text)
        # 2. 处理退格键覆写 (char + \b = 删除前一个 char)
        #    反复应用直到没有退格
        while '\b' in text:
            text = _BACKSPACE_RE.sub('', text)
        # 3. 移除孤立的回车符 (\r)
        text = _CARRIAGE_RE.sub('', text)
        # 4. 清理 Braille spinner 字符 (⠋⠙⠹...)
        text = _SPINNER_RE.sub('', text)
        # 5. 移除终端查询/响应序列 (如 "\x1b[6n" 等)
        text = re.sub(r'\x1b\[[\d;]*[a-zA-Z]', '', text)
        # 6. 过滤其他不可打印控制字符 (保留换行 \n 和制表符 \t)
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)

        return text

    @staticmethod
    def parse_think_tags(text: str) -> Dict[str, str]:
        """
        解析 <think>...</think> 标签，分离思考内容与正文。
        返回:
            {"before": "...", "thinking": "...", "after": "..."}

        支持场景:
            - 正文 + <think>思考</think> + 正文
            - <think>思考</think> + 正文
            - 纯思考 / 纯正文
        """
        result = {"before": "", "thinking": "", "after": ""}

        think_pattern = re.compile(r'<think>(.*?)</think>', re.DOTALL)

        # 找到所有 think 块
        matches = list(think_pattern.finditer(text))
        if not matches:
            result["after"] = text
            return result

        first = matches[0]
        last = matches[-1]

        result["before"] = text[:first.start()]
        result["thinking"] = '\n'.join(m.group(1).strip() for m in matches)
        result["after"] = text[last.end():]

        return result

    # ── 异步流式调用 ──

    async def chat(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        project_id: Optional[str] = None,
        file_paths: Optional[list[str]] = None,
        model_config: Optional[dict] = None,
    ) -> AsyncGenerator[Dict[str, str], None]:
        """
        异步流式调用 Hermes CLI，逐块返回结构化增量。
        集成并发控制 + 沙盒隔离。

        Args:
            model_config: 项目级模型覆盖 {"model": "qwen-max", "provider": "dashscope", "thinking": True}

        Args:
            prompt: 用户输入（或已拼装好的完整 Prompt）
            system_prompt: 可选的 System Prompt
            project_id: 可选的隔离项目 ID
            file_paths: 可选的附件文件路径列表
            project_id: 可选的隔离项目 ID

        Yields:
            {"type": "thinking", "delta": "..."}   — 思考过程增量
            {"type": "content", "delta": "..."}     — 正文增量
            {"type": "queue", "delta": "..."}       — 排队提示
            {"type": "error", "delta": "..."}       — 错误信息
            {"type": "done", "delta": ""}           — 对话完成信号
        """
        # ── 并发控制: 获取槽位 ──
        position = await concurrency_manager.acquire()
        if position > 0:
            queue_msg = f"当前排队中，前面还有 {position} 个任务..."
            logger.info(f"[HermesBridge] {queue_msg}")
            yield {"type": "queue", "delta": queue_msg}

        try:
            # ── 沙盒隔离: 设置工作目录与环境变量 ──
            isolation = SessionIsolationEngine()
            working_dir = None

            if project_id:
                sandbox = isolation.get_project_sandbox(project_id)
                working_dir = str(sandbox)
                isolation_env = isolation.get_isolation_env(project_id)
            else:
                isolation_env = {}

            # 构建命令 — 使用流式桥接脚本替代 hermes -z
            # hermes_stream_bridge.py 直接调用 Hermes Python 模块，实现真正的逐 token 流式输出
            cmd = [
                settings.HERMES_PYTHON_PATH,
                settings.HERMES_STREAM_BRIDGE,
                prompt,
            ]

            # 附件透传：读取文件内容并注入到上下文
            process_env_extra = {}
            if file_paths:
                file_context_parts = []
                for fp in file_paths:
                    try:
                        if os.path.isfile(fp):
                            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                                content = f.read()
                            # 限制单个文件最大 500KB，超过则截断
                            if len(content) > 500000:
                                content = content[:500000] + f"\n... (文件共 {len(content)//1024}KB，已截取前 500KB)"
                            file_context_parts.append(f"[附件文件: {fp}]\n{content}")
                        else:
                            file_context_parts.append(f"[附件文件: {fp}] (文件不存在)")
                    except Exception as e:
                        file_context_parts.append(f"[附件文件: {fp}] (读取失败: {e})")
                file_context = "\n\n".join(file_context_parts)
                process_env_extra = {"HERMES_ATTACHED_FILES": ",".join(file_paths)}
                if system_prompt:
                    system_prompt = f"{system_prompt}\n\n## 附件文件内容\n{file_context}"
                else:
                    system_prompt = f"## 附件文件内容\n{file_context}"

            # 构建进程环境 — 三层修复解决流式输出阻塞
            process_env = os.environ.copy()

            # 确保 Hermes 的 .env 变量可用（Firecrawl API Key 等）
            dotenv_path = Path.home() / ".hermes" / ".env"
            if dotenv_path.exists():
                try:
                    with open(dotenv_path) as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith('#') and '=' in line:
                                k, v = line.split('=', 1)
                                k, v = k.strip(), v.strip()
                                if k not in process_env:
                                    process_env[k] = v
                except Exception:
                    pass

            # [Fix 1] 强制禁用 Python 缓冲 → 子进程 stdout 即时 flush
            process_env["PYTHONUNBUFFERED"] = "1"
            process_env["PYTHONIOENCODING"] = "utf-8"
            process_env["PYTHONUTF8"] = "1"
            process_env["LANG"] = "en_US.UTF-8"
            process_env["LC_ALL"] = "en_US.UTF-8"

            # [Fix 2] 移除代理环境变量 → 防止 Hermes 子进程的 DeepSeek API 请求
            #         被本地代理 (http://127.0.0.1:xxx) 拦截导致 502 / TLS 断连
            for proxy_key in (
                "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
                "ALL_PROXY", "all_proxy",
            ):
                process_env.pop(proxy_key, None)
            # 保留 NO_PROXY 以防万一，但确保包含本地地址
            process_env["NO_PROXY"] = "localhost,127.0.0.1,::1,*.local"
            process_env["no_proxy"] = process_env["NO_PROXY"]

            # [Fix 3] 项目级模型覆盖 → 通过环境变量注入
            # hermes_stream_bridge 读取 HERMES_INFERENCE_MODEL 和 HERMES_INFERENCE_PROVIDER
            if model_config and model_config.get("model"):
                process_env["HERMES_INFERENCE_MODEL"] = model_config.get("model", "")
                process_env["HERMES_INFERENCE_PROVIDER"] = model_config.get("provider", "")
                if model_config.get("thinking"):
                    process_env["HERMES_REASONING_EFFORT"] = "high"
                logger.info(f"[HermesBridge] 项目模型覆盖: {model_config.get('provider')}/{model_config.get('model')} thinking={model_config.get('thinking')}")

            process_env.update(isolation_env)
            process_env.update(process_env_extra)
            if system_prompt:
                process_env["HERMES_SYSTEM_PROMPT"] = system_prompt

            logger.info(
                f"[HermesBridge] 启动: {' '.join(shlex.quote(c) for c in cmd[:3])}... "
                f"(project={project_id}, 并发槽位={concurrency_manager.active_jobs}/{concurrency_manager.max_concurrent})"
            )
            logger.debug(
                f"[HermesBridge] Prompt 长度: {len(prompt)}, "
                f"System 长度: {len(system_prompt) if system_prompt else 0}, "
                f"cwd: {working_dir}"
            )

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=process_env,
            )

            in_thinking = False
            last_output_time = asyncio.get_event_loop().time()

            # [Fix 3] 异步收集 stderr，防止管道死锁
            stderr_chunks: list[str] = []

            async def _drain_stderr():
                """后台读取 stderr，防止子进程因 stderr 管道满而阻塞"""
                try:
                    while True:
                        chunk = await self._process.stderr.read(1024)
                        if not chunk:
                            break
                        text = chunk.decode("utf-8", errors="replace")
                        stderr_chunks.append(text)
                        # Hermes 的 stderr 通常含日志/调试信息，用 debug 级别记录
                        for line in text.strip().split('\n'):
                            if line.strip():
                                logger.debug(f"[HermesBridge:stderr] {line.strip()[:200]}")
                except Exception:
                    pass

            stderr_task = asyncio.create_task(_drain_stderr())

            # [Fix 4] 小 Chunk 读取 + 超时检测 + UTF-8 安全解码
            #   关键: 用 raw bytes buffer (RAW_BUF)，按 b'\n' 分割后再 decode。
            #   因为 \n (0x0A) 不可能出现在 UTF-8 多字节序列中，所以按字节切割是安全的。
            #   这样避免了 raw_chunk.decode("utf-8", errors="replace") 将跨 chunk 的
            #   中文字符（如 "或" = E6 88 96）切成两半导致永久 � 乱码。
            RAW_BUF = b""
            READ_CHUNK_SIZE = 64  # 64 字节小块，确保低延迟

            try:
                while True:
                    # 带超时的小块读取
                    try:
                        raw_chunk = await asyncio.wait_for(
                            self._process.stdout.read(READ_CHUNK_SIZE),
                            timeout=30,  # 30 秒无输出则检查进程状态
                        )
                    except asyncio.TimeoutError:
                        # 30 秒无任何输出 → 检查子进程是否存活
                        if self._process.returncode is not None:
                            logger.warning(f"[HermesBridge] 子进程已退出 (code={self._process.returncode})，但未收到 done 事件")
                            break
                        # 进程仍存活（可能在等待 LLM API 响应），继续等待
                        logger.debug(f"[HermesBridge] 30s 无输出，进程仍在运行...")
                        continue

                    if not raw_chunk:
                        break  # EOF — 子进程 stdout 关闭

                    last_output_time = asyncio.get_event_loop().time()
                    RAW_BUF += raw_chunk

                    # 按换行字节 b'\n' 拆分处理（NDJSON 每行一个 JSON 对象）
                    while b'\n' in RAW_BUF:
                        line_bytes, RAW_BUF = RAW_BUF.split(b'\n', 1)
                        # 现在才 decode 这一整行 —— 保证 UTF-8 序列完整
                        line = line_bytes.decode("utf-8").strip()
                        if not line:
                            continue

                        # ── 解析 NDJSON 行 ──
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            # 非 JSON 行（可能是 ANSI 残留或日志），跳过
                            logger.debug(f"[HermesBridge] 跳过非 JSON 行: {line[:100]}")
                            continue

                        msg_type = data.get("type", "")

                        if msg_type == "thinking_chunk":
                            yield {"type": "thinking", "delta": data.get("content", "")}

                        elif msg_type == "content_chunk":
                            yield {"type": "content", "delta": data.get("content", "")}

                        elif msg_type == "status":
                            yield {"type": "status", "delta": data.get("content", "")}

                        elif msg_type == "context":
                            yield {
                                "type": "context",
                                "delta": json.dumps({
                                    "model": data.get("model", ""),
                                    "provider": data.get("provider", ""),
                                    "tokens_used": data.get("tokens_used", 0),
                                    "input_tokens": data.get("input_tokens", 0),
                                    "output_tokens": data.get("output_tokens", 0),
                                    "elapsed_seconds": data.get("elapsed_seconds", 0),
                                }, ensure_ascii=False),
                            }

                        elif msg_type == "tool_call":
                            yield {
                                "type": "tool_call",
                                "delta": json.dumps({
                                    "tool": data.get("tool", ""),
                                    "args": data.get("args", ""),
                                }, ensure_ascii=False),
                            }

                        elif msg_type == "tool_result":
                            yield {
                                "type": "tool_result",
                                "delta": json.dumps({
                                    "tool": data.get("tool", ""),
                                    "result": data.get("result", ""),
                                }, ensure_ascii=False),
                            }

                        elif msg_type == "done":
                            yield {
                                "type": "done",
                                "delta": json.dumps({
                                    "content": data.get("content", ""),
                                    "thinking": data.get("thinking"),
                                    "input_tokens": data.get("input_tokens", 0),
                                    "output_tokens": data.get("output_tokens", 0),
                                }, ensure_ascii=False),
                            }

                        elif msg_type == "error":
                            yield {"type": "error", "delta": data.get("content", "")}
                            if data.get("traceback"):
                                logger.error(f"[HermesBridge] Stream bridge traceback:\n{data['traceback']}")

            finally:
                # 处理 RAW_BUF 中可能在 EOF 后残留的最后一行
                if RAW_BUF:
                    try:
                        final_line = RAW_BUF.decode("utf-8").strip()
                        if final_line:
                            data = json.loads(final_line)
                            msg_type = data.get("type", "")
                            if msg_type == "done":
                                yield {"type": "done", "delta": json.dumps(data, ensure_ascii=False)}
                            elif msg_type == "error":
                                yield {"type": "error", "delta": data.get("content", "")}
                            elif msg_type == "content_chunk":
                                yield {"type": "content", "delta": data.get("content", "")}
                    except Exception:
                        logger.debug(f"[HermesBridge] EOF 残留数据无法解析: {RAW_BUF[:100]!r}")

                # 确保 stderr drain 任务被清理
                if not stderr_task.done():
                    stderr_task.cancel()
                    try:
                        await stderr_task
                    except (asyncio.CancelledError, Exception):
                        pass

            # 等待进程结束
            try:
                await asyncio.wait_for(self._process.wait(), timeout=self.timeout)
            except asyncio.TimeoutError:
                logger.error(f"[HermesBridge] 超时 {self.timeout}s，强制终止")
                self._process.kill()
                await self._process.wait()
                yield {"type": "error", "delta": f"执行超时（{self.timeout}秒）"}

            # 检查退出码 — 非 0 视为错误，推送给前端
            if self._process.returncode and self._process.returncode != 0:
                stderr_text = "".join(stderr_chunks)[-500:] if stderr_chunks else "(无 stderr 输出)"
                logger.error(
                    f"[HermesBridge] 异常退出 code={self._process.returncode}: "
                    f"{stderr_text}"
                )
                yield {
                    "type": "error",
                    "delta": f"Hermes 返回错误 (code={self._process.returncode}): {stderr_text[:300]}"
                }

            yield {"type": "done", "delta": ""}

        except asyncio.CancelledError:
            # 客户端断开连接 → 立即 kill 子进程
            logger.info("[HermesBridge] 客户端断开，终止 hermes 子进程")
            self.kill()
            raise

        except FileNotFoundError:
            logger.error(f"[HermesBridge] CLI 未找到: {self.cli_path}")
            yield {"type": "error", "delta": f"Hermes CLI 未安装: {self.cli_path}"}

        except Exception as e:
            logger.exception("[HermesBridge] 未预期异常")
            self.kill()
            yield {"type": "error", "delta": str(e)}

        finally:
            # 无论如何都释放并发槽位
            concurrency_manager.release()
            logger.debug(
                f"[HermesBridge] 释放并发槽位 "
                f"(活跃: {concurrency_manager.active_jobs}/{concurrency_manager.max_concurrent})"
            )

    def kill(self):
        """安全终止子进程"""
        if self._process and self._process.returncode is None:
            try:
                self._process.kill()
            except Exception:
                pass
            self._process = None


# ════════════════════════════════════════════════════════════════════
#  降级方案：模拟器（附带 think 支持）
# ════════════════════════════════════════════════════════════════════

class HermesBridgeSimulator:
    """
    Hermes Bridge 模拟器 — 当 hermes CLI 不可用时的降级方案。

    模拟 DeepSeek v4pro 输出格式，包含 <think> 思考过程和正文，
    用于前端 UI 开发与演示。
    """

    SIMULATED_RESPONSES: Dict[str, Dict[str, str]] = {
        "剧本": {
            "thinking": (
                "让我分析用户需求：需要一段剧本大纲。根据部门技能「剧本大纲标准模板」，"
                "应该遵循 5 要素结构。考虑到是编剧部项目，应该突出人物塑造和情感弧线。\n"
                "关键词：相遇、命运、公园。这暗示了一个浪漫的首次相遇场景。"
                "我选择清晨的公园作为场景，因为这个时间段有柔和的自然光，适合营造浪漫氛围。\n"
                "人物设定：女主是独立插画师（文艺、敏感），男主是建筑师（理性、有结构感）。"
                "这种反差可以产生有趣的对话张力。"
            ),
            "content": (
                "好的！下面是第一幕的剧本大纲：\n\n"
                "## 第一幕：命运的相遇\n\n"
                "**场景**：清晨的城市公园，阳光穿过梧桐树叶洒在长椅上。\n\n"
                "**人物**：\n"
                "- 林晓（女主，28岁，独立插画师）\n"
                "- 陈远（男主，32岁，建筑师）\n\n"
                "**情节**：\n"
                "1. 林晓在长椅上画速写，一只金毛犬叼走了她的铅笔\n"
                "2. 陈远追着狗出现，两人首次对视\n"
                "3. 微妙的眼神交流，陈远归还铅笔时手碰手\n"
                "4. 林晓注意到他的手指上沾着蓝色颜料\n\n"
                "**对白片段**：\n"
                "> 林晓：\"你的狗？\"\n"
                "> 陈远：\"不，我只是个被它选中的人。\"\n"
                "> （轻笑声）\n"
                "> 林晓：\"它很有品味。那支铅笔是我最喜欢的。\"\n"
                "> 陈远：\"那我代表这只野蛮的狗向你道歉。\"\n\n"
                "**伏笔**：林晓的画本里有一张陈远十年前在建筑系获奖的照片。"
            ),
        },
        "代码": {
            "thinking": (
                "用户需要代码实现。检查需求：SSE 流式端点示例。\n"
                "应该使用 sse_starlette 库，FastAPI 框架。\n"
                "需要包含异步生成器和适当的错误处理。"
            ),
            "content": (
                "我来帮你实现这个功能：\n\n"
                "```python\n"
                "# FastAPI SSE 流式端点示例\n"
                "from fastapi import FastAPI\n"
                "from sse_starlette.sse import EventSourceResponse\n"
                "import asyncio\n\n"
                "app = FastAPI()\n\n"
                "@app.get(\"/api/stream\")\n"
                "async def stream_endpoint():\n"
                "    async def event_generator():\n"
                "        for i in range(10):\n"
                "            yield {\n"
                '                "event": "message",\n'
                '                "data": f"数据块 #{i}: {i * i}"\n'
                "            }\n"
                "            await asyncio.sleep(0.5)\n"
                "    return EventSourceResponse(event_generator())\n"
                "```\n\n"
                "**说明**：\n"
                "- 使用 `sse_starlette` 库实现 SSE\n"
                "- 每个数据块间隔 500ms 模拟流式效果\n"
                "- 前端通过 `EventSource` API 接收"
            ),
        },
        "分析": {
            "thinking": (
                "需要对项目进行系统分析。考察维度：技术架构、风险、优化方向。\n"
                "该项目采用 React + FastAPI + SQLite 技术栈，是典型的全栈架构。\n"
                "潜在风险包括数据库迁移、SSE 并发、以及多租户数据隔离。"
            ),
            "content": (
                "## 项目分析报告\n\n"
                "基于当前上下文，我对该项目进行了系统分析：\n\n"
                "### 技术架构评估\n"
                "- **前端**：React + TailwindCSS，组件化程度良好\n"
                "- **后端**：FastAPI 异步框架，性能优秀\n"
                "- **数据库**：SQLite（开发）/ PostgreSQL（生产）\n\n"
                "### 风险识别\n"
                "1. ⚠️ 数据库迁移策略需要提前规划\n"
                "2. ⚠️ SSE 连接在大规模并发下需要负载均衡\n"
                "3. ✅ 多租户隔离设计合理\n\n"
                "### 优化建议\n"
                "- 引入 Redis 缓存高频部门技能查询\n"
                "- WebSocket 备选方案用于更复杂的双向通信"
            ),
        },
    }

    _DEFAULT_THINKING = "正在分析用户意图...\n检索相关上下文...\n组织回答结构..."
    _DEFAULT_CONTENT = "好的，我收到了你的消息。请告诉我更多细节，以便我提供更精准的帮助。"

    async def chat(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        project_id: Optional[str] = None,
        file_paths: Optional[list[str]] = None,
    ) -> AsyncGenerator[Dict[str, str], None]:
        """
        模拟 Hermes 流式输出 (附带 <think> 思考过程)。
        输出格式与 HermesCLIBridge 完全相同。
        """
        # 根据 Prompt 关键词匹配预设回复
        matched = self.SIMULATED_RESPONSES.get("分析")
        for keyword, resp in self.SIMULATED_RESPONSES.items():
            if keyword in prompt:
                matched = resp
                break

        thinking = matched.get("thinking", self._DEFAULT_THINKING)
        content = matched.get("content", self._DEFAULT_CONTENT)

        # ── 流式输出思考过程 ──
        for i in range(0, len(thinking), 6):
            chunk = thinking[i:i + 6]
            yield {"type": "thinking", "delta": chunk}
            await asyncio.sleep(0.02)

        # 小停顿（模拟思考→输出切换）
        await asyncio.sleep(0.15)

        # ── 流式输出正文 ──
        for i in range(0, len(content), 8):
            chunk = content[i:i + 8]
            yield {"type": "content", "delta": chunk}
            await asyncio.sleep(0.025)

        yield {"type": "done", "delta": ""}


# ════════════════════════════════════════════════════════════════════
#  工厂函数：根据环境自动选择桥接器
# ════════════════════════════════════════════════════════════════════

def get_bridge() -> HermesCLIBridge | HermesBridgeSimulator:
    """
    返回可用的桥接器实例。
    优先使用真实 Hermes CLI，不可用时降级为模拟器。
    """
    if HERMES_AVAILABLE:
        logger.info(f"✅ 使用真实 Hermes CLI: {settings.HERMES_CLI_PATH}")
        return HermesCLIBridge()
    else:
        logger.info("🔄 回退到 Hermes 模拟器")
        return HermesBridgeSimulator()
