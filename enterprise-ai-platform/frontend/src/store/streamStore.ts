/**
 * 全局流式对话状态管理 — Zustand Store
 *
 * SSE 连接在 store 中持久运行，不随 React 组件卸载而断开。
 * 切换工作流时：SSE 继续执行，回来时状态完整保留。
 */
import { create } from 'zustand'
import { chatStream, resumeChat } from '../services/api'

export interface StreamState {
  projectId: string
  streaming: boolean
  content: string
  thinking: string
  status: string
  model: string
  provider: string
  tokensUsed: number
  abort: (() => void) | null
}

interface StreamStore {
  streams: Record<string, StreamState>

  /** 启动流式对话 */
  startStream: (projectId: string, prompt: string, filePaths?: string[]) => void

  /** 恢复后台流 */
  resumeStream: (projectId: string) => void

  /** 停止流 */
  stopStream: (projectId: string) => void

  /** 获取或创建项目的流状态 */
  getStream: (projectId: string) => StreamState
}

function defaultState(projectId: string): StreamState {
  return {
    projectId,
    streaming: false,
    content: '',
    thinking: '',
    status: '空闲',
    model: '',
    provider: '',
    tokensUsed: 0,
    abort: null,
  }
}

export const useStreamStore = create<StreamStore>((set, get) => ({
  streams: {},

  getStream: (projectId: string) => {
    return get().streams[projectId] || defaultState(projectId)
  },

  startStream: (projectId: string, prompt: string, filePaths?: string[]) => {
    const existing = get().streams[projectId]
    if (existing?.streaming) {
      existing.abort?.()
    }

    const state = { ...defaultState(projectId), streaming: true, status: '正在连接...' }
    set(s => ({ streams: { ...s.streams, [projectId]: state } }))

    const controller = chatStream(projectId, prompt, {
      onStatus: (msg) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: { ...(s.streams[projectId] || state), status: msg },
          },
        }))
      },
      onThinking: (chunk) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || state),
              thinking: (s.streams[projectId]?.thinking || '') + chunk,
            },
          },
        }))
      },
      onContent: (chunk) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || state),
              content: (s.streams[projectId]?.content || '') + chunk,
            },
          },
        }))
      },
      onContext: (data: string) => {
        try {
          const ctx = JSON.parse(data)
          set(s => ({
            streams: {
              ...s.streams,
              [projectId]: {
                ...(s.streams[projectId] || state),
                model: ctx.model || '',
                provider: ctx.provider || '',
                tokensUsed: (s.streams[projectId]?.tokensUsed || 0) + (ctx.tokens_used || 0),
                status: ctx.elapsed_seconds > 0 ? '完成' : '推理中...',
              },
            },
          }))
        } catch {}
      },
      onDone: (messageId) => {
        // Dispatch event FIRST (so handler can read content before we clear state)
        window.dispatchEvent(new CustomEvent('stream-done', { detail: { projectId, messageId } }))
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || state),
              streaming: false,
              status: '空闲',
            },
          },
        }))
      },
      onError: (err) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || state),
              streaming: false,
              status: '错误',
              content: (s.streams[projectId]?.content || '') + `\n\n> ⚠️ ${err}`,
            },
          },
        }))
      },
      onHealthChange: () => {},
      onToolCall: () => {},
    }, filePaths)

    set(s => ({
      streams: {
        ...s.streams,
        [projectId]: { ...(s.streams[projectId] || state), abort: () => controller?.abort() },
      },
    }))
  },

  resumeStream: (projectId: string) => {
    const existing = get().streams[projectId]
    if (!existing) return

    set(s => ({
      streams: {
        ...s.streams,
        [projectId]: { ...existing, streaming: true, status: '正在恢复...' },
      },
    }))

    resumeChat(projectId, {
      onStatus: (msg) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: { ...(s.streams[projectId] || existing), status: msg },
          },
        }))
      },
      onThinking: (chunk) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || existing),
              thinking: (s.streams[projectId]?.thinking || '') + chunk,
            },
          },
        }))
      },
      onContent: (chunk) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: {
              ...(s.streams[projectId] || existing),
              content: (s.streams[projectId]?.content || '') + chunk,
            },
          },
        }))
      },
      onContext: (ctx: any) => {
        try {
          const c = typeof ctx === 'string' ? JSON.parse(ctx) : ctx
          set(s => ({
            streams: {
              ...s.streams,
              [projectId]: { ...(s.streams[projectId] || existing), model: c.model || '', provider: c.provider || '' },
            },
          }))
        } catch {}
      },
      onDone: (data: any) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: { ...(s.streams[projectId] || existing), streaming: false, status: '空闲' },
          },
        }))
        if (!data._no_task) {
          window.dispatchEvent(new CustomEvent('stream-done', { detail: { projectId, messageId: data.message_id } }))
        }
      },
      onError: (msg: string) => {
        set(s => ({
          streams: {
            ...s.streams,
            [projectId]: { ...(s.streams[projectId] || existing), streaming: false, status: '空闲' },
          },
        }))
      },
    })
  },

  stopStream: (projectId: string) => {
    const s = get().streams[projectId]
    s?.abort?.()
    set(state => ({
      streams: {
        ...state.streams,
        [projectId]: { ...(state.streams[projectId] || defaultState(projectId)), streaming: false, status: '已终止' },
      },
    }))
  },
}))
