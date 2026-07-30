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

    // 401 → 清除登录态并跳转（仅在非登录请求时）
    if (res.status === 401 && !path.includes('/auth/login')) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('登录已过期，请重新登录');
    }

    // 非 2xx 响应 → 解析错误信息抛出
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `请求失败 (HTTP ${res.status})` }));
      let msg: string;
      if (typeof err.detail === 'string') {
        msg = err.detail;
      } else if (Array.isArray(err.detail)) {
        // Pydantic validation errors → show user-friendly message
        msg = '输入格式不正确，请检查后重试';
      } else {
        msg = `请求失败 (HTTP ${res.status})`;
      }
      throw new Error(msg);
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

  // ── Users ──
  getUsers: () => request('/auth/users'),
  updateUser: (id: string, data: any) =>
    request(`/auth/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) =>
    request(`/auth/users/${id}`, { method: 'DELETE' }),

  // ── Models ──
  getCurrentModel: () => request('/models/current'),
  getModelProviders: () => request('/models/providers'),
  getAvailableModels: () => request('/models/all'),
  switchModel: (data: { model: string; provider?: string; base_url?: string; thinking?: boolean; thinking_effort?: string }) =>
    request('/models/switch', { method: 'PUT', body: JSON.stringify(data) }),
  getProjectModel: (projectId: string) => request(`/models/project/${projectId}`),
  setProjectModel: (projectId: string, data: any) =>
    request(`/models/project/${projectId}`, { method: 'PUT', body: JSON.stringify(data) }),
  addCustomModel: (data: any) =>
    request('/models/custom', { method: 'POST', body: JSON.stringify(data) }),
  deleteCustomModel: (modelId: string) =>
    request(`/models/custom/${modelId}`, { method: 'DELETE' }),

  // ── Departments ──
  getDepartments: () => request('/departments/'),

  // ── Projects ──
  getProjects: (params?: string) =>
    request(`/projects/${params ? '?' + params : ''}`),

  getTokenStats: () => request('/projects/token-stats'),

  getProject: (id: string) => request(`/projects/${id}`),

  createProject: (data: any) =>
    request('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProject: (id: string, data: { name?: string; description?: string; status?: string }) =>
    request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) =>
    request(`/projects/${id}`, { method: 'DELETE' }),

  archiveProject: (id: string, generateSkills = true) =>
    request(`/projects/${id}/archive`, {
      method: 'POST',
      body: JSON.stringify({ generate_skills: generateSkills }),
    }),

  // ── Messages ──
  getMessages: (projectId: string) => request(`/messages/${projectId}`),
  getMessagesWithOffset: (projectId: string, offset: number, limit: number) =>
    request(`/messages/${projectId}?offset=${offset}&limit=${limit}`),

  // ── Skills ──
  getSkills: (departmentId?: string) =>
    request(`/skills/${departmentId ? '?department_id=' + departmentId : ''}`),

  getNativeSkills: () => request('/skills/native'),

  getGlobalSkills: () => request('/skills/global'),

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
  browseFolder: (path: string) =>
    request('/files/browse', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  revealInFinder: (path: string) =>
    request('/files/reveal', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  openFile: (path: string) =>
    request('/files/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  pickFolder: async (): Promise<{ cancelled: boolean; path: string | null }> => {
    // 特殊处理：无超时限制（用户可能需要很长时间选择文件夹）
    const token = localStorage.getItem('access_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/files/pick-folder`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) throw new Error(`请求失败 (HTTP ${res.status})`);
    return res.json();
  },

  // ── Locks (项目协作锁定) ──
  getLockStatus: (projectId: string) => request(`/locks/status/${projectId}`),
  acquireLock: (projectId: string) => request('/locks/acquire', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  releaseLock: (projectId: string) => request('/locks/release', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  requestTransfer: (projectId: string) => request('/locks/request-transfer', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  getPendingRequests: () => request('/locks/pending-requests'),
  getMyRequests: () => request('/locks/my-requests'),
  respondTransfer: (requestId: string, approved: boolean) => request('/locks/respond-transfer', { method: 'POST', body: JSON.stringify({ request_id: requestId, approved }) }),
  forceTakeover: (projectId: string) => request('/locks/force-takeover', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  getAllLocks: () => request('/locks/all-locks'),
  getNotifications: () => request('/locks/notifications'),

  // ── Folders (项目文件夹) ──
  getFolders: (departmentId?: string) =>
    request(`/folders/${departmentId ? `?department_id=${departmentId}` : ''}`),
  createFolder: (data: { name: string; color: string; department_id: string }) =>
    request('/folders/', { method: 'POST', body: JSON.stringify(data) }),
  updateFolder: (folderId: string, data: { name?: string; color?: string; department_ids?: string[] }) =>
    request(`/folders/${folderId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFolder: (folderId: string) =>
    request(`/folders/${folderId}`, { method: 'DELETE' }),
  moveProjectToFolder: (projectId: string, folderId: string | null) =>
    request(`/folders/${folderId || 'none'}/move-project?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ folder_id: folderId }),
    }),
  triggerClusterMemory: (folderId: string) =>
    request(`/folders/${folderId}/cluster-memory`, { method: 'POST' }),
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
    onHealthChange?: (status: 'connected' | 'stale' | 'timeout') => void;
  },
  filePaths?: string[],
  attachments?: Array<{ filename: string; size: number; stored_path?: string; content_type?: string }>
): AbortController {
  const controller = new AbortController();
  const token = localStorage.getItem('access_token');

  // ── 连接健康监测 ──
  let lastDataTime = Date.now();
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let streamStarted = false; // 收到第一个数据后才开始计时
  const STALE_THRESHOLD = 30000  // 30秒无数据 → 疑似卡住
  const TIMEOUT_THRESHOLD = 120000 // 120秒无数据 → 超时

  const startHealthMonitor = () => {
    healthCheckTimer = setInterval(() => {
      // 还没收到第一个数据时不检查（等待后端响应）
      if (!streamStarted) return
      const elapsed = Date.now() - lastDataTime
      if (elapsed > TIMEOUT_THRESHOLD) {
        callbacks.onHealthChange?.('timeout')
        callbacks.onError?.(`响应超时（${Math.round(elapsed / 1000)}秒无数据），连接可能已断开`)
        controller.abort()
        if (healthCheckTimer) clearInterval(healthCheckTimer)
      } else if (elapsed > STALE_THRESHOLD) {
        callbacks.onHealthChange?.('stale')
      }
    }, 5000)
  }

  const stopHealthMonitor = () => {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer)
      healthCheckTimer = null
    }
  }

  const touchData = () => {
    lastDataTime = Date.now()
    if (!streamStarted) streamStarted = true
    callbacks.onHealthChange?.('connected')
  }

  startHealthMonitor()

  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project_id: projectId,
      content,
      file_paths: filePaths || [],
      attachments: attachments || [],
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        stopHealthMonitor()
        const errBody = await response.text().catch(() => '');
        callbacks.onError?.(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        stopHealthMonitor()
        callbacks.onError?.('无法读取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          stopHealthMonitor()
          callbacks.onHealthChange?.('connected')
          break;
        }

        touchData() // 有数据到达，刷新健康计时器
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
      stopHealthMonitor()
      if (err.name !== 'AbortError') {
        const msg = err.name === 'TypeError' && err.message.includes('fetch')
          ? '网络连接失败，请确认后端服务已启动'
          : err.message;
        callbacks.onError?.(msg);
      }
    });

  return controller;
}

// ── 后台对话状态与恢复 ──
export function getChatStatus(projectId: string): Promise<{ status: string; chunk_count?: number; message_id?: string }> {
  return request(`/chat/status/${projectId}`);
}

export function resumeChat(projectId: string, callbacks: {
  onContent?: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onContext?: (data: any) => void;
  onDone?: (data: any) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}) {
  const token = localStorage.getItem('access_token');
  const baseUrl = getApiBase();
  const url = `${baseUrl}/chat/resume/${projectId}`;

  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
  }).then(async response => {
    if (response.status === 404) { callbacks.onDone?.({ _no_task: true }); return }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (line.startsWith('event: ')) { currentEvent = line.slice(7); }
        else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          switch (data.type) {
            case 'content_chunk': callbacks.onContent?.(data.content || ''); break;
            case 'thinking_chunk': callbacks.onThinking?.(data.content || ''); break;
            case 'context': callbacks.onContext?.(data); break;
            case 'done':
              callbacks.onDone?.(data);
              return;
            case 'error': callbacks.onError?.(data.content || ''); return;
            case 'status': callbacks.onStatus?.(data.content || ''); break;
          }
        }
      }
    }
  }).catch((err: any) => callbacks.onError?.(err.message || '恢复失败'));
}
