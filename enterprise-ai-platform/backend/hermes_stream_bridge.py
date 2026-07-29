#!/usr/bin/env python3
"""
Hermes Stream Bridge — 直接调用 Hermes Python 模块实现流式输出

在 Hermes venv (Python 3.11) 中运行，输出 NDJSON 流到 stdout：
  {"type": "status", "content": "模型加载中..."}
  {"type": "thinking_chunk", "content": "..."}
  {"type": "content_chunk", "content": "..."}
  {"type": "tool_call", "tool": "...", "args": "..."}
  {"type": "tool_result", "tool": "...", "result": "..."}
  {"type": "context", "tokens": 1234, "max": 128000}
  {"type": "done", "message_id": "..."}
  {"type": "error", "content": "..."}

用法：python3 hermes_stream_bridge.py "用户消息"
"""

import sys
import json
import os
import time

# ═══ 关键：禁用 stdout/stderr 缓冲 ═══
# PYTHONUNBUFFERED=1 已由父进程注入，这里做双重保障
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(line_buffering=True)

# 将 hermes 源码路径加入 sys.path
HERMES_SRC = os.path.expanduser("~/.hermes/hermes-agent")
sys.path.insert(0, HERMES_SRC)


def write_json(obj: dict):
    """输出一行 NDJSON 并强制立即 flush 到管道"""
    line = json.dumps(obj, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main():
    # 获取 prompt
    if len(sys.argv) > 1:
        prompt = sys.argv[1]
    else:
        prompt = sys.stdin.read().strip()

    if not prompt:
        write_json({"type": "error", "content": "Empty prompt"})
        sys.exit(1)

    # 检查 hermes 环境
    if not os.path.isdir(HERMES_SRC):
        write_json({"type": "error", "content": f"Hermes source not found at {HERMES_SRC}"})
        sys.exit(1)

    # ── 移除代理环境变量（防止 DeepSeek API 请求走本地代理导致 502/TLS 断连）──
    for proxy_key in (
        "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
        "ALL_PROXY", "all_proxy",
    ):
        os.environ.pop(proxy_key, None)
    os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1,*.local"

    try:
        from hermes_cli.config import load_config
        from hermes_cli.models import detect_provider_for_model
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from hermes_cli.tools_config import _get_platform_tools
        from run_agent import AIAgent
    except ImportError as e:
        write_json({"type": "error", "content": f"Hermes import failed: {e}"})
        sys.exit(1)

    # ── 读取系统提示词（含附件内容） ──
    system_prompt = os.environ.get("HERMES_SYSTEM_PROMPT", "")
    # 将系统提示词拼接到用户 prompt 前面
    if system_prompt:
        prompt = f"[System Instructions]\n{system_prompt}\n\n[User Message]\n{prompt}"

    try:
        # ── 配置加载 ──
        cfg = load_config()
        model_cfg = cfg.get("model") or {}
        if isinstance(model_cfg, str):
            cfg_model = model_cfg
        else:
            cfg_model = model_cfg.get("default") or model_cfg.get("model") or ""

        env_model = os.getenv("HERMES_INFERENCE_MODEL", "").strip()
        effective_model = env_model or cfg_model

        # 获取 provider
        cfg_provider = ""
        if isinstance(model_cfg, dict):
            cfg_provider = str(model_cfg.get("provider") or "").strip().lower()

        current_provider = (
            cfg_provider
            or os.getenv("HERMES_INFERENCE_PROVIDER", "").strip().lower()
            or "auto"
        )
        detected = detect_provider_for_model(effective_model, current_provider)
        if detected:
            effective_provider, effective_model = detected
        else:
            effective_provider = current_provider

        runtime = resolve_runtime_provider(
            requested=effective_provider or None,
            target_model=effective_model or None,
        )

        toolsets_list = sorted(_get_platform_tools(cfg, "cli"))

        write_json({
            "type": "status",
            "content": f"模型: {effective_model} | Provider: {runtime.get('provider', 'auto')}"
        })
        write_json({
            "type": "context",
            "model": effective_model,
            "provider": runtime.get("provider", "auto"),
            "tokens_used": 0,
            "max_tokens": 128000,
        })

        # ── 创建 Agent（带流式回调） ──
        thinking_active = [False]
        thinking_buf = []
        content_buf = []

        def stream_delta(delta_text: str):
            """
            AIAgent 的流式回调。hermes 的 run_agent 会在推理过程中逐 token 调用此函数。
            文本可能包含 <think> 标签。
            """
            text = delta_text
            # 简易 <think> 标签状态机
            while text:
                if '<think>' in text and not thinking_active[0]:
                    idx = text.index('<think>')
                    if idx > 0:
                        write_json({"type": "content_chunk", "content": text[:idx]})
                        content_buf.append(text[:idx])
                    thinking_active[0] = True
                    text = text[idx + 7:]  # skip <think>
                    continue

                if '</think>' in text and thinking_active[0]:
                    idx = text.index('</think>')
                    if idx > 0:
                        write_json({"type": "thinking_chunk", "content": text[:idx]})
                        thinking_buf.append(text[:idx])
                    thinking_active[0] = False
                    text = text[idx + 8:]  # skip </think>
                    continue

                if thinking_active[0]:
                    write_json({"type": "thinking_chunk", "content": text})
                    thinking_buf.append(text)
                else:
                    write_json({"type": "content_chunk", "content": text})
                    content_buf.append(text)
                break

        # 设置环境变量（oneshot 模式）
        os.environ["HERMES_YOLO_MODE"] = "1"
        os.environ["HERMES_ACCEPT_HOOKS"] = "1"

        write_json({"type": "status", "content": "Agent 初始化完成，开始推理..."})

        agent = AIAgent(
            api_key=runtime.get("api_key"),
            base_url=runtime.get("base_url"),
            provider=runtime.get("provider"),
            api_mode=runtime.get("api_mode"),
            model=effective_model,
            enabled_toolsets=toolsets_list,
            quiet_mode=True,
            platform="cli",
            credential_pool=runtime.get("credential_pool"),
        )

        # 尝试设置流式回调（如果 AIAgent 支持的话）
        if hasattr(agent, 'stream_delta_callback'):
            agent.stream_delta_callback = stream_delta
        if hasattr(agent, 'suppress_status_output'):
            agent.suppress_status_output = False

        # ── 运行对话 ──
        start_time = time.time()
        result = agent.run_conversation(prompt)
        elapsed = time.time() - start_time

        final_response = result.get("final_response") or ""

        # 收集统计信息
        input_tokens = result.get("input_tokens", 0)
        output_tokens = result.get("output_tokens", 0)
        total_tokens = result.get("total_tokens", input_tokens + output_tokens)

        write_json({
            "type": "context",
            "model": effective_model,
            "provider": runtime.get("provider", "auto"),
            "tokens_used": total_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "elapsed_seconds": round(elapsed, 1),
        })

        write_json({
            "type": "done",
            "content": final_response,
            "thinking": "".join(thinking_buf) if thinking_buf else None,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        })

        try:
            agent.close()
        except Exception:
            pass

    except Exception as e:
        import traceback
        write_json({
            "type": "error",
            "content": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc()[-500:],
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
