/**
 * API 客户端
 *
 * 动态检测当前访问域名，直接请求后端（backend:8000），绕过 Vite proxy
 * 避免 SSE 流式响应被代理缓冲的问题
 */
const API_BASE = `http://${window.location.hostname}:8000/api`;

/**
 * 通用请求封装 — 带超时控制与统一错误处理
 */
async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = localStorage.getItem('access_token');

  // 构建请求头
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // AbortController 超时控制（15秒）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      body: options.body,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 401 → 清除登录态并跳转
    if (res.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('登录已过期，请重新登录');
    }

    // 非 2xx 响应 → 解析错误信息抛出
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `请求失败 (HTTP ${res.status})` }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    return res.json();
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }

    // 已是业务错误（上面 throw 的），直接传递
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }

    // 网络错误（fetch 自身失败）
    throw new Error('网络连接失败，请确认后端服务已启动（http://localhost:8000）');
  }
}

export const api = {
  // ── Auth ──
  login: (username: string, password: string) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (data: any) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => request('/auth/me'),

  // ── Departments ──
  getDepartments: () => request('/departments/'),

  // ── Projects ──
  getProjects: (params?: string) =>
    request(`/projects/${params ? '?' + params : ''}`),

  getProject: (id: string) => request(`/projects/${id}`),

  createProject: (data: any) =>
    request('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProject: (id: string, data: { name?: string; description?: string }) =>
    request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  archiveProject: (id: string, generateSkills = true) =>
    request(`/projects/${id}/archive`, {
      method: 'POST',
      body: JSON.stringify({ generate_skills: generateSkills }),
    }),

  // ── Messages ──
  getMessages: (projectId: string) => request(`/messages/${projectId}`),

  // ── Skills ──
  getSkills: (departmentId?: string) =>
    request(`/skills/${departmentId ? '?department_id=' + departmentId : ''}`),

  getNativeSkills: () => request('/skills/native'),

  searchSkills: (q: string) => request(`/skills/search?q=${encodeURIComponent(q)}`),

  createSkill: (data: any) =>
    request('/skills/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSkill: (id: string, data: any) =>
    request(`/skills/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Artifacts ──
  getArtifacts: (projectId: string) => request(`/artifacts/project/${projectId}`),
  scanArtifacts: (projectId: string) =>
    request(`/artifacts/scan/${projectId}`, { method: 'POST' }),

  // ── Files ──
  getProjectFiles: (projectId: string) => request(`/files/project/${projectId}`),
  revealInFinder: (path: string) =>
    request('/files/reveal', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
};

// ── SSE 流式聊天 ──
// 使用 fetch + ReadableStream（比原生 EventSource 更灵活，支持 POST + Authorization）
export function chatStream(
  projectId: string,
  content: string,
  callbacks: {
    onContent?: (chunk: string) => void;
    onThinking?: (chunk: string) => void;
    onStatus?: (msg: string) => void;
    onContext?: (data: string) => void;
    onToolCall?: (data: string) => void;
    onToolResult?: (data: string) => void;
    onQueue?: (msg: string) => void;
    onDone?: (messageId: string) => void;
    onError?: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();
  const token = localStorage.getItem('access_token');

  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project_id: projectId, content }),
    signal: controller.signal,
  })
    .then(async (response) => {
      console.log('[SSE] 响应状态:', response.status, response.ok);
      console.log('[SSE] Content-Type:', response.headers.get('content-type'));
      console.log('[SSE] Access-Control-Allow-Origin:', response.headers.get('access-control-allow-origin'));

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error('[SSE] HTTP 错误:', response.status, errBody.slice(0, 200));
        callbacks.onError?.(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[SSE] response.body.getReader() 返回 null');
        callbacks.onError?.('无法读取响应流 (response.body 不可用)');
        return;
      }

      console.log('[SSE] ReadableStream reader 已获取，开始读取...');
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[SSE] 流结束, 共接收 ${chunkCount} 个数据块`);
          break;
        }

        chunkCount++;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let line of lines) {
          // Strip \r (CR) from SSE line endings — \r\n → \n splitting leaves trailing \r
          // which breaks /^data: (.+)$/ because $ in non-multiline mode matches at end-of-string only
          line = line.replace(/\r/g, '');
          
          // 跳过空行和 SSE 注释行（如 heartbeat）
          if (!line.trim() || line.startsWith(':')) continue;

          const eventMatch = line.match(/^event: (.+)$/);
          const dataMatch = line.match(/^data: (.+)$/);

          if (eventMatch) {
            currentEvent = eventMatch[1];
            continue;
          }

          if (dataMatch) {
            // 日志：打印原始行用于调试
            if (chunkCount <= 3) console.log('[SSE] 原始行:', line.slice(0, 120));
            
            let jsonStr = '';
            try {
              jsonStr = dataMatch[1];
              const data = JSON.parse(jsonStr);
              console.log('[SSE] 收到事件:', data.type, jsonStr.slice(0, 80));
              switch (data.type) {
                case 'content_chunk':
                  callbacks.onContent?.(data.content);
                  break;
                case 'thinking_chunk':
                case 'thinking':
                  callbacks.onThinking?.(data.content);
                  break;
                case 'status':
                  callbacks.onStatus?.(data.content);
                  break;
                case 'context':
                  callbacks.onContext?.(data.content);
                  break;
                case 'tool_call':
                  callbacks.onToolCall?.(data.content);
                  break;
                case 'tool_result':
                  callbacks.onToolResult?.(data.content);
                  break;
                case 'queue':
                  callbacks.onQueue?.(data.content);
                  break;
                case 'done':
                  console.log('[SSE] 对话完成, message_id:', data.message_id);
                  callbacks.onDone?.(data.message_id);
                  break;
                case 'error':
                  console.error('[SSE] 后端错误:', data.content);
                  callbacks.onError?.(data.content);
                  break;
              }
            } catch (parseErr) {
              console.warn('[SSE] JSON 解析失败, raw:', jsonStr.slice(0, 120), String(parseErr));
            }
          }
        }
      }
    })
    .catch((err) => {
      console.error('[SSE] fetch 异常:', err.name, err.message);
      if (err.name !== 'AbortError') {
        const msg = err.name === 'TypeError' && err.message.includes('fetch')
          ? '网络连接失败，请确认后端服务已启动'
          : err.message;
        callbacks.onError?.(msg);
      }
    });

  return controller;
}
