import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { useStreamStore } from '../store/streamStore'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { api, chatStream } from '../services/api'
import { useAuthStore, useVideoStore } from '../store'
import { getModelConfigs, getActiveModelId, setActiveModelId, type ModelConfig } from '../components/settings/SettingsModal'
import ImageViewer from '../components/media/ImageViewer'
import VideoPlayer from '../components/media/VideoPlayer'
import FloatingWindow from '../components/media/FloatingWindow'
import { useProjectSkills, skillSourceColor, extractHistorySkills } from '../hooks/useProjectSkills'
import ChatInput from '../components/chat/ChatInput'
import {
  Archive, FileText, BookOpen, ChevronDown, ChevronRight,
  Loader2, Bot, User, Sparkles, AlertCircle, Copy, X, Zap,
  Activity, Cpu, Clock, BarChart3, Wrench, Brain, Pause, Play,
  FolderOpen, Grid3X3, List, Folder, File, FolderTree, ExternalLink, Check,
  Search, Plus, XCircle, Info, Paperclip, GripVertical, Pencil, Square, ArrowUp, FolderInput, RefreshCw, ChevronLeft
} from 'lucide-react'

interface MessageAttachment {
  filename: string
  size: number
  stored_path?: string
  content_type?: string
}

interface Message {
  id: string
  sender_type: string
  sender_name: string
  content: string
  thinking_content: string | null
  attachments?: MessageAttachment[] | null
  timestamp: string
  tokens_used?: number
}

interface Artifact {
  id: string
  title: string
  content: string
  file_type: string
  created_at: string
  artifact_path?: string | null
  file_size?: number
}

interface Skill {
  id: string
  skill_name: string
  category: string
  is_native?: boolean
  usage_count?: number
  department_id?: string
  source?: string
  description?: string
  import_source?: string
  metadata_json?: string
  content_prompt?: string
}

interface HermesStatus {
  model: string
  provider: string
  tokensUsed: number
  inputTokens: number
  outputTokens: number
  elapsed: number
  status: string
}

interface LockState {
  locked: boolean
  editor_id?: string
  editor_username?: string
  editor_display_name?: string
  is_me: boolean
  is_admin: boolean
  is_dept_admin: boolean
  can_takeover: boolean
}

interface TransferRequestItem {
  request_id: string
  project_id: string
  from_user_id: string
  from_username: string
  from_display_name: string
  to_user_id: string
  to_display_name: string
  status: string
}

interface QueuedTask {
  id: string
  content: string
  files: any[]
  timestamp: string
}

function fileIconColor(ext: string): string {
  const colors: Record<string, string> = {
    '.xlsx': 'text-green-300', '.xls': 'text-green-300', '.csv': 'text-green-300',
    '.py': 'text-blue-300', '.js': 'text-yellow-300', '.ts': 'text-blue-300',
    '.tsx': 'text-cyan-300', '.jsx': 'text-yellow-300',
    '.md': 'text-amber-300', '.txt': 'text-gray-300',
    '.pdf': 'text-red-300', '.docx': 'text-blue-300', '.doc': 'text-blue-300',
    '.rtf': 'text-purple-300',
    '.png': 'text-fuchsia-300', '.jpg': 'text-fuchsia-300', '.jpeg': 'text-fuchsia-300',
    '.gif': 'text-fuchsia-300', '.svg': 'text-pink-300', '.webp': 'text-pink-300',
    '.zip': 'text-gray-400', '.tar': 'text-gray-400', '.gz': 'text-gray-400',
    '.json': 'text-orange-300', '.yaml': 'text-orange-300', '.yml': 'text-orange-300',
    '.html': 'text-orange-300', '.css': 'text-sky-300',
    '.mp4': 'text-violet-300', '.mov': 'text-violet-300',
  }
  return colors[ext.toLowerCase()] || 'text-gray-300'
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function getFileExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx) : ''
}

function FileTreeNodes({ nodes, expanded, onToggle, viewMode, onContextMenu, onReveal, onFileClick, depth, iconViewPath, onIconViewNav }: {
  nodes: any[]
  expanded: Set<string>
  onToggle: (path: string) => void
  viewMode: string
  onContextMenu: (e: React.MouseEvent, path: string) => void
  onReveal: (path: string) => void
  onFileClick?: (path: string) => void
  depth: number
  iconViewPath: string[]
  onIconViewNav?: (path: string) => void
}) {
  if (viewMode === 'icon') {
    // Separate dirs and files for current icon view level
    const currentPath = iconViewPath.join('/')
    const dirs: any[] = []
    const files: any[] = []
    if (iconViewPath.length === 0) {
      for (const n of nodes) {
        if (n.type === 'directory') dirs.push(n)
        else files.push(n)
      }
    } else {
      let current = nodes
      for (const seg of iconViewPath) {
        const found = current.find((n: any) => n.type === 'directory' && n.name === seg)
        if (found && found.children) current = found.children
        else { current = []; break }
      }
      for (const n of current) {
        if (n.type === 'directory') dirs.push(n)
        else files.push(n)
      }
    }

    return (
      <div>
        {iconViewPath.length > 0 && (
          <div className="flex items-center gap-1 mb-2 text-[10px] text-gray-400 overflow-x-auto">
            <button onClick={() => onIconViewNav?.('')} className="hover:text-blue-400 shrink-0">📁 根目录</button>
            {iconViewPath.map((seg: string, i: number) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                <span className="text-gray-400">/</span>
                <button
                  onClick={() => onIconViewNav?.(iconViewPath.slice(0, i + 1).join('/'))}
                  className={`hover:text-blue-400 ${i === iconViewPath.length - 1 ? 'text-gray-300 font-medium' : ''}`}>
                  {seg}
                </button>
              </span>
            ))}
          </div>
        )}
        {iconViewPath.length > 0 && (
          <button onClick={() => onIconViewNav?.(iconViewPath.slice(0, -1).join('/'))}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-200 mb-2 px-2 py-1 rounded hover:bg-gray-800/50 w-full">
            <ChevronRight className="w-3 h-3 rotate-180" /> 返回上级
          </button>
        )}
        <div className="grid grid-cols-3 gap-2">
          {dirs.map((d: any, i: number) => (
            <div key={`dir-${i}`}
              onDoubleClick={() => {
                const newPath = iconViewPath.length === 0 ? d.name : iconViewPath.join('/') + '/' + d.name
                onIconViewNav?.(newPath)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu(e, d.stored_path || '')
              }}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-800/80 cursor-pointer group text-center">
              <FolderOpen className="w-7 h-7 text-blue-400" />
              <span className="text-[10px] text-gray-300 truncate w-full leading-tight">{d.name}</span>
            </div>
          ))}
          {files.map((f: any, i: number) => (
            <div key={`file-${i}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', f.stored_path || f.path)
                e.dataTransfer.effectAllowed = 'copy'
                window.dispatchEvent(new CustomEvent('sidebar-drop', {
                  detail: { name: f.name, path: f.path, stored_path: f.stored_path, ext: f.ext, size: f.size }
                }))
              }}
              onContextMenu={(e) => onContextMenu(e, f.stored_path)}
              onClick={() => onFileClick ? onFileClick(f.stored_path) : onReveal(f.stored_path)}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-800/80 cursor-pointer group text-center">
              <File className={`w-7 h-7 ${fileIconColor(f.ext || '')}`} />
              <span className="text-[10px] text-gray-300 truncate w-full leading-tight">{f.name}</span>
            </div>
          ))}
        </div>
        {dirs.length === 0 && files.length === 0 && (
          <p className="text-[10px] text-gray-500 text-center py-4">此文件夹为空</p>
        )}
      </div>
    )
  }

  // List view — tree
  return (
    <>
      {nodes.map((node: any, i: number) => {
        if (node.type === 'directory') {
          const isOpen = expanded.has(node.path)
          return (
            <div key={node.path}>
              <div
                onClick={() => onToggle(node.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  // For directories, just reveal the parent path
                  onContextMenu(e, node.path)
                }}
                className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-gray-800/80 cursor-pointer text-gray-300 hover:text-white transition-colors">
                <span className="w-3 h-3 flex items-center justify-center">
                  {isOpen ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                </span>
                {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-blue-400" /> : <Folder className="w-3.5 h-3.5 text-blue-400" />}
                <span className="truncate flex-1">{node.name}</span>
              </div>
              {isOpen && node.children && (
                <div className="pl-4">
                  <FileTreeNodes nodes={node.children} expanded={expanded} onToggle={onToggle}
                    viewMode={viewMode} onContextMenu={onContextMenu} onReveal={onReveal} onFileClick={onFileClick} depth={depth + 1}
                    iconViewPath={iconViewPath} onIconViewNav={onIconViewNav} />
                </div>
              )}
            </div>
          )
        }
        // File node
        return (
          <div key={node.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.stored_path || node.path)
              e.dataTransfer.effectAllowed = 'copy'
              window.dispatchEvent(new CustomEvent('sidebar-drop', {
                detail: { name: node.name, path: node.path, stored_path: node.stored_path, ext: node.ext, size: node.size }
              }))
            }}
            onContextMenu={(e) => onContextMenu(e, node.stored_path)}
            onClick={() => onFileClick ? onFileClick(node.stored_path) : onReveal(node.stored_path)}
            className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-gray-800/80 cursor-pointer group text-gray-300 hover:text-white transition-colors">
            <span className="w-3" />
            <File className={`w-3.5 h-3.5 shrink-0 ${fileIconColor(node.ext || '')}`} />
            <span className="truncate flex-1">{node.name}</span>
            <span className="text-[9px] text-gray-500 shrink-0 ml-1">{node.ext}</span>
          </div>
        )
      })}
    </>
  )
}

// ── Model Switcher Component ──
function ModelSwitcher({ hermesModel, hermesProvider, streaming, projectId }: { hermesModel: string; hermesProvider: string; streaming: boolean; projectId?: string }) {
  const [models, setModels] = useState<any[]>([])
  const [current, setCurrent] = useState<{ model: string; provider: string }>({ model: '', provider: '' })
  const [showDropdown, setShowDropdown] = useState(false)
  const [dExpanded, setDExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // Load available models + project preference
    Promise.all([
      api.getAvailableModels(),
      projectId ? api.getProjectModel(projectId).catch(() => null) : Promise.resolve(null),
    ]).then(([avail, projModel]) => {
      setModels(avail.models || [])
      if (projModel && projModel.model && !projModel.is_global) {
        // Validate project model is still in available list (prevents stale/deprecated models)
        const valid = (avail.models || []).some((m: any) => m.name === projModel.model && m.provider === projModel.provider)
        setCurrent(valid
          ? { model: projModel.model, provider: projModel.provider }
          : (avail.current || { model: '', provider: '' })
        )
      } else {
        setCurrent(avail.current || { model: '', provider: '' })
      }
    }).catch(() => {})
  }, [projectId])

  // Show Hermes model when streaming, otherwise show configured model
  const displayModel = streaming && hermesModel && hermesModel !== '--' ? hermesModel : (current.model || '—')
  const displayProvider = streaming && hermesProvider && hermesProvider !== '--' ? hermesProvider : (current.provider || '')

  const handleSwitch = async (model: any) => {
    if (model.active) { setShowDropdown(false); return }
    try {
      // Per-project model preference only — NEVER touch global config
      if (projectId) {
        await api.setProjectModel(projectId, { model: model.name, provider: model.provider, thinking: model.thinking }).catch(() => {})
      }
      setModels(prev => prev.map(m => ({ ...m, active: m.id === model.id })))
      setCurrent({ model: model.name, provider: model.provider })
      setShowDropdown(false)
      // Dispatch per-project switch notification
      window.dispatchEvent(new CustomEvent('model-switched', { detail: { from: current.model || '', to: model.name, projectId } }))
    } catch (e: any) {
      alert('切换失败')
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-800 transition-colors text-[11px]">
        <Cpu className={`w-3 h-3 ${streaming ? 'text-green-400 animate-pulse' : 'text-gray-400'}`} />
        <span className={streaming ? 'text-green-300 font-medium' : 'text-gray-300'}>{displayModel}</span>
        {displayProvider && <span className="text-gray-500">· {displayProvider}</span>}
      </button>
      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 py-1 max-h-72 overflow-y-auto">
            <div className="px-3 py-1.5 border-b border-gray-700">
              <p className="text-[10px] text-gray-500">切换模型</p>
            </div>
            {models.length > 0 ? (() => {
              const grouped: Record<string, any[]> = {}
              models.forEach(m => { if (!grouped[m.provider]) grouped[m.provider] = []; grouped[m.provider].push(m) })
              const providerNames: Record<string, string> = { deepseek: 'DeepSeek', dashscope: '通义千问', openai: 'OpenAI', anthropic: 'Anthropic' }
              return Object.entries(grouped).map(([provider, pModels]) => [
                <button key={provider} onClick={() => setDExpanded(prev => ({ ...prev, [provider]: !prev[provider] }))}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-700/50 transition-colors">
                  <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${dExpanded[provider] ? '' : '-rotate-90'}`} />
                  <span className="text-xs font-medium text-gray-300">{providerNames[provider] || provider}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">{pModels.length}</span>
                </button>,
                dExpanded[provider] && pModels.map((m: any) => (
                  <button key={m.id} onClick={() => handleSwitch(m)}
                    className={`w-full pl-8 pr-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${
                      m.active ? 'bg-indigo-500/10 text-indigo-400' : 'text-gray-300 hover:bg-gray-700'
                    }`}>
                    <span className="flex-1 truncate">{m.label || m.name}</span>
                    {m.thinking && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-full shrink-0">思考</span>}
                    {m.active && <Check className="w-3 h-3 text-indigo-400 shrink-0" />}
                  </button>
                ))
              ].flat())
            })() : (
              <p className="px-3 py-2 text-[10px] text-gray-600">无可用模型</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const [project, setProject] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeSkillIds, setActiveSkillIds] = useState<Set<string>>(new Set())
  const [skillUsageCounts, setSkillUsageCounts] = useState<Record<string, number>>({})
  const [input, setInput] = useState('')
  // Per-project input isolation — persists unsent text when switching projects
  const inputRef = useRef('')
  const inputCacheRef = useRef<Record<string, string>>({}) // deprecated, using localStorage
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [streaming, setStreaming] = useState(() => {
    const st = useStreamStore.getState().streams[projectId || '']
    return st?.streaming || false
  })
  const [streamContent, setStreamContent] = useState(() => {
    const st = useStreamStore.getState().streams[projectId || '']
    return st?.content || ''
  })
  const [streamThinking, setStreamThinking] = useState(() => {
    const st = useStreamStore.getState().streams[projectId || '']
    return st?.thinking || ''
  })

  // ── 从 store 持续同步（跨页面切换保持） ──
  const streamState = useStreamStore(s => s.streams[projectId || ''])
  useEffect(() => {
    if (!streamState) return
    if (streamState.streaming) {
      setStreaming(true)
      setStreamContent(streamState.content)
      setStreamThinking(streamState.thinking)
      setHermesStatus(prev => ({
        ...prev,
        status: streamState.status || '推理中...',
        model: streamState.model || prev.model,
        provider: streamState.provider || prev.provider,
        tokensUsed: streamState.tokensUsed || prev.tokensUsed,
      }))
    }
  }, [streamState?.content, streamState?.thinking, streamState?.status, streamState?.streaming])
  const [showThinking, setShowThinking] = useState(true)
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null)
  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [hermesStatus, setHermesStatus] = useState<HermesStatus>(() => {
    const st = useStreamStore.getState().streams[projectId || '']
    if (st?.streaming) {
      return { model: st.model || '--', provider: st.provider || '--', tokensUsed: st.tokensUsed, inputTokens: 0, outputTokens: 0, elapsed: 0, status: st.status || '推理中...' }
    }
    return { model: '--', provider: '--', tokensUsed: 0, inputTokens: 0, outputTokens: 0, elapsed: 0, status: '空闲' }
  })
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [totalMessages, setTotalMessages] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [paused, setPaused] = useState(false)
  // ── 连接健康状态 ──
  const [connectionHealth, setConnectionHealth] = useState<'idle' | 'connected' | 'stale' | 'timeout' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  // ── 项目协作锁定 ──
  const [lockState, setLockState] = useState<LockState>({ locked: false, is_me: false, is_admin: false })
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showIncomingRequest, setShowIncomingRequest] = useState<TransferRequestItem | null>(null)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const lockPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // ── 工作流文件浏览器 ──
  const [projectFiles, setProjectFiles] = useState<any[]>([])
  const [fileTree, setFileTree] = useState<any[]>([])
  const [fileViewMode, setFileViewMode] = useState<'list' | 'icon'>('list')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']))
  // ── 图标视图导航 ──
  const [iconViewPath, setIconViewPath] = useState<string[]>([])
  // ── 外部文件夹标签 ──
  interface ExternalFolderTab {
    id: string
    name: string
    path: string
    tree: any[]
    expanded: Set<string>
    viewMode: 'list' | 'icon'
    loading: boolean
    error: string
  }
  const [externalTabs, setExternalTabs] = useState<ExternalFolderTab[]>([])
  const [activeFileTab, setActiveFileTab] = useState<'project' | string>('project')
  const pickerLockRef = useRef(false)
  // ── 部门技能展开 ──
  const [expandedDeptSkill, setExpandedDeptSkill] = useState<string | null>(null)
  const [detailDeptSkill, setDetailDeptSkill] = useState<any | null>(null)
  const [deptContextMenu, setDeptContextMenu] = useState<{ x: number; y: number; skill: any } | null>(null)
  const [expandedDeptGroups, setExpandedDeptGroups] = useState<Set<string>>(new Set())
  // ── 全局拖放 ──
  const [globalDragOver, setGlobalDragOver] = useState(false)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ── 任务队列 ──
  const [taskQueue, setTaskQueue] = useState<QueuedTask[]>([])
  const [dragOverQueueIdx, setDragOverQueueIdx] = useState<number | null>(null)
  const queueDragRef = useRef<{ idx: number; startY: number } | null>(null)
  const autoSendPendingRef = useRef(false)
  // ── 产出物文件类型筛选 ──
  const [artifactTypeFilter, setArtifactTypeFilter] = useState<Set<string>>(new Set())  // empty = show all
  // ── 右键菜单 ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  // ── 复制反馈 ──
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // ── 面板大小调整 ──
  const [rightWidth, setRightWidth] = useState(288)
  const [bottomHeight, setBottomHeight] = useState(0)
  const [sectionHeights, setSectionHeights] = useState({ files: 180, skills: 160, artifacts: 0 }) // 0 = auto
  const resizeRef = useRef<{ target: string; startX: number; startY: number; startSize: number } | null>(null)

  // ── 右侧面板配置（可拖拽排序、折叠、隐藏） ──
  type PanelId = 'files' | 'skills' | 'artifacts'
  const PANEL_TITLES: Record<PanelId, string> = { files: '文件检视', skills: '技能', artifacts: '产出' }
  const PANEL_ICONS: Record<PanelId, any> = { files: FolderOpen, skills: BookOpen, artifacts: FileText }

  const panelOrder: PanelId[] = ['files', 'skills', 'artifacts']
  const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('collapsed_panels') || '[]')) } catch { return new Set() }
  })

  // 持久化折叠状态
  useEffect(() => { localStorage.setItem('collapsed_panels', JSON.stringify([...collapsedPanels])) }, [collapsedPanels])

  const togglePanelCollapse = (id: PanelId) => {
    setCollapsedPanels(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  // Refs to track streaming content for onDone (avoids stale closure)
  const streamContentRef = useRef('')
  const streamThinkingRef = useRef('')

  const initialLoadDone = useRef(false)
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  useEffect(() => {
    if (streaming) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [streamContent, streamThinking, streaming])

  // ── 项目切换时：保留后台流式 + 重置 UI 状态 ──
  useEffect(() => {
    // 注意：不终止 SSE 流！让后台继续完成，完成后消息会自动保存到 DB
    // 下次 loadData 时会从 DB 加载完整消息

    // 重置流式相关状态（防止旧项目的思考/回复在新项目中显示）
    setStreaming(false)
    setStreamContent('')
    setStreamThinking('')
    streamContentRef.current = ''
    streamThinkingRef.current = ''

    // 重置 Hermes 状态栏（保留 token 累计）
    setHermesStatus(prev => ({
      model: '--', provider: '--', tokensUsed: prev.tokensUsed,
      inputTokens: 0, outputTokens: 0, elapsed: 0, status: '空闲'
    }))

    // 重置交互状态（技能激活、暂停、菜单等）
    setActiveSkillIds(new Set())
    setPaused(false)
    setShowMention(false)
    setContextMenu(null)
    setGlobalDragOver(false)
    setPreviewArtifact(null)
    setIconViewPath([])
    setTaskQueue([])
    setSkillUsageCounts({})
  }, [projectId])

  // ── Per-project input isolation: save/restore via localStorage ──
  const INPUT_CACHE_KEY = 'input_cache'
  const getInputCache = (): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(INPUT_CACHE_KEY) || '{}') } catch { return {} }
  }
  const saveInputCache = (pid: string, value: string) => {
    const cache = getInputCache()
    if (value) cache[pid] = value; else delete cache[pid]
    localStorage.setItem(INPUT_CACHE_KEY, JSON.stringify(cache))
  }

  useEffect(() => {
    // Restore cached input for this project
    const cache = getInputCache()
    const saved = cache[projectId || ''] || ''
    setInput(saved)
    inputRef.current = saved
    return () => {
      // Save current input when leaving this project
      if (projectId && inputRef.current) {
        saveInputCache(projectId, inputRef.current)
      }
    }
  }, [projectId])

  const loadData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setLoadError('')
    try {
      const [proj, msgs, arts, skls, nativeSkls, pfiles] = await Promise.all([
        api.getProject(projectId),
        api.getMessages(projectId),
        api.getArtifacts(projectId),
        api.getSkills(),
        api.getNativeSkills().catch(() => []),
        api.getProjectFiles(projectId).catch(() => ({ files: [] })),
      ])
      setProject(proj)
      // 处理消息响应（支持新格式和旧格式）
      const msgData = msgs?.messages || msgs
      const msgList = Array.isArray(msgData) ? msgData : []
      // Restore persisted model switch events
      const withSwitches = [...msgList]
      try {
        const key = `model_switches_${projectId}`
        const saved = JSON.parse(localStorage.getItem(key) || '[]')
        for (const sw of saved) {
          // Insert switch event at the right timestamp position
          const swMsg = { id: `sw-${sw.ts}`, sender_type: 'system', sender_name: '', content: `模型已由 ${sw.from} 切换为 ${sw.to}`, thinking_content: null, timestamp: sw.ts }
          const insertIdx = withSwitches.findIndex(m => m.timestamp > sw.ts)
          if (insertIdx >= 0) withSwitches.splice(insertIdx, 0, swMsg as Message)
          else withSwitches.push(swMsg as Message)
        }
      } catch {}
      setMessages(withSwitches)
      // 如果最后一条是用户消息且没有 agent 回复 → agent 可能在后台工作中
      if (msgList.length > 0) {
        const last = msgList[msgList.length - 1]
        if (last.sender_type === 'user') {
          // Check store first
          const st = useStreamStore.getState().streams[projectId]
          if (st?.streaming) {
            setStreaming(true)
            setStreamContent(st.content)
            setStreamThinking(st.thinking)
            setHermesStatus(prev => ({ ...prev, status: '推理中...' }))
          }
        }
      }
      setHasMoreMessages(msgs?.has_more || false)
      setTotalMessages(msgs?.total || msgList.length)
      // 从消息历史中累计 token 总数
      const totalTokens = msgList.reduce((sum: number, m: any) => sum + (m.tokens_used || 0), 0)
      setHermesStatus(prev => ({ ...prev, tokensUsed: totalTokens }))
      setArtifacts(arts)
      setProjectFiles(pfiles?.files || [])
      setFileTree(pfiles?.tree || [])
      // Combine native + department skills
      const allSkills = [
        ...(nativeSkls || []).map((s: Skill) => ({ ...s, is_native: true })),
        ...(skls || []).map((s: Skill) => ({ ...s, is_native: false })),
      ]
      setSkills(allSkills)
    } catch (e: any) {
      setLoadError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { initialLoadDone.current = false; loadData() }, [loadData])

  // ── 挂载后检测是否需要恢复流 ──
  useEffect(() => {
    if (!projectId || loading) return
    const st = useStreamStore.getState().streams[projectId]
    if (st?.streaming) {
      // Store says agent is working → show it
      setStreaming(true)
      setStreamContent(st.content)
      setStreamThinking(st.thinking)
      setHermesStatus(prev => ({ ...prev, status: st.status || '推理中...', model: st.model || prev.model, provider: st.provider || prev.provider }))
    }
  }, [projectId, loading])

  // ── 自动恢复后台对话（最高优先级，在渲染前执行） ──
  const [resumeStatus, setResumeStatus] = useState('')
  const [resumedOnce, setResumedOnce] = useState(false)
  useEffect(() => {
    if (!projectId || resumedOnce) return
    let cancelled = false
    setResumedOnce(true)
    ;(async () => {
      try {
        const status = await api.getChatStatus(projectId)
        if (status.status === 'running') {
          setResumeStatus('正在恢复对话...')
          setStreaming(true)
          setHermesStatus(prev => ({ ...prev, status: '正在恢复...', model: prev.model || '', provider: prev.provider || '' }))
          const ls = await api.getLockStatus(projectId)
          setLockState(ls)
          api.resumeChat(projectId, {
            onContent: (c) => { if (!cancelled) { setStreamContent(prev => prev + c); streamContentRef.current += c } },
            onThinking: (t) => { if (!cancelled) { setStreamThinking(prev => prev + t); streamThinkingRef.current += t } },
            onContext: (ctx: any) => {
              if (cancelled) return
              try {
                const c = typeof ctx === 'string' ? JSON.parse(ctx) : ctx
                setHermesStatus(prev => ({ ...prev, model: c.model || prev.model, provider: c.provider || prev.provider, status: '推理中...', tokensUsed: prev.tokensUsed + (c.tokens_used || 0) }))
              } catch {}
            },
            onDone: (data: any) => {
              if (cancelled) return
              setStreaming(false)
              setHermesStatus(prev => ({ ...prev, status: '空闲', elapsed: 0 }))
              setResumeStatus('')
              localStorage.removeItem(`active_stream_${projectId}`)
              if (!data._no_task) loadData()
            },
            onError: (msg: string) => {
              if (cancelled) return
              setStreaming(false)
              setHermesStatus(prev => ({ ...prev, status: '空闲' }))
              setResumeStatus('')
            },
            onStatus: (msg: string) => { if (!cancelled) setHermesStatus(prev => ({ ...prev, status: msg })) },
          })
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [projectId])

  // 每次 tab 激活/切回时也检查
  useEffect(() => {
    if (!projectId) return
    const handler = () => {
      api.getChatStatus(projectId).then(status => {
        if (status.status === 'running' && !streaming) {
          // Force re-trigger resume
          setResumedOnce(false)
        }
      }).catch(() => {})
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [projectId, streaming])

  // ── 自动刷新右侧文件和产出物（每 15 秒） ──
  const refreshFiles = useCallback(async () => {
    if (!projectId) return
    try {
      const [pfiles, arts] = await Promise.all([
        api.getProjectFiles(projectId).catch(() => null),
        api.getArtifacts(projectId).catch(() => null),
      ])
      if (pfiles) {
        setProjectFiles(pfiles.files || [])
        setFileTree(pfiles.tree || [])
      }
      if (arts) setArtifacts(arts)
    } catch {}
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const interval = setInterval(refreshFiles, 15000)
    return () => clearInterval(interval)
  }, [projectId, refreshFiles])

  // ── 预热 osascript 运行时（减少首次打开文件夹选择器的延迟） ──
  useEffect(() => {
    fetch(`http://${window.location.hostname}:8000/api/files/warmup-picker`, { method: 'POST' }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!initialLoadDone.current && messages.length > 0) {
      // First load: instant scroll, no animation
      initialLoadDone.current = true
      requestAnimationFrame(() => scrollToBottom('instant' as ScrollBehavior))
    } else if (streaming) {
      // During streaming: gentle auto scroll, no bounce
      scrollToBottom('auto' as ScrollBehavior)
    } else if (initialLoadDone.current) {
      scrollToBottom()
    }
  }, [messages, streamContent])

  // ── 项目锁定：进入项目时获取锁，离开时释放 ──
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const initLock = async () => {
      try {
        // 先尝试获取锁
        const acquireResult = await api.acquireLock(projectId)
        if (cancelled) return

        // 获取锁定状态
        const lockStatus = await api.getLockStatus(projectId)
        if (cancelled) return
        setLockState(lockStatus)
      } catch (e) {
        console.warn('[Lock] 初始化失败:', e)
      }
    }

    initLock()

    // 轮询待处理的接管请求（每 5 秒）
    lockPollRef.current = setInterval(async () => {
      try {
        const pending = await api.getPendingRequests()
        if (cancelled) return
        if (pending.length > 0 && !showIncomingRequest) {
          setShowIncomingRequest(pending[0])
        }
        // 刷新锁定状态
        const lockStatus = await api.getLockStatus(projectId)
        if (cancelled) return
        setLockState(lockStatus)
      } catch {}
    }, 5000)

    return () => {
      cancelled = true
      if (lockPollRef.current) clearInterval(lockPollRef.current)
      // 离开项目时释放锁
      api.releaseLock(projectId).catch(() => {})
    }
  }, [projectId])

  // ── 项目技能 — search hook (no more localStorage-based projectSkills) ──
  const [deptCategoryFilter, setDeptCategoryFilter] = useState('') // '' = 全部

  const {
    showSkillSearch, setShowSkillSearch,
    skillSearchQuery, setSkillSearchQuery,
    skillSearchResults, handleSkillSearch,
  } = useProjectSkills()

  // 项目历史技能：从消息中提取 @skill_name 标签
  const projectHistorySkills = useMemo(() => extractHistorySkills(messages), [messages])

  // ── 自动发送队列中的下一个任务 ──
  // 当 streaming 从 true→false 且有待发送标记时，自动执行队列第一项
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!streaming && autoSendPendingRef.current) {
      autoSendPendingRef.current = false
      const timer = setTimeout(() => {
        setTaskQueue(prev => {
          if (prev.length === 0) return prev
          const [next, ...rest] = prev
          setTimeout(() => {
            setInput('')
            inputRef.current = ''
            if (projectId) saveInputCache(projectId, '')
            executeTask(next.content, next.files)
          }, 100)
          return rest
        })
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [streaming])

  // ── 执行单个任务（核心逻辑） ──
  const executeTask = async (text: string, files?: any[]) => {
    if ((!text && (!files || files.length === 0)) || !projectId) return
    if (project?.status !== 'active' || (lockState.locked && !lockState.is_me && !lockState.is_admin)) return
    const content = text || '请分析附件文件'
    setStreaming(true)
    setStreamContent('')
    setStreamThinking('')
    setShowThinking(true)
    streamContentRef.current = ''
    streamThinkingRef.current = ''
    setHermesStatus(prev => ({ model: '--', provider: '--', tokensUsed: prev.tokensUsed, inputTokens: 0, outputTokens: 0, elapsed: 0, status: '启动中...' }))

    let fullContent = content
    const activeSkills = skills.filter(s => activeSkillIds.has(s.id))
    if (activeSkills.length > 0) {
      const skillTags = activeSkills.map(s => `@${s.skill_name}`).join(' ')
      fullContent = `${skillTags} ${content}`
      const newCounts = { ...skillUsageCounts }
      activeSkills.forEach(s => { newCounts[s.id] = (newCounts[s.id] || 0) + 1 })
      setSkillUsageCounts(newCounts)
    }

    const filePaths = files?.map((f: any) => f.stored_path || f.relative_path) || []
    const attachmentMeta: MessageAttachment[] = files?.map((f: any) => ({
      filename: f.filename,
      size: f.size || 0,
      stored_path: f.stored_path || f.relative_path || '',
      content_type: f.content_type || '',
    })) || []

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      sender_type: 'user',
      sender_name: currentUser?.display_name || currentUser?.username || '我',
      content: fullContent,
      thinking_content: null,
      attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    setConnectionHealth('connected')
    setConnectionError(null)

    // 标记该项目有活跃流（用于切回时自动刷新）
    const streamKey = `active_stream_${projectId}`
    localStorage.setItem(streamKey, '1')

    // 使用全局 store 启动 SSE（跨页面切换不中断）
    useStreamStore.getState().startStream(projectId, fullContent, filePaths)
    setStreaming(true)
    setConnectionHealth('connected')
    setConnectionError(null)

  }

  // ── 永久 stream-done 监听（跨页面切换不丢失） ──
  useEffect(() => {
    if (!projectId) return
    const handler = (e: CustomEvent) => {
      if (e.detail.projectId === projectId) {
        // Read final content from store (not refs — store is the source of truth)
        const st = useStreamStore.getState().streams[projectId]
        const finalContent = st?.content || ''
        const finalThinking = st?.thinking || ''
        if (finalContent || finalThinking) {
          setMessages((prev) => [...prev, {
            id: `msg-${e.detail.messageId || Date.now()}`,
            sender_type: 'agent',
            sender_name: 'Hermes Agent',
            content: finalContent || '(无内容)',
            thinking_content: finalThinking || null,
            timestamp: new Date().toISOString(),
            tokens_used: st?.tokensUsed || 0,
          }])
        }
        setStreaming(false)
        setStreamContent('')
        setStreamThinking('')
        streamContentRef.current = ''
        streamThinkingRef.current = ''
        localStorage.removeItem(`active_stream_${projectId}`)
        setHermesStatus(prev => ({ ...prev, status: '空闲', elapsed: 0 }))
        setTimeout(() => api.getArtifacts(projectId).then(setArtifacts).catch(() => {}), 500)
        autoSendPendingRef.current = true
      }
    }
    window.addEventListener('stream-done', handler as EventListener)
    return () => window.removeEventListener('stream-done', handler as EventListener)
  }, [projectId, loadData])

  // ── 发送/排队入口 ──
  const handleSend = async (text: string, files?: any[]) => {
    if ((!text && (!files || files.length === 0)) || !projectId) return
    // 权限检查：只读模式或归档项目禁止发送
    if (project?.status !== 'active' || (lockState.locked && !lockState.is_me && !lockState.is_admin)) return
    if (streaming) {
      // Agent 正在执行 → 加入队列
      const queued: QueuedTask = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: text || '请分析附件文件',
        files: files || [],
        timestamp: new Date().toISOString(),
      }
      setTaskQueue(prev => [...prev, queued])
      setInput('')
      inputRef.current = ''
      if (projectId) saveInputCache(projectId, '')
      return
    }
    // 空闲状态 → 直接执行
    setInput('')
    inputRef.current = ''
    if (projectId) saveInputCache(projectId, '')
    executeTask(text, files)
  }

  // ── 终止当前执行 ──
  const handleStop = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      setStreaming(false)
      setHermesStatus(prev => ({ ...prev, status: '已终止' }))
    }
  }

  // ── 队列管理 ──
  const cancelQueuedTask = (id: string) => {
    setTaskQueue(prev => prev.filter(t => t.id !== id))
  }

  const editQueuedTask = (task: QueuedTask) => {
    // 1. 先从队列中移除
    setTaskQueue(prev => prev.filter(t => t.id !== task.id))
    // 2. 将内容放回输入框（延迟确保 DOM 已更新）
    setTimeout(() => {
      setInput(task.content)
      inputRef.current = task.content
      if (projectId) saveInputCache(projectId, task.content)
      // 3. 聚焦输入框
      setTimeout(() => {
        const textarea = document.querySelector('textarea')
        if (textarea) {
          textarea.focus()
          textarea.setSelectionRange(task.content.length, task.content.length)
        }
      }, 100)
    }, 50)
  }

  const moveQueueItem = (fromIdx: number, toIdx: number) => {
    setTaskQueue(prev => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }

  // ── 外部文件夹管理（含状态持久化） ──
  const EXT_TABS_KEY = `extTabs_${projectId}`

  // 持久化：保存外部标签路径到 localStorage
  const persistExtTabs = useCallback((tabs: ExternalFolderTab[]) => {
    if (!projectId) return
    const paths = tabs.map(t => ({ path: t.path, name: t.name }))
    try { localStorage.setItem(EXT_TABS_KEY, JSON.stringify(paths)) } catch {}
  }, [projectId])

  // 恢复：从 localStorage 加载外部标签
  useEffect(() => {
    if (!projectId) return
    try {
      const saved = localStorage.getItem(EXT_TABS_KEY)
      if (saved) {
        const paths: { path: string; name: string }[] = JSON.parse(saved)
        if (paths.length > 0) {
          // 重新加载每个文件夹
          paths.forEach(p => openExternalFolder(p.path, false))
        }
      }
    } catch {}
  }, [projectId])

  const openExternalFolder = async (folderPath: string, shouldPersist = true) => {
    if (!folderPath) return
    const existing = externalTabs.find(t => t.path === folderPath)
    if (existing) { setActiveFileTab(existing.id); return }
    const tabId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    const folderName = folderPath.split('/').filter(Boolean).pop() || folderPath
    const newTab: ExternalFolderTab = {
      id: tabId, name: folderName, path: folderPath,
      tree: [], expanded: new Set(['']), viewMode: 'list', loading: true, error: ''
    }
    setExternalTabs(prev => {
      const next = [...prev, newTab]
      if (shouldPersist) persistExtTabs(next)
      return next
    })
    setActiveFileTab(tabId)
    try {
      const res = await api.browseFolder(folderPath) as any
      const tree = res.tree || []
      setExternalTabs(prev => {
        const next = prev.map(t => t.id === tabId ? { ...t, tree, loading: false } : t)
        return next
      })
    } catch (e: any) {
      setExternalTabs(prev => {
        const next = prev.map(t => t.id === tabId ? { ...t, loading: false, error: e.message || '加载失败' } : t)
        return next
      })
    }
  }

  const closeExternalTab = (tabId: string) => {
    setExternalTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      persistExtTabs(next)
      return next
    })
    if (activeFileTab === tabId) setActiveFileTab('project')
  }

  const handleOpenFolder = async () => {
    if (pickerLockRef.current) return
    pickerLockRef.current = true
    setTimeout(() => { pickerLockRef.current = false }, 2000)
    try {
      const res = await api.pickFolder() as any
      if (res && !res.cancelled && res.path) {
        openExternalFolder(res.path.trim())
      }
    } catch (e: any) {
      console.warn('文件夹选择失败:', e.message)
    }
  }

  // Toggle expand for external tab folders
  const toggleExternalExpand = (tabId: string, path: string) => {
    setExternalTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t
      const next = new Set(t.expanded)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { ...t, expanded: next }
    }))
  }

  const handlePause = handleStop

  const handleArchive = async () => {
    if (!projectId) return
    if (!confirm('确定要结案归档此工作流吗？归档后将自动触发技能提炼流水线。')) return
    try {
      await api.archiveProject(projectId)
      // 通知侧边栏刷新项目列表
      window.dispatchEvent(new CustomEvent('project-archived', { detail: { projectId } }))
      alert('工作流已归档！提炼的技能已存入部门技能库，待管理员审核。')
      loadData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  const toggleSkillGroup = (skillIds: string[]) => {
    setActiveSkillIds(prev => {
      const next = new Set(prev)
      const allActive = skillIds.every(id => next.has(id))
      if (allActive) {
        skillIds.forEach(id => next.delete(id))
      } else {
        skillIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  // ── 右键菜单 ──
  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, path })
  }
  // ── 媒体预览 ──
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null)
  const videoSrc = useVideoStore(s => s.videoSrc)
  const setVideoSrc = useVideoStore(s => s.setVideoSrc)

  // ── Model switch notification — filtered by projectId ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.projectId && detail.projectId !== projectId) return
      const systemMsg = {
        id: `switch-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        sender_type: 'system',
        sender_name: '',
        content: `模型已由 ${detail.from} 切换为 ${detail.to}`,
        thinking_content: null,
        timestamp: new Date().toISOString(),
      } as Message
      setMessages((prev) => [...prev, systemMsg])
      // Persist switch event so it survives page reloads
      try {
        const key = `model_switches_${projectId}`
        const existing = JSON.parse(localStorage.getItem(key) || '[]')
        existing.push({ from: detail.from, to: detail.to, ts: systemMsg.timestamp })
        localStorage.setItem(key, JSON.stringify(existing.slice(-20)))
      } catch {}
    }
    window.addEventListener('model-switched', handler)
    return () => window.removeEventListener('model-switched', handler)
  }, [projectId])

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.avif'])
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'])

  const handleFileClick = (path: string) => {
    const ext = path.includes('.') ? '.' + path.split('.').pop()!.toLowerCase() : ''
    const token = useAuthStore.getState().token
    const authUrl = `/api/files/content?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token || '')}`
    if (IMAGE_EXTS.has(ext)) {
      setPreviewImage({ src: authUrl, name: path.split('/').pop() || '' })
    } else if (VIDEO_EXTS.has(ext)) {
      setVideoSrc({ src: authUrl, name: path.split('/').pop() || '' })
    } else {
      handleRevealInFinder(path)
    }
  }

  const handleRevealInFinder = async (path: string) => {
    try { await api.revealInFinder(path) } catch (e: any) { alert(e.message) }
    setContextMenu(null)
  }
  // Close context menu on any click
  useEffect(() => {
    const close = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', close)
      return () => document.removeEventListener('click', close)
    }
  }, [contextMenu])

  // ── 页面级拖放（仅响应外部文件拖入，忽略内部拖拽如队列排序） ──
  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    // 只有拖入的是外部文件（Files 类型）才显示覆盖层
    // 内部拖拽（队列排序、侧栏文件等）只有 text/plain 或 text/project-id
    const types = Array.from(e.dataTransfer.types || [])
    if (!types.includes('Files')) return
    if (dragTimeoutRef.current) { clearTimeout(dragTimeoutRef.current); dragTimeoutRef.current = null }
    setGlobalDragOver(true)
  }, [])
  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragTimeoutRef.current = setTimeout(() => setGlobalDragOver(false), 150)
  }, [])
  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setGlobalDragOver(false)
    // 只处理外部文件拖入
    const types = Array.from(e.dataTransfer.types || [])
    if (!types.includes('Files')) return
    const dropped = e.dataTransfer.files
    if (dropped && dropped.length > 0) {
      window.dispatchEvent(new CustomEvent('global-drop', { detail: Array.from(dropped) }))
    }
  }, [])

  // ── 面板大小调整（右键栏宽度 + 底部输入区高度 + 各栏目高度） ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const { target, startX, startY, startSize } = resizeRef.current
      if (target === 'right') {
        const delta = startX - e.clientX
        setRightWidth(Math.max(120, Math.min(700, startSize + delta)))
      } else if (target === 'bottom') {
        const delta = startY - e.clientY
        setBottomHeight(Math.max(100, Math.min(400, startSize + delta)))
      } else if (target === 'files-section') {
        const delta = e.clientY - startY
        setSectionHeights(prev => ({ ...prev, files: Math.max(60, Math.min(400, startSize + delta)) }))
      } else if (target === 'skills-section') {
        const delta = e.clientY - startY
        setSectionHeights(prev => ({ ...prev, skills: Math.max(60, Math.min(400, startSize + delta)) }))
      }
    }
    const onUp = () => { resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])
  const startResizeRight = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { target: 'right', startX: e.clientX, startY: 0, startSize: rightWidth }
  }
  const startResizeBottom = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { target: 'bottom', startX: 0, startY: e.clientY, startSize: bottomHeight || 140 }
  }
  const startResizeSection = (section: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    const sz = section === 'files' ? sectionHeights.files : sectionHeights.skills
    resizeRef.current = { target: `${section}-section`, startX: 0, startY: e.clientY, startSize: sz || 120 }
  }

  const handleInputChange = (val: string) => {
    setInput(val)
    inputRef.current = val  // ← sync ref for cross-project persistence
    const lastAt = val.lastIndexOf('@')
    if (lastAt >= 0 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const afterAt = val.slice(lastAt + 1)
      if (!afterAt.includes(' ')) {
        setShowMention(true)
        setMentionFilter(afterAt.toLowerCase())
        return
      }
    }
    setShowMention(false)
  }

  const handleMentionSelect = (skillName: string) => {
    const lastAt = input.lastIndexOf('@')
    setInput(input.slice(0, lastAt) + `@${skillName} `)
    setShowMention(false)
  }

  const nativeSkills = skills.filter(s => s.is_native)
  const deptSkills = skills.filter(s => !s.is_native)

  // Group department skills by ZIP source — only show main skills (yaml_frontmatter/manual)
  const deptSkillGroups = (() => {
    // First, deduplicate by skill_name + metadata into unique records
    const uniqueMainSkills = new Map<string, any>()
    const allSupporting = new Map<string, any[]>()
    for (const s of deptSkills) {
      if (s.import_source === 'import_zip' && s.metadata_json) {
        try {
          const m = JSON.parse(s.metadata_json)
          if (m.skill_format === 'yaml_frontmatter') {
            uniqueMainSkills.set(s.skill_name, s)
          } else if (m.skill_format === 'generic_md') {
            if (!allSupporting.has(m.original_filename)) allSupporting.set(m.original_filename, [])
            allSupporting.get(m.original_filename)!.push(s)
          }
        } catch {}
      } else if (s.import_source === 'manual') {
        // Manual skills: deduplicate by skill_name
        if (!uniqueMainSkills.has(s.skill_name)) {
          uniqueMainSkills.set(s.skill_name, s)
        }
      }
    }
    const groups: { name: string; main: any; subs: any[]; totalUsage: number }[] = []
    for (const [name, skill] of uniqueMainSkills) {
      const subs: any[] = []
      // Find supporting docs by matching ZIP filename
      for (const [zipName, subSkills] of allSupporting) {
        if (subSkills.some(sub => sub.id === skill.id || sub.skill_name === skill.skill_name)) {
          subs.push(...subSkills)
        }
      }
      // Better: match by metadata original_filename
      const skillMeta = (() => { try { return JSON.parse(skill.metadata_json || '{}') } catch { return {} } })()
      const zipName = skillMeta.original_filename
      if (zipName && allSupporting.has(zipName)) {
        subs.push(...(allSupporting.get(zipName) || []))
      }
      const usage = (skillUsageCounts[skill.id] || 0) + subs.reduce((s, sub) => s + (skillUsageCounts[sub.id] || 0), 0)
      groups.push({ name: skill.skill_name, main: skill, subs, totalUsage: usage })
    }
    return groups.sort((a, b) => b.totalUsage - a.totalUsage)
  })()

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (loadError && !project) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm mb-1">加载失败</p>
        <p className="text-xs text-gray-500 mb-4 max-w-md text-center">{loadError}</p>
        <button onClick={() => loadData()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors">重试</button>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
        <p className="text-sm">项目数据为空</p>
        <button onClick={() => loadData()} className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors">重试</button>
      </div>
    )
  }

  return (
    <div
      className="h-full flex bg-white dark:bg-transparent"
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-950">
        {/* Project Header */}
        <div className="shrink-0 px-6 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50">
          <div>
            <h2 className="text-sm font-semibold text-white">{project.name}</h2>
            {project.description && <p className="text-xs text-gray-400 mt-0.5">{project.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {project.status === 'active' && (
              <button onClick={handleArchive} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600/10 border border-amber-600/30 text-amber-400 rounded-lg hover:bg-amber-600/20 transition-colors">
                <Archive className="w-3.5 h-3.5" />结案归档
              </button>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${project.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>
              {project.status === 'active' ? '进行中' : '已归档'}
            </span>
          </div>
        </div>

        {/* Editor Lock Bar — 他人正在编辑时显示 */}
        {lockState.locked && !lockState.is_me && (
          <div className="shrink-0 px-6 py-1 border-b border-gray-800 bg-amber-500/5 flex items-center gap-3 text-[11px]">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-amber-400">
              <span className="text-amber-300 font-medium">{lockState.editor_display_name}</span> 正在编辑此工作流
            </span>
            <div className="flex-1" />
            {lockState.can_takeover ? (
              <button onClick={async () => {
                if (!confirm(`确定接管此工作流？${lockState.editor_display_name} 将收到通知。`)) return
                await api.forceTakeover(projectId!)
                const ls = await api.getLockStatus(projectId!)
                setLockState(ls)
              }}
                className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                强制接管
              </button>
            ) : (
              <button onClick={() => setShowTransferModal(true)}
                className="px-2 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors">申请编辑权</button>
            )}
          </div>
        )}
        {transferStatus && (
          <div className="shrink-0 px-6 py-1 border-b border-gray-800 bg-indigo-500/5 text-[10px] text-indigo-400">{transferStatus}</div>
        )}

        {/* Hermes Status Bar — 合并模型 + 编辑状态 */}
        <div className="shrink-0 px-6 py-1.5 border-b border-gray-800 bg-gray-950/80 flex items-center gap-4 text-[11px]">
          <ModelSwitcher hermesModel={hermesStatus.model} hermesProvider={hermesStatus.provider} streaming={streaming} projectId={projectId} />
          <div className="flex items-center gap-1.5 text-gray-400">
            <BarChart3 className="w-3 h-3" />
            <span>{(hermesStatus.tokensUsed || 0).toLocaleString()} tokens</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className={`w-3 h-3 ${streaming ? 'text-green-400 animate-pulse' : 'text-gray-400'}`} />
            <span className={streaming ? 'text-green-400 font-medium' : 'text-gray-300'}>{hermesStatus.status}</span>
          </div>
          {streaming && connectionHealth === 'stale' && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />响应较慢...
            </span>
          )}
          {connectionHealth === 'error' && connectionError && (
            <button onClick={() => { setConnectionHealth('idle'); setConnectionError(null) }}
              className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
              title="点击清除错误">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />连接异常
            </button>
          )}
          {/* 编辑器状态 — 右上角 */}
          <div className="ml-auto flex items-center gap-1.5 text-gray-500">
            {lockState.locked && lockState.is_me ? (
              <span className="text-green-400">编辑中 · {lockState.editor_display_name}</span>
            ) : lockState.locked && !lockState.is_me ? (
              <span className="text-amber-400">只读 · {lockState.editor_display_name}</span>
            ) : (
              <span>空闲 · 暂无编辑者</span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 加载更早消息 */}
          {hasMoreMessages && (
            <div className="flex flex-col items-center gap-2 py-3">
              <p className="text-[11px] text-gray-500">
                共 {totalMessages} 条消息，当前显示最新 {messages.length} 条
              </p>
              <button
                onClick={async () => {
                  if (loadingOlder || !projectId) return
                  setLoadingOlder(true)
                  try {
                    const olderOffset = totalMessages - messages.length - 200
                    const res = await api.getMessagesWithOffset(projectId, Math.max(0, olderOffset), 200)
                    const olderMsgs = res.messages || []
                    if (olderMsgs.length > 0) {
                      setMessages(prev => [...olderMsgs, ...prev])
                      setHasMoreMessages(res.has_more)
                    }
                  } catch {} finally { setLoadingOlder(false) }
                }}
                disabled={loadingOlder}
                className="text-xs px-4 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300 border border-gray-700 transition-colors disabled:opacity-50"
              >
                {loadingOlder ? '加载中...' : '加载更早的消息'}
              </button>
            </div>
          )}
          
          {/* Messages */}
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Bot className="w-12 h-12 mb-4 text-gray-500" />
              <p className="text-sm text-gray-300 mb-2">开始与 AI 对话</p>
              <div className="text-xs text-gray-500 space-y-1 text-center max-w-xs">
                <p>先把项目相关背景设定或文件路径发给我</p>
                <p>记得启用技能，效果会更好</p>
              </div>
              <p className="text-[10px] mt-4 text-gray-600">
                已加载 {nativeSkills.length} 个系统技能 · {deptSkillGroups.length} 个部门技能
              </p>
            </div>
          )}

          {messages.map((msg) => {
            // System message (model switch divider)
            if (msg.sender_type === 'system') {
              return (
                <div key={msg.id} className="flex items-center justify-center py-2">
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                    <Cpu className="w-3 h-3 text-indigo-400" />
                    <span className="text-[11px] text-indigo-400">{msg.content}</span>
                  </div>
                </div>
              )
            }
            const isAgent = msg.sender_type === 'agent'
            return (
            <div key={msg.id} className={`flex gap-3 ${isAgent ? 'justify-start' : 'justify-end'}`}>
              {/* Agent 头像 — 始终在左侧 */}
              {isAgent && (
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>
                  <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>H</span>
                </div>
              )}

              <div className={`max-w-[75%] ${isAgent ? '' : 'order-first'}`}>
                <div className={`flex items-center gap-2 mb-1 ${msg.sender_type === 'user' ? 'justify-end' : ''}`}>
                  <span className="text-xs text-gray-400">
                    {msg.sender_type === 'user' && currentUser && (msg.sender_name === currentUser.username || msg.sender_name === currentUser.display_name)
                      ? (currentUser.display_name || msg.sender_name)
                      : msg.sender_name}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })}
                  </span>
                  {Boolean(msg.tokens_used && msg.tokens_used > 0) && (
                    <span className="text-[9px] text-amber-500/60 flex items-center gap-[2px] ml-0.5">
                      ⚡{(msg.tokens_used! / 1000) >= 1 ? `${(msg.tokens_used! / 1000).toFixed(1)}k` : msg.tokens_used!.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Thinking Accordion */}
                {msg.thinking_content && (
                  <details className="mb-2 group">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1.5 select-none">
                      <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                      <Brain className="w-3 h-3" />
                      <span>思考过程</span>
                  <span className="text-gray-400">({msg.thinking_content.length} 字)</span>
                    </summary>
                    <div className="mt-2 p-3 bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-lg">
                      <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed font-mono">{msg.thinking_content}</div>
                    </div>
                  </details>
                )}

                {/* Content */}
                <div className={`rounded-xl px-4 py-3 relative group/msg ${msg.sender_type === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200'}`}>
                  {/* Copy button — appears on hover, ✅ feedback on click */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard.writeText(msg.content)
                      setCopiedId(msg.id)
                      setTimeout(() => setCopiedId(null), 2000)
                    }}
                    onMouseLeave={() => { if (copiedId === msg.id) setCopiedId(null) }}
                    className={`absolute bottom-2 right-2 transition-all p-1.5 rounded-lg text-gray-400 hover:text-white ${
                      copiedId === msg.id
                        ? 'opacity-100 bg-green-600/40 text-green-300'
                        : 'opacity-0 group-hover/msg:opacity-100 bg-gray-700/80 hover:bg-gray-600'
                    }`}
                    title="复制消息">
                    {copiedId === msg.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {/* Attachment chips */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {msg.attachments.map((att, idx) => (
                        <div key={idx}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border ${
                            msg.sender_type === 'user'
                              ? 'bg-blue-500/30 border-blue-400/40 text-blue-100'
                              : 'bg-gray-700/60 border-gray-600 text-gray-300'
                          }`}>
                          <Paperclip className="w-3 h-3 shrink-0 opacity-70" />
                          <span className="truncate max-w-[140px]">{att.filename}</span>
                          {att.size > 0 && (
                            <span className={`text-[9px] ${msg.sender_type === 'user' ? 'text-blue-200/70' : 'text-gray-500'}`}>
                              {formatFileSize(att.size)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.sender_type === 'agent' ? (
                    <div className="markdown-body text-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            const codeStr = String(children).replace(/\n$/, '')
                            const blockId = `code-${msg.id}-${match ? match[1] : 'inline'}-${codeStr.slice(0, 20)}`
                            if (match && codeStr.length > 0) {
                              return (
                                <div className="relative group/code my-3">
                                  {/* Language label + copy button */}
                                  <div className="flex items-center justify-between px-4 py-1.5 bg-gray-700/80 rounded-t-lg border border-b-0 border-gray-600 text-[10px] text-gray-400">
                                    <span>{match[1]}</span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        navigator.clipboard.writeText(codeStr)
                                        setCopiedId(blockId)
                                        setTimeout(() => setCopiedId(null), 2000)
                                      }}
                                      onMouseLeave={() => { if (copiedId === blockId) setCopiedId(null) }}
                                      className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                                        copiedId === blockId
                                          ? 'bg-green-600/30 text-green-300'
                                          : 'opacity-0 group-hover/code:opacity-100 bg-gray-600/50 hover:bg-gray-600 text-gray-400 hover:text-white'
                                      }`}>
                                      {copiedId === blockId ? <><Check className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制代码</>}
                                    </button>
                                  </div>
                                  <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                                    customStyle={{ background: '#121212', borderRadius: '0 0 8px 8px', padding: '1rem', fontSize: '0.8rem', border: '1px solid #2a2a2b', margin: 0 }}>
                                    {codeStr}
                                  </SyntaxHighlighter>
                                </div>
                              )
                            }
                            return <code className={className} {...props}>{children}</code>
                          },
                          // Table with per-table copy button
                          table({ children, ...props }) {
                            const tableRef = { current: null as HTMLTableElement | null }
                            const tableId = `table-${msg.id}-${Math.random().toString(36).slice(2, 8)}`
                            const handleCopyTable = () => {
                              const el = tableRef.current
                              if (el) {
                                // Extract table as markdown-like text
                                const rows = Array.from(el.querySelectorAll('tr'))
                                const text = rows.map(row => {
                                  const cells = Array.from(row.querySelectorAll('th, td'))
                                  return '| ' + cells.map(c => (c.textContent || '').trim()).join(' | ') + ' |'
                                }).join('\n')
                                navigator.clipboard.writeText(text)
                                setCopiedId(tableId)
                                setTimeout(() => setCopiedId(null), 2000)
                              }
                            }
                            return (
                              <div className="relative group/table my-3 overflow-x-auto">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopyTable() }}
                                  onMouseLeave={() => { if (copiedId === tableId) setCopiedId(null) }}
                                  className={`absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all ${
                                    copiedId === tableId
                                      ? 'opacity-100 bg-green-600/40 text-green-300'
                                      : 'opacity-0 group-hover/table:opacity-100 bg-gray-700/90 hover:bg-gray-600 text-gray-400 hover:text-white'
                                  }`}>
                                  {copiedId === tableId ? <><Check className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制表格</>}
                                </button>
                                <table ref={tableRef} className="w-full border-collapse text-xs">{children}</table>
                              </div>
                            )
                          },
                          thead({ children }) {
                            return <thead className="bg-gray-700/50">{children}</thead>
                          },
                          th({ children }) {
                            return <th className="border border-gray-600 px-3 py-2 text-left font-semibold text-gray-300">{children}</th>
                          },
                          td({ children }) {
                            return <td className="border border-gray-600 px-3 py-2 text-gray-400">{children}</td>
                          },
                          tr({ children }) {
                            return <tr className="even:bg-gray-800/30">{children}</tr>
                          },
                          img({ src, alt }) {
                            return <img src={src || ''} alt={alt || ''} className="max-w-full rounded-lg my-2 cursor-pointer hover:opacity-90 transition-opacity" style={{ maxHeight: 400 }} loading="lazy" onClick={(e) => { e.stopPropagation(); setPreviewImage({ src: src || '', name: alt || '图片' }) }} />
                          },
                        }}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>

              {/* 用户头像 — 显示用户昵称首字 */}
              {!isAgent && (
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>
                  <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>
                    {(() => { const s = currentUser?.display_name || msg.sender_name || 'U'; const ch = [...s][0] || 'U'; return /\p{Emoji}/u.test(ch) ? ch : ch.toUpperCase() })()}
                  </span>
                </div>
              )}
            </div>
            )})}

          {/* Streaming Message */}
          {streaming && (
            <div className="flex gap-3">
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>
                <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>H</span>
              </div>
              <div className="max-w-[75%]">
                <span className="text-xs text-gray-400">Hermes Agent</span>
                {streamThinking && (
                  <details className="mb-2 group" open={showThinking}>
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1.5 select-none"
                      onClick={(e) => { e.preventDefault(); setShowThinking(!showThinking) }}>
                      <span className={`inline-block transition-transform ${showThinking ? 'rotate-90' : ''}`}>▶</span>
                      <Brain className="w-3 h-3" />
                      <span>思考中...</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-gray-400">({streamThinking.length} 字)</span>
                    </summary>
                    <div className="mt-2 p-3 bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-lg max-h-80 overflow-y-auto">
                      <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed font-mono">
                        {streamThinking}
                        <span className="inline-block w-2 h-4 bg-amber-500/60 animate-pulse ml-0.5 align-middle" />
                      </div>
                    </div>
                  </details>
                )}
                <div className="rounded-xl px-4 py-3 bg-gray-800 border border-gray-700 relative group/msg">
                  {streamContent && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigator.clipboard.writeText(streamContent)
                        setCopiedId('streaming')
                        setTimeout(() => setCopiedId(null), 2000)
                      }}
                      onMouseLeave={() => { if (copiedId === 'streaming') setCopiedId(null) }}
                      className={`absolute bottom-2 right-2 transition-all p-1.5 rounded-lg text-gray-400 hover:text-white ${
                        copiedId === 'streaming'
                          ? 'opacity-100 bg-green-600/40 text-green-300'
                          : 'opacity-0 group-hover/msg:opacity-100 bg-gray-700/80 hover:bg-gray-600'
                      }`}
                      title="复制消息">
                      {copiedId === 'streaming' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <div className="markdown-body text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '')
                          const codeStr = String(children).replace(/\n$/, '')
                          const blockId = `code-stream-${match ? match[1] : 'inline'}-${Math.random().toString(36).slice(2, 6)}`
                          if (match && codeStr.length > 0) {
                            return (
                              <div className="relative group/code-stream my-3">
                                <div className="flex items-center justify-between px-4 py-1.5 bg-gray-700/80 rounded-t-lg border border-b-0 border-gray-600 text-[10px] text-gray-400">
                                  <span>{match[1]}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      navigator.clipboard.writeText(codeStr)
                                      setCopiedId(blockId)
                                      setTimeout(() => setCopiedId(null), 2000)
                                    }}
                                    onMouseLeave={() => { if (copiedId === blockId) setCopiedId(null) }}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                                      copiedId === blockId
                                        ? 'bg-green-600/30 text-green-300'
                                        : 'opacity-0 group-hover/code-stream:opacity-100 bg-gray-600/50 hover:bg-gray-600 text-gray-400 hover:text-white'
                                    }`}>
                                    {copiedId === blockId ? <><Check className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制代码</>}
                                  </button>
                                </div>
                                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                                  customStyle={{ background: '#121212', borderRadius: '0 0 8px 8px', padding: '1rem', fontSize: '0.8rem', border: '1px solid #2a2a2b', margin: 0 }}>
                                  {codeStr}
                                </SyntaxHighlighter>
                              </div>
                            )
                          }
                          return <code className={className} {...props}>{children}</code>
                        },
                        table({ children, ...props }) {
                          const tableRef = { current: null as HTMLTableElement | null }
                          const tableId = `table-stream-${Math.random().toString(36).slice(2, 8)}`
                          const handleCopyTable = () => {
                            const el = tableRef.current
                            if (el) {
                              const rows = Array.from(el.querySelectorAll('tr'))
                              const text = rows.map(row => {
                                const cells = Array.from(row.querySelectorAll('th, td'))
                                return '| ' + cells.map(c => (c.textContent || '').trim()).join(' | ') + ' |'
                              }).join('\n')
                              navigator.clipboard.writeText(text)
                              setCopiedId(tableId)
                              setTimeout(() => setCopiedId(null), 2000)
                            }
                          }
                          return (
                            <div className="relative group/table-stream my-3 overflow-x-auto">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopyTable() }}
                                onMouseLeave={() => { if (copiedId === tableId) setCopiedId(null) }}
                                className={`absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all ${
                                  copiedId === tableId
                                    ? 'opacity-100 bg-green-600/40 text-green-300'
                                    : 'opacity-0 group-hover/table-stream:opacity-100 bg-gray-700/90 hover:bg-gray-600 text-gray-400 hover:text-white'
                                }`}>
                                {copiedId === tableId ? <><Check className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制表格</>}
                              </button>
                              <table ref={tableRef} className="w-full border-collapse text-xs">{children}</table>
                            </div>
                          )
                        },
                        thead({ children }) {
                          return <thead className="bg-gray-700/50">{children}</thead>
                        },
                        th({ children }) {
                          return <th className="border border-gray-600 px-3 py-2 text-left font-semibold text-gray-300">{children}</th>
                        },
                        td({ children }) {
                          return <td className="border border-gray-600 px-3 py-2 text-gray-400">{children}</td>
                        },
                        tr({ children }) {
                          return <tr className="even:bg-gray-800/30">{children}</tr>
                        },
                        img({ src, alt }) {
                          return <img src={src || ''} alt={alt || ''} className="max-w-full rounded-lg my-2 cursor-pointer hover:opacity-90 transition-opacity" style={{ maxHeight: 400 }} loading="lazy" onClick={(e) => { e.stopPropagation(); setPreviewImage({ src: src || '', name: alt || '图片' }) }} />
                        },
                      }}>
                      {streamContent || ''}
                    </ReactMarkdown>
                  </div>
                  {!streamContent && !streamThinking && (
                    <div className="flex items-center gap-1.5 py-1">
                      <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                      <span className="text-xs text-gray-400">正在连接 Hermes Agent...</span>
                    </div>
                  )}
                  {!streamContent && streamThinking && (
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="typing-dot w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="typing-dot w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="typing-dot w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom resize handle */}
        <div
          className="h-1.5 hover:h-2 cursor-row-resize hover:bg-blue-500/30 transition-all shrink-0 relative group"
          onMouseDown={startResizeBottom}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>
        {/* Active Skills Bar + Input */}
        <div className="shrink-0 border-t border-gray-800 bg-gray-900/50 px-6 py-3"
          style={bottomHeight > 0 ? { height: bottomHeight, overflowY: 'auto' } : undefined}>
          {/* Project History Skills — clickable to activate */}
          {projectHistorySkills.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-gray-500 shrink-0">工作流技能:</span>
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {projectHistorySkills.map((s: any) => {
                  const matched = skills.find(sk => sk.skill_name === s.skill_name)
                  const skillId = matched?.id || s.id
                  const isActive = activeSkillIds.has(skillId)
                  return (
                    <button key={s.id}
                      onClick={() => toggleSkill(skillId)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all duration-200 ${
                        isActive
                          ? 'bg-blue-950/40 text-blue-300 border-blue-500/60 shadow-[0_0_6px_rgba(59,130,246,0.3)]'
                          : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-300'
                      }`}>
                      {isActive && <Zap className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5 text-blue-400" />}
                      {s.skill_name}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setShowSkillSearch(true)}
                className="shrink-0 px-3 py-0.5 rounded-full text-xs font-medium border border-gray-600 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-500 flex items-center gap-1.5 transition-colors ml-auto">
                <Search className="w-3.5 h-3.5" /> 搜索技能
              </button>
            </div>
          )}
          {projectHistorySkills.length === 0 && (
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => setShowSkillSearch(true)}
                className="shrink-0 px-3 py-0.5 rounded-full text-xs font-medium border border-gray-600 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-500 flex items-center gap-1.5 transition-colors">
                <Search className="w-3.5 h-3.5" /> 搜索技能
              </button>
            </div>
          )}

          {/* Activated Department Skills — show as pills above input */}
          {(() => {
            // Group activated skills by their ZIP source group
            const activatedIds = new Set(deptSkills.filter(s => activeSkillIds.has(s.id)).map(s => s.id))
            if (activatedIds.size === 0) return null

            // Build display pills: if all subs in a group are active, show group name; otherwise show individual
            const pills: { key: string; name: string; ids: string[]; isGroup: boolean }[] = []
            const shownIds = new Set<string>()

            for (const group of deptSkillGroups) {
              const allIds = [group.main.id, ...group.subs.map((s: any) => s.id)]
              const activeInGroup = allIds.filter(id => activatedIds.has(id))
              if (activeInGroup.length === 0) continue

              if (activeInGroup.length === allIds.length && group.subs.length > 0) {
                // All sub-skills active → show group name only
                pills.push({ key: group.name, name: group.name, ids: allIds, isGroup: true })
                allIds.forEach(id => shownIds.add(id))
              } else if (activeInGroup.length === 1 && group.subs.length === 0) {
                // Single skill, no subs
                pills.push({ key: group.main.id, name: group.main.skill_name, ids: [group.main.id], isGroup: false })
                shownIds.add(group.main.id)
              } else {
                // Partial activation — show individual skills
                for (const id of activeInGroup) {
                  if (shownIds.has(id)) continue
                  const skill = deptSkills.find(s => s.id === id)
                  if (skill) {
                    pills.push({ key: id, name: skill.skill_name, ids: [id], isGroup: false })
                    shownIds.add(id)
                  }
                }
              }
            }

            if (pills.length === 0) return null
            return (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="text-[10px] text-gray-500 shrink-0">已激活:</span>
                {pills.map(pill => (
                  <div key={pill.key} className="relative group/adept">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium
                      bg-blue-950/40 text-blue-300 border border-blue-500/60
                      shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all">
                      <Zap className="w-3 h-3 text-blue-400" />
                      {pill.name}
                      {pill.isGroup && <span className="text-[9px] text-blue-400/70 ml-0.5">({pill.ids.length})</span>}
                    </span>
                    <button
                      onClick={() => toggleSkillGroup(pill.ids)}
                      className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/adept:opacity-100 transition-opacity
                        w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center
                        text-white shadow-sm z-10"
                      title="取消激活"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* @mention popup (keep for quick access) */}
          {showMention && skills.length > 0 && (
            <div className="absolute bottom-full left-6 mb-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] text-gray-500 border-b border-gray-700">部门技能</div>
              {deptSkills.filter(s => !mentionFilter || s.skill_name.toLowerCase().includes(mentionFilter)).slice(0, 8).map(s => (
                <button key={s.id} onClick={() => handleMentionSelect(s.skill_name)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                  <Zap className="w-3 h-3 text-blue-400" />
                  <span>{s.skill_name}</span>
                  <span className="text-gray-400 ml-auto">{s.category}</span>
                </button>
              ))}
            </div>
          )}

          {/* Chat Input */}
          <div className="relative">
            <ChatInput value={input} onChange={handleInputChange} onSend={handleSend}
              onStop={handleStop} isStreaming={streaming}
              placeholder={
                lockState.locked && !lockState.is_me
                  ? `只读模式 — 正由 ${lockState.editor_display_name} 编辑`
                  : project.status !== 'active' ? '工作流已归档 (只读)' : '输入 @技能名 调用技能... (拖拽文件到此处上传)'}
              projectId={projectId!}
              bottomPanelHeight={bottomHeight || 0} />
          </div>

          {/* ── Task Queue Area ── */}
          {taskQueue.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                <span>任务队列 · {taskQueue.length} 条等待执行</span>
                <button
                  onClick={() => setTaskQueue([])}
                  className="ml-auto text-[10px] text-gray-600 hover:text-red-400 transition-colors"
                >清空队列</button>
              </div>
              {taskQueue.map((task, idx) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(idx))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOverQueueIdx(idx)
                  }}
                  onDragLeave={() => setDragOverQueueIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'))
                    if (!isNaN(fromIdx) && fromIdx !== idx) {
                      moveQueueItem(fromIdx, idx)
                    }
                    setDragOverQueueIdx(null)
                  }}
                  className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border transition-all group/queue ${
                    dragOverQueueIdx === idx
                      ? 'border-blue-400 bg-blue-500/15 shadow-md shadow-blue-500/10'
                      : 'border-gray-500/40 bg-gray-700/50 hover:border-gray-400 hover:bg-gray-700/70'
                  }`}>
                  {/* Drag handle — 显眼 */}
                  <div className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-gray-400 hover:text-amber-400 transition-colors p-0.5 rounded hover:bg-amber-500/10">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  {/* Position indicator */}
                  <div className="shrink-0 w-6 h-6 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center text-[11px] font-bold mt-0.5 border border-blue-500/30">
                    {idx + 1}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-gray-200 whitespace-pre-wrap line-clamp-2 leading-relaxed">{task.content}</p>
                    {task.files.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {task.files.map((f: any, fi: number) => (
                          <span key={fi} className="inline-flex items-center gap-1 text-[10px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
                            <Paperclip className="w-2.5 h-2.5" />
                            {f.filename}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Actions — 始终可见，不隐藏 */}
                  <div className="shrink-0 flex flex-col items-center gap-1 ml-1">
                    {idx > 0 && (
                      <button
                        onClick={() => moveQueueItem(idx, idx - 1)}
                        className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors border border-gray-600/50"
                        title="上移"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => editQueuedTask(task)}
                      className="p-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 hover:text-blue-200 transition-colors border border-blue-500/30"
                      title="编辑"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => cancelQueuedTask(task.id)}
                      className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200 transition-colors border border-red-500/30"
                      title="取消"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right resize handle */}
      <div
        className="w-1.5 hover:w-2 cursor-col-resize hover:bg-indigo-500/30 transition-all shrink-0 relative group hidden lg:block bg-gray-800"
        onMouseDown={startResizeRight}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
      {/* Right Sidebar */}
      <div
        className="border-l border-gray-800 bg-gray-900 shrink-0 hidden lg:flex lg:flex-col"
        style={{ width: rightWidth }}
        onDragOver={handleGlobalDragOver}
      >
        {/* Panel Toolbar — 可拖拽排序、折叠 */}
        <div className="shrink-0 px-3 py-2 border-b border-gray-800 flex items-center gap-1.5 overflow-x-auto">
          {panelOrder.map((pid) => {
            const Icon = PANEL_ICONS[pid]
            const isCollapsed = collapsedPanels.has(pid)
            const colorMap: Record<PanelId, { active: string; inactive: string }> = {
              files:    { active: 'bg-green-500/15 text-green-300 border-green-500/30', inactive: 'text-green-400/50 border-transparent hover:text-green-300 hover:bg-green-500/10' },
              skills:   { active: 'bg-blue-500/15 text-blue-300 border-blue-500/30', inactive: 'text-blue-400/50 border-transparent hover:text-blue-300 hover:bg-blue-500/10' },
              artifacts:{ active: 'bg-amber-500/15 text-amber-300 border-amber-500/30', inactive: 'text-amber-400/50 border-transparent hover:text-amber-300 hover:bg-amber-500/10' },
            }
            const colors = colorMap[pid]
            return (
              <button
                key={pid}
                onClick={() => togglePanelCollapse(pid)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all shrink-0 ${
                  isCollapsed ? colors.inactive : colors.active
                }`}
                title={isCollapsed ? `展开${PANEL_TITLES[pid]}` : `折叠${PANEL_TITLES[pid]}`}
              >
                <Icon className="w-3 h-3" />
                {PANEL_TITLES[pid]}
              </button>
            )
          })}
        </div>

        {/* File Browser — 标签页系统 */}
        {!collapsedPanels.has('files') && (
        <div className="p-4 border-b border-gray-800 shrink-0" style={{ height: sectionHeights.files > 0 ? sectionHeights.files : 'auto', minHeight: 60, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div className="flex items-center gap-1 mb-2 shrink-0 overflow-x-auto">
            {/* Project files tab (permanent) */}
            <button
              onClick={() => setActiveFileTab('project')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all shrink-0 ${
                activeFileTab === 'project'
                  ? 'bg-green-500/15 text-green-300 border-green-500/30'
                  : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              <FolderOpen className="w-3 h-3" />
              工作流文件
            </button>
            {/* External folder tabs */}
            {externalTabs.map(tab => (
              <div key={tab.id} className="relative group/tab shrink-0">
                <button
                  onClick={() => setActiveFileTab(tab.id)}
                  className={`flex items-center gap-1.5 pl-2.5 pr-5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                    activeFileTab === tab.id
                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                      : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <FolderInput className="w-3 h-3" />
                  <span className="truncate max-w-[80px]">{tab.name}</span>
                </button>
                {/* Close button */}
                <button
                  onClick={(e) => { e.stopPropagation(); closeExternalTab(tab.id) }}
                  className="absolute top-0 right-0 w-3 h-3 rounded-full bg-red-500/90 text-white flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity z-10"
                  title="关闭"
                >
                  <X className="w-2 h-2" />
                </button>
              </div>
            ))}
            {/* Add folder button — 调起系统 Finder 选择本地文件夹 */}
            <button
              onClick={handleOpenFolder}
              className="shrink-0 w-6 h-6 rounded-md border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 flex items-center justify-center transition-colors"
              title="打开本地文件夹"
            >
              <Plus className="w-3 h-3" />
            </button>
            {/* Right side: refresh + view mode toggle */}
            <div className="flex gap-0.5 ml-auto shrink-0">
              <button onClick={refreshFiles}
                className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                title="刷新文件列表">
                <RefreshCw className="w-3 h-3" />
              </button>
              {activeFileTab === 'project' && (
                <>
                  <button onClick={() => setFileViewMode('list')}
                    className={`p-1 rounded ${fileViewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                    <List className="w-3 h-3" />
                  </button>
                  <button onClick={() => setFileViewMode('icon')}
                    className={`p-1 rounded ${fileViewMode === 'icon' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                    <Grid3X3 className="w-3 h-3" />
                  </button>
                </>
              )}
              {activeFileTab !== 'project' && (() => {
                const tab = externalTabs.find(t => t.id === activeFileTab)
                if (!tab) return null
                return (
                  <>
                    <button onClick={() => setExternalTabs(prev => prev.map(t => t.id === activeFileTab ? { ...t, viewMode: 'list' } : t))}
                      className={`p-1 rounded ${tab.viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                      <List className="w-3 h-3" />
                    </button>
                    <button onClick={() => setExternalTabs(prev => prev.map(t => t.id === activeFileTab ? { ...t, viewMode: 'icon' } : t))}
                      className={`p-1 rounded ${tab.viewMode === 'icon' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                      <Grid3X3 className="w-3 h-3" />
                    </button>
                  </>
                )
              })()}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto text-[11px]">
            {activeFileTab === 'project' ? (
              /* ── Project files ── */
              fileTree.length === 0 ? (
                <p className="text-xs text-gray-500">项目沙盒为空，上传文件后显示</p>
              ) : (
                <FileTreeNodes
                  nodes={fileTree}
                  expanded={expandedDirs}
                  onToggle={(path) => {
                    const next = new Set(expandedDirs)
                    if (next.has(path)) next.delete(path)
                    else next.add(path)
                    setExpandedDirs(next)
                  }}
                  viewMode={fileViewMode}
                  onContextMenu={handleContextMenu}
                  onReveal={handleRevealInFinder}
                  onFileClick={handleFileClick}
                  depth={0}
                  iconViewPath={iconViewPath}
                  onIconViewNav={(p) => setIconViewPath(p ? p.split('/') : [])}
                />
              )
            ) : (
              /* ── External folder ── */
              (() => {
                const tab = externalTabs.find(t => t.id === activeFileTab)
                if (!tab) return <p className="text-xs text-gray-500">标签不存在</p>
                if (tab.loading) return (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                    <span className="text-xs text-gray-400">加载中...</span>
                  </div>
                )
                if (tab.error) return <p className="text-xs text-red-400">{tab.error}</p>
                if (tab.tree.length === 0) return (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <p className="text-xs text-gray-500">文件夹为空或加载失败</p>
                    <button
                      onClick={() => openExternalFolder(tab.path)}
                      className="text-[10px] px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                    >重新加载</button>
                  </div>
                )
                return (
                  <>
                    <div className="flex-1 overflow-y-auto">
                      <FileTreeNodes
                        nodes={tab.tree}
                        expanded={tab.expanded}
                        onToggle={(path) => toggleExternalExpand(tab.id, path)}
                        viewMode={tab.viewMode}
                        onContextMenu={handleContextMenu}
                        onReveal={handleRevealInFinder}
                        onFileClick={handleFileClick}
                        depth={0}
                        iconViewPath={[]}
                      />
                    </div>
                  </>
                )
              })()
            )}
          </div>
          <p className="text-[10px] text-gray-500 mt-2 leading-relaxed shrink-0">
            拖拽文件到左侧对话框 · 右键在访达中打开
          </p>
        </div>
        )}

        {/* Section resize handle: files ↔ skills */}
        <div
          className="h-1.5 hover:h-2 cursor-row-resize hover:bg-green-500/30 transition-all shrink-0 relative group"
          onMouseDown={startResizeSection('files')}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>

        {/* Department Skills */}
        {!collapsedPanels.has('skills') && (
        <div className="p-4 border-b border-gray-800 shrink-0" style={{ height: sectionHeights.skills > 0 ? sectionHeights.skills : 'auto', minHeight: 60, display: 'flex', flexDirection: 'column' }}>
          <div className="shrink-0 mb-3">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            {deptCategoryFilter ? (
              <>
                <button onClick={() => setDeptCategoryFilter('')}
                  className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                  <ChevronLeft className="w-3 h-3" />返回
                </button>
                <span className="text-[11px] text-blue-300">{deptCategoryFilter}</span>
              </>
            ) : (
              '部门技能'
            )}
            <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{deptSkillGroups.length}</span>
          </h3>
          </div>
          {deptSkillGroups.length === 0 ? (
            <div className="flex-1"><p className="text-xs text-gray-500">暂无部门技能</p></div>
          ) : !deptCategoryFilter ? (
            /* 分类气泡列表 */
            <div className="flex-1 pr-1" style={{ overflowY: 'auto', overflowX: 'visible' }}>
              <div className="flex flex-wrap gap-1.5 py-1">
                {(() => {
                  const cats = [...new Set(deptSkillGroups.map(g => g.main?.category || '未分类'))]
                  const filtered = cats.filter(c => c !== '未分类' || deptSkillGroups.some(g => !g.main?.category))
                  return filtered.slice(0, 16).map((cat, i) => {
                    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6']
                    const borderColor = colors[i % colors.length]
                    return (
                      <button key={cat} onClick={() => setDeptCategoryFilter(cat)}
                        className="px-2.5 py-1 rounded-full text-xs border transition-all hover:brightness-110"
                        style={{ borderColor, color: borderColor, background: `${borderColor}10` }}>
                        {cat}
                      </button>
                    )
                  })
                })()}
              </div>
            </div>
          ) : (
            /* 选中分类后的技能列表 */
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
              {deptSkillGroups.slice(0, 15).filter(group => {
                // Check if ANY skill in the group matches the selected category
                const allSkills = [group.main, ...group.subs]
                return allSkills.some(s => (s?.category || '未分类') === deptCategoryFilter)
              }).map((group) => {
                const skill = group.main
                const hasSubs = group.subs.length > 0
                const isGroupExpanded = expandedDeptGroups.has(group.name)
                const allSubIds = [skill.id, ...group.subs.map((s: any) => s.id)]
                const allActive = allSubIds.every(id => activeSkillIds.has(id))
                const someActive = allSubIds.some(id => activeSkillIds.has(id))
                const usage = group.totalUsage

                return (
                  <div key={group.name}>
                    {/* Main skill row */}
                    <div
                      className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 hover:border-gray-600 cursor-pointer transition-all"
                      onClick={() => {
                        if (hasSubs) toggleSkillGroup(allSubIds)
                        else toggleSkill(skill.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        const homeDir = '/Users/jiayiren'
                        const deptId = skill.department_id || 'default'
                        const safeName = skill.skill_name.replace(/[^\w\-]/g, '_')
                        setDeptContextMenu({ x: e.clientX, y: e.clientY, skill: { ...skill, _path: `${homeDir}/.hermes/skills/${deptId}/${safeName}` } })
                      }}
                    >
                      {hasSubs && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedDeptGroups(prev => {
                              const next = new Set(prev)
                              if (next.has(group.name)) next.delete(group.name)
                              else next.add(group.name)
                              return next
                            })
                          }}
                          className="p-0.5 rounded hover:bg-gray-700 text-gray-500 transition-colors shrink-0"
                        >
                          {isGroupExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      )}
                      <p className={`text-xs font-medium flex-1 truncate ${allActive ? 'text-blue-300' : someActive ? 'text-blue-200/70' : 'text-gray-300'}`}>
                        {allActive && <Zap className="w-3 h-3 inline mr-1 text-blue-400" />}
                        {someActive && !allActive && <Zap className="w-3 h-3 inline mr-1 text-blue-400/50" />}
                        {group.name}
                        {hasSubs && <span className="text-[10px] text-gray-500 ml-1">({group.subs.length + 1})</span>}
                      </p>
                      {usage > 0 && (
                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full shrink-0">×{usage}</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDetailDeptSkill(skill) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all shrink-0 text-gray-500 hover:text-gray-300"
                        title="查看详情"
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Sub-skills (expandable) */}
                    {hasSubs && isGroupExpanded && (
                      <div className="ml-4 mt-1 space-y-1">
                        {group.subs.map((sub: any) => {
                          const subActive = activeSkillIds.has(sub.id)
                          return (
                            <div
                              key={sub.id}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-800/30 hover:bg-gray-800/60 cursor-pointer transition-colors"
                              onClick={(e) => { e.stopPropagation(); toggleSkill(sub.id) }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                const homeDir = '/Users/jiayiren'
                                const deptId = sub.department_id || 'default'
                                const safeName = sub.skill_name.replace(/[^\w\-]/g, '_')
                                setDeptContextMenu({ x: e.clientX, y: e.clientY, skill: { ...sub, _path: `${homeDir}/.hermes/skills/${deptId}/${safeName}` } })
                              }}
                            >
                              <p className={`text-[11px] font-medium flex-1 truncate ${subActive ? 'text-blue-300' : 'text-gray-400'}`}>
                                {subActive && <Zap className="w-2.5 h-2.5 inline mr-1 text-blue-400" />}
                                {sub.skill_name}
                              </p>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDetailDeptSkill(sub) }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-500 hover:text-gray-300 transition-all"
                                title="查看详情"
                              >
                                <Info className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </div>
        )}

        {/* Section resize handle: skills ↔ artifacts */}
        <div
          className="h-1.5 hover:h-2 cursor-row-resize hover:bg-amber-500/30 transition-all shrink-0 relative group"
          onMouseDown={startResizeSection('skills')}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>

        {/* Artifacts — 工作流产出物 (with file type filter) */}
        {!collapsedPanels.has('artifacts') && (
        <div className="p-4 flex-1 flex flex-col min-h-0" style={{ overflow: 'hidden' }}>
          {(() => {
            const allWithPaths = artifacts.filter((a: any) => a.artifact_path)
            // Compute available file types from current artifacts
            const availableTypes = Array.from(new Set(
              allWithPaths.map((a: any) => (a.file_type || 'other').toLowerCase())
            )).sort()
            // Filter by selected types (empty set = show all)
            const filtered = artifactTypeFilter.size === 0
              ? allWithPaths
              : allWithPaths.filter((a: any) => artifactTypeFilter.has((a.file_type || 'other').toLowerCase()))

            const toggleType = (t: string) => {
              setArtifactTypeFilter(prev => {
                const next = new Set(prev)
                if (next.has(t)) {
                  next.delete(t)
                } else {
                  next.add(t)
                }
                return next
              })
            }

            const typeIcon: Record<string, string> = {
              xlsx: '📊', xls: '📊', csv: '📊',
              py: '🐍', js: '📜', ts: '📜', tsx: '⚛️', jsx: '⚛️',
              md: '📝', txt: '📄', pdf: '📕', docx: '📘', doc: '📘',
              png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎨',
              html: '🌐', css: '🎨', json: '📋', yaml: '📋', yml: '📋',
              zip: '📦', mp4: '🎬',
            }

            return (
              <>
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  工作流产出物
                  <button onClick={refreshFiles}
                    className="ml-auto p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                    title="刷新产出物">
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                    {filtered.length}{artifactTypeFilter.size > 0 ? `/${allWithPaths.length}` : ''}
                  </span>
                </h3>

                {/* Type filter pills */}
                {availableTypes.length > 1 && (
                  <div className="flex flex-wrap gap-1 mb-2 shrink-0">
                    <button
                      onClick={() => setArtifactTypeFilter(new Set())}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                        artifactTypeFilter.size === 0
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-white/10 text-gray-300 border-gray-600 hover:bg-white/20 hover:text-white'
                      }`}
                    >全部</button>
                    {availableTypes.map(t => {
                      const active = artifactTypeFilter.has(t)
                      return (
                        <button
                          key={t}
                          onClick={() => toggleType(t)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all flex items-center gap-1 ${
                            active
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-white/10 text-gray-300 border-gray-600 hover:bg-white/20 hover:text-white'
                          }`}
                        >
                          <span className="text-[9px]">{typeIcon[t] || '📎'}</span>
                          .{t}
                        </button>
                      )
                    })}
                  </div>
                )}

                {filtered.length === 0 ? (
                  <div className="flex-1">
                    <p className="text-xs text-gray-500">
                      {allWithPaths.length === 0
                        ? '暂无产出文件，对话后将自动检测生成的文件'
                        : '当前筛选条件下无匹配文件'}
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-1.5">
                    {filtered.map((a) => (
                      <div key={a.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', a.artifact_path || a.title)
                          e.dataTransfer.effectAllowed = 'copy'
                          const fullPath = `/Users/jiayiren/Desktop/Hermes_Agent/enterprise-ai-platform/backend/storage/projects/project_${projectId}/${a.artifact_path}`
                          window.dispatchEvent(new CustomEvent('sidebar-drop', {
                            detail: { name: a.title, path: a.artifact_path, stored_path: fullPath, ext: '.' + (a.file_type || 'file'), size: (a as any).file_size || 0 }
                          }))
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          if (a.artifact_path && projectId) {
                            const storageRoot = '/Users/jiayiren/Desktop/Hermes_Agent/enterprise-ai-platform/backend/storage/projects'
                            const sandboxPath = `${storageRoot}/project_${projectId}/${a.artifact_path}`
                            handleContextMenu(e, sandboxPath)
                          }
                        }}
                        className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gray-800/50 border border-gray-700 hover:border-amber-500/30 hover:bg-gray-800 cursor-pointer transition-all">
                        <File className={`w-3.5 h-3.5 ${fileIconColor('.' + (a.file_type || 'file'))} shrink-0`} />
                        <div className="flex-1 min-w-0" onClick={() => {
                          if (a.artifact_path) {
                            const storageRoot = '/Users/jiayiren/Desktop/Hermes_Agent/enterprise-ai-platform/backend/storage/projects'
                            api.openFile(`${storageRoot}/project_${projectId}/${a.artifact_path}`).catch(() => {})
                          }
                        }}>
                          <p className="text-xs font-medium text-gray-300 truncate group-hover:text-amber-300 transition-colors">{a.title}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{a.artifact_path || a.file_type}</p>
                        </div>
                        <button onClick={(e) => {
                          e.stopPropagation()
                          if (a.artifact_path) {
                            const storageRoot = '/Users/jiayiren/Desktop/Hermes_Agent/enterprise-ai-platform/backend/storage/projects'
                            api.openFile(`${storageRoot}/project_${projectId}/${a.artifact_path}`).catch(() => {})
                          }
                        }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-700 transition-all shrink-0"
                          title="用默认应用打开">
                          <ExternalLink className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
        )}

      </div>

      {globalDragOver && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          onDragOver={handleGlobalDragOver}
          onDragLeave={handleGlobalDragLeave}
        >
          <div className="absolute inset-0 bg-blue-900/15 backdrop-blur-[2px] pointer-events-none" />
          <div className="relative z-10 bg-gray-900/95 border-2 border-dashed border-blue-500 rounded-2xl px-12 py-10 shadow-2xl shadow-blue-500/20 text-center pointer-events-none">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-blue-400" />
            </div>
            <p className="text-base text-blue-300 font-semibold mb-1">释放文件到对话</p>
            <p className="text-xs text-gray-500">支持所有常见文件类型</p>
          </div>
        </div>
      )}

      {/* ── 申请编辑权弹窗 ── */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowTransferModal(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-3">申请编辑权</h3>
            <p className="text-xs text-gray-400 mb-4">
              当前项目由 <span className="text-amber-300 font-medium">{lockState.editor_display_name}</span> 编辑中。
              发送申请后，对方将收到通知并决定是否移交编辑权。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowTransferModal(false)}
                className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >取消</button>
              <button
                onClick={async () => {
                  try {
                    const res = await api.requestTransfer(projectId!)
                    setTransferStatus(`已发送申请给 ${res.target}，等待对方确认...`)
                    setShowTransferModal(false)
                    // 轮询请求状态
                    const checkInterval = setInterval(async () => {
                      try {
                        const myReqs = await api.getMyRequests()
                        const req = myReqs.find((r: any) => r.request_id === res.request_id)
                        if (req?.status === 'approved') {
                          clearInterval(checkInterval)
                          const ls = await api.getLockStatus(projectId!)
                          setLockState(ls)
                          setTransferStatus('已获得编辑权！')
                          setTimeout(() => setTransferStatus(null), 3000)
                        } else if (req?.status === 'rejected') {
                          clearInterval(checkInterval)
                          setTransferStatus('对方拒绝了你的申请')
                          setTimeout(() => setTransferStatus(null), 3000)
                        }
                      } catch {}
                    }, 2000)
                    setTimeout(() => clearInterval(checkInterval), 60000)
                  } catch (e: any) {
                    setTransferStatus(e.message || '申请失败')
                  }
                  setShowTransferModal(false)
                }}
                className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >发送申请</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 收到接管请求弹窗 ── */}
      {showIncomingRequest && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-gray-800 border border-indigo-500/50 rounded-2xl w-full max-w-sm p-6 shadow-2xl shadow-indigo-500/10">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <User className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">编辑权移交请求</h3>
                <p className="text-[10px] text-gray-500">来自 {showIncomingRequest.from_username}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              <span className="text-indigo-300 font-medium">{showIncomingRequest.from_display_name}</span> 请求接手当前项目的编辑权。
              同意后你将变为只读模式。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={async () => {
                  await api.respondTransfer(showIncomingRequest.request_id, false)
                  setShowIncomingRequest(null)
                }}
                className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors"
              >拒绝</button>
              <button
                onClick={async () => {
                  await api.respondTransfer(showIncomingRequest.request_id, true)
                  setShowIncomingRequest(null)
                  // 刷新锁定状态
                  const ls = await api.getLockStatus(projectId!)
                  setLockState(ls)
                }}
                className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >同意移交</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 技能搜索弹窗 ── */}
      {showSkillSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSkillSearch(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
              <Search className="w-4 h-4 text-gray-500 shrink-0" />
              <input
                autoFocus
                value={skillSearchQuery}
                onChange={(e) => handleSkillSearch(e.target.value)}
                placeholder="搜索技能（名称、功能、描述）..."
                className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder-gray-600"
              />
              <button onClick={() => setShowSkillSearch(false)}
                className="text-gray-500 hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {skillSearchResults.length === 0 && skillSearchQuery.length > 0 && (
                <p className="text-xs text-gray-500 text-center py-8">未找到匹配的技能</p>
              )}
              {skillSearchResults.length === 0 && skillSearchQuery.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-8">输入关键词搜索所有可用技能</p>
              )}
              {skillSearchResults.map((s: any, i: number) => {
                // Find matching skill in the skills list by name to get the correct ID
                const matchedSkill = skills.find(sk => sk.skill_name === s.skill_name)
                const skillId = matchedSkill?.id || s.id
                const alreadyActive = activeSkillIds.has(skillId)
                const sourceLabel = s.source === 'hermes_native' ? 'Hermes原生' :
                  s.source === 'global' ? '全局技能' :
                  s.source === 'department' ? '部门技能' :
                  s.source === 'import_zip' ? 'ZIP导入' :
                  s.source === 'distillation' ? '蒸馏' : s.source || '技能'
                const sourceColor = s.source === 'hermes_native' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/20' :
                  s.source === 'global' ? 'bg-amber-500/20 text-amber-400 border-amber-500/20' :
                  s.source === 'department' ? 'bg-blue-500/20 text-blue-400 border-blue-500/20' :
                  s.source === 'import_zip' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' :
                  s.source === 'distillation' ? 'bg-purple-500/20 text-purple-400 border-purple-500/20' :
                  'bg-gray-500/20 text-gray-400 border-gray-500/20'
                const categoryLabel = s.category && s.category !== 'native' && s.category !== 'department' ? s.category : null
                return (
                  <button key={i}
                    onClick={() => {
                      toggleSkill(skillId)
                      setShowSkillSearch(false)
                      setSkillSearchQuery('')
                    }}
                    disabled={alreadyActive}
                    className="w-full text-left px-4 py-3 hover:bg-gray-700/50 transition-colors border-b border-gray-700/50 last:border-b-0 disabled:opacity-40 disabled:cursor-not-allowed">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-200 font-medium">{s.skill_name}</span>
                      <div className="flex items-center gap-1.5">
                        {categoryLabel && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400">{categoryLabel}</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${sourceColor}`}>
                          {sourceLabel}
                        </span>
                      </div>
                    </div>
                    {s.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                    )}
                    {alreadyActive && <p className="text-[10px] text-blue-400 mt-1">✓ 已激活</p>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 右键菜单 ── */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[60] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 60) }}
          >
            <button
              onClick={() => handleRevealInFinder(contextMenu.path)}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <Folder className="w-3.5 h-3.5 text-blue-400" />
              在访达中打开位置
            </button>
          </div>
        </>
      )}

      {/* ── 部门技能右键菜单 ── */}
      {deptContextMenu && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setDeptContextMenu(null)} />
          <div
            className="fixed z-[60] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: Math.min(deptContextMenu.x, window.innerWidth - 200), top: Math.min(deptContextMenu.y, window.innerHeight - 60) }}
          >
            <button
              onClick={() => { handleRevealInFinder(deptContextMenu.skill._path); setDeptContextMenu(null) }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <Folder className="w-3.5 h-3.5 text-blue-400" />
              打开文件夹位置
            </button>
          </div>
        </>
      )}

      {/* ── 部门技能详情弹窗 ── */}
      {detailDeptSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetailDeptSkill(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-6 py-4 border-b border-gray-700 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white">{detailDeptSkill.skill_name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {detailDeptSkill.category && <span className="text-[10px] text-gray-500">{detailDeptSkill.category}</span>}
                  {detailDeptSkill.import_source && <span className="text-[10px] text-gray-500">· {detailDeptSkill.import_source}</span>}
                </div>
              </div>
              <button onClick={() => setDetailDeptSkill(null)} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {detailDeptSkill.description && (
              <div className="shrink-0 px-6 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm text-gray-300 leading-relaxed">{detailDeptSkill.description}</p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-4 markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detailDeptSkill.content_prompt || '无内容'}
              </ReactMarkdown>
            </div>
            <div className="shrink-0 px-6 py-3 border-t border-gray-700 flex items-center justify-end text-[10px] text-gray-500">
              <button
                onClick={() => { toggleSkill(detailDeptSkill.id); setDetailDeptSkill(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSkillIds.has(detailDeptSkill.id)
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
                }`}
              >
                {activeSkillIds.has(detailDeptSkill.id) ? '取消激活' : '激活技能'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Artifact Preview Modal */}
      {previewArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setPreviewArtifact(null)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-white">{previewArtifact.title}</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">{previewArtifact.file_type} · {previewArtifact.content.length} 字符</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { navigator.clipboard.writeText(previewArtifact.content) }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
                  <Copy className="w-3 h-3" />复制
                </button>
                <button onClick={() => setPreviewArtifact(null)} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-gray-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-mono text-[13px] bg-gray-900 rounded-lg p-4 border border-gray-700">
                {previewArtifact.content}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 图片预览 ── */}
      {previewImage && (
        <ImageViewer
          src={previewImage.src}
          filename={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}

      {/* Video floating window is now in App.tsx for cross-page persistence */}
    </div>
  )
}
