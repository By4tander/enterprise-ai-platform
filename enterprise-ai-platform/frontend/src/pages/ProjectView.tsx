import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { api, chatStream } from '../services/api'
import { useProjectSkills, skillSourceColor } from '../hooks/useProjectSkills'
import ChatInput from '../components/chat/ChatInput'
import {
  Archive, FileText, BookOpen, ChevronDown, ChevronRight,
  Loader2, Bot, User, Sparkles, AlertCircle, Copy, X, Zap,
  Activity, Cpu, Clock, BarChart3, Wrench, Brain, Pause, Play,
  FolderOpen, Grid3X3, List, Folder, File, FolderTree, ExternalLink, Check,
  Search, Plus, XCircle
} from 'lucide-react'

interface Message {
  id: string
  sender_type: string
  sender_name: string
  content: string
  thinking_content: string | null
  timestamp: string
}

interface Artifact {
  id: string
  title: string
  content: string
  file_type: string
  created_at: string
  artifact_path?: string | null
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

function FileTreeNodes({ nodes, expanded, onToggle, viewMode, onContextMenu, onReveal, depth, iconViewPath, onIconViewNav }: {
  nodes: any[]
  expanded: Set<string>
  onToggle: (path: string) => void
  viewMode: string
  onContextMenu: (e: React.MouseEvent, path: string) => void
  onReveal: (path: string) => void
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
                <span className="text-gray-600">/</span>
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
              onClick={() => onReveal(f.stored_path)}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-800/80 cursor-pointer group text-center">
              <File className={`w-7 h-7 ${fileIconColor(f.ext || '')}`} />
              <span className="text-[10px] text-gray-300 truncate w-full leading-tight">{f.name}</span>
            </div>
          ))}
        </div>
        {dirs.length === 0 && files.length === 0 && (
          <p className="text-[10px] text-gray-600 text-center py-4">此文件夹为空</p>
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
                    viewMode={viewMode} onContextMenu={onContextMenu} onReveal={onReveal} depth={depth + 1}
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
            onClick={() => onReveal(node.stored_path)}
            className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-gray-800/80 cursor-pointer group text-gray-300 hover:text-white transition-colors">
            <span className="w-3" />
            <File className={`w-3.5 h-3.5 shrink-0 ${fileIconColor(node.ext || '')}`} />
            <span className="truncate flex-1">{node.name}</span>
            <span className="text-[9px] text-gray-600 shrink-0 ml-1">{node.ext}</span>
          </div>
        )
      })}
    </>
  )
}

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeSkillIds, setActiveSkillIds] = useState<Set<string>>(new Set())
  const [skillUsageCounts, setSkillUsageCounts] = useState<Record<string, number>>({})
  const [input, setInput] = useState('')
  // Per-project input isolation — persists unsent text when switching projects
  const inputRef = useRef('')
  const inputCacheRef = useRef<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [showThinking, setShowThinking] = useState(true)
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null)
  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [hermesStatus, setHermesStatus] = useState<HermesStatus>({
    model: '--', provider: '--', tokensUsed: 0, inputTokens: 0, outputTokens: 0, elapsed: 0, status: '空闲'
  })
  const [paused, setPaused] = useState(false)
  // ── 项目文件浏览器 ──
  const [projectFiles, setProjectFiles] = useState<any[]>([])
  const [fileTree, setFileTree] = useState<any[]>([])
  const [fileViewMode, setFileViewMode] = useState<'list' | 'icon'>('list')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']))
  // ── 图标视图导航 ──
  const [iconViewPath, setIconViewPath] = useState<string[]>([])
  // ── 全局拖放 ──
  const [globalDragOver, setGlobalDragOver] = useState(false)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ── 右键菜单 ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  // ── 复制反馈 ──
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // ── 面板大小调整 ──
  const [rightWidth, setRightWidth] = useState(288)
  const [bottomHeight, setBottomHeight] = useState(0)
  const [sectionHeights, setSectionHeights] = useState({ files: 180, skills: 160, artifacts: 0 }) // 0 = auto
  const resizeRef = useRef<{ target: string; startX: number; startY: number; startSize: number } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  // Refs to track streaming content for onDone (avoids stale closure)
  const streamContentRef = useRef('')
  const streamThinkingRef = useRef('')

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (streaming) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [streamContent, streamThinking, streaming])

  // ── 项目切换时：终止旧项目流式 + 重置所有 UI 状态 ──
  useEffect(() => {
    // 1. 终止旧项目中仍在运行的 SSE 流
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }

    // 2. 重置流式相关状态（防止旧项目的思考/回复在新项目中显示）
    setStreaming(false)
    setStreamContent('')
    setStreamThinking('')
    streamContentRef.current = ''
    streamThinkingRef.current = ''

    // 3. 重置 Hermes 状态栏
    setHermesStatus({
      model: '--', provider: '--', tokensUsed: 0,
      inputTokens: 0, outputTokens: 0, elapsed: 0, status: '空闲'
    })

    // 4. 重置交互状态（技能激活、暂停、菜单等）
    setActiveSkillIds(new Set())
    setPaused(false)
    setShowMention(false)
    setContextMenu(null)
    setGlobalDragOver(false)
    setPreviewArtifact(null)
    setIconViewPath([])
    // 注意：skillUsageCounts 保留（可选——跨项目技能使用统计可累积或重置）
    setSkillUsageCounts({})
  }, [projectId])

  // ── Per-project input isolation: save before switching, restore on mount ──
  useEffect(() => {
    // Restore cached input for this project (or empty if first visit)
    setInput(inputCacheRef.current[projectId || ''] || '')
    inputRef.current = inputCacheRef.current[projectId || ''] || ''
    return () => {
      // Save current input when leaving this project
      if (projectId) {
        inputCacheRef.current[projectId] = inputRef.current
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
      setMessages(msgs)
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

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { scrollToBottom() }, [messages, streamContent])

  // ── 项目技能 — useProjectSkills hook ──
  const {
    projectSkills, showSkillSearch, setShowSkillSearch,
    skillSearchQuery, skillSearchResults, handleSkillSearch,
    addSkillToProject, removeSkillFromProject,
  } = useProjectSkills(projectId)

  const handleSend = async (text: string, files?: any[]) => {
    if ((!text && (!files || files.length === 0)) || !projectId || streaming) return
    const content = text || '请分析附件文件'
    setInput('')
    inputRef.current = ''
    if (projectId) {
      inputCacheRef.current[projectId] = ''
    }
    setStreaming(true)
    setStreamContent('')
    setStreamThinking('')
    setShowThinking(true)
    streamContentRef.current = ''
    streamThinkingRef.current = ''
    setHermesStatus({ model: '--', provider: '--', tokensUsed: 0, inputTokens: 0, outputTokens: 0, elapsed: 0, status: '启动中...' })

    let fullContent = content
    const activeSkills = skills.filter(s => activeSkillIds.has(s.id))
    if (activeSkills.length > 0) {
      const skillTags = activeSkills.map(s => `@${s.skill_name}`).join(' ')
      fullContent = `${skillTags} ${content}`
      // Track usage
      const newCounts = { ...skillUsageCounts }
      activeSkills.forEach(s => { newCounts[s.id] = (newCounts[s.id] || 0) + 1 })
      setSkillUsageCounts(newCounts)
    }

    const filePaths = files?.map((f: any) => f.stored_path || f.relative_path) || []

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      sender_type: 'user',
      sender_name: '我',
      content: fullContent,
      thinking_content: null,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    const controller = chatStream(projectId, fullContent, {
      onStatus: (msg) => {
        setHermesStatus(prev => ({ ...prev, status: msg }))
      },
      onContext: (data) => {
        try {
          const ctx = JSON.parse(data)
          setHermesStatus(prev => ({
            ...prev,
            model: ctx.model || prev.model,
            provider: ctx.provider || prev.provider,
            tokensUsed: ctx.tokens_used || prev.tokensUsed,
            inputTokens: ctx.input_tokens || prev.inputTokens,
            outputTokens: ctx.output_tokens || prev.outputTokens,
            elapsed: ctx.elapsed_seconds || prev.elapsed,
            status: ctx.elapsed_seconds > 0 ? '完成' : '推理中...',
          }))
        } catch {}
      },
      onContent: (chunk) => {
        streamContentRef.current += chunk
        setStreamContent((prev) => prev + chunk)
      },
      onThinking: (chunk) => {
        streamThinkingRef.current += chunk
        setStreamThinking((prev) => prev + chunk)
      },
      onToolCall: (data) => {
        try {
          const tc = JSON.parse(data)
          streamContentRef.current += `\n\n> 🔧 调用工具: **${tc.tool}**\n`
          setStreamContent((prev) => prev + `\n\n> 🔧 调用工具: **${tc.tool}**\n`)
        } catch {}
      },
      onDone: (messageId) => {
        const finalContent = streamContentRef.current
        const finalThinking = streamThinkingRef.current || null
        // Directly add agent message (don't call loadData to avoid spinner flash)
        setMessages((msgs) => [...msgs, {
          id: messageId || `agent-${Date.now()}`,
          sender_type: 'agent',
          sender_name: 'hermes-agent',
          content: finalContent,
          thinking_content: finalThinking,
          timestamp: new Date().toISOString(),
        }])
        setStreaming(false)
        setStreamContent('')
        setStreamThinking('')
        streamContentRef.current = ''
        streamThinkingRef.current = ''
        setHermesStatus(prev => ({ ...prev, status: '空闲', elapsed: 0 }))
        // Silently refresh artifacts in background
        setTimeout(() => {
          if (!projectId) return
          api.getArtifacts(projectId).then(setArtifacts).catch(() => {})
        }, 500)
      },
      onError: (err) => {
        streamContentRef.current += `\n\n> ⚠️ 错误: ${err}`
        setStreamContent((prev) => prev + `\n\n> ⚠️ 错误: ${err}`)
        setStreaming(false)
        setHermesStatus(prev => ({ ...prev, status: '错误' }))
      },
    })
    streamAbortRef.current = controller
  }

  const handlePause = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      setStreaming(false)
      setHermesStatus(prev => ({ ...prev, status: '已暂停' }))
    }
  }

  const handleArchive = async () => {
    if (!projectId) return
    if (!confirm('确定要结案归档此项目吗？归档后将自动触发技能提炼流水线。')) return
    try {
      await api.archiveProject(projectId)
      alert('项目已归档！提炼的技能已存入部门技能库，待管理员审核。')
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

  // ── 右键菜单 ──
  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, path })
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

  // ── 页面级拖放（全局检测，整个页面任何位置均可拖入文件） ──
  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    )
  }

  if (loadError && !project) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm mb-1">加载失败</p>
        <p className="text-xs text-gray-600 mb-4 max-w-md text-center">{loadError}</p>
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

        {/* Hermes Status Bar */}
        <div className="shrink-0 px-6 py-1.5 border-b border-gray-800 bg-gray-950/80 flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-gray-400" />
            <span className="text-gray-200 font-mono font-medium">{hermesStatus.model}</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">{hermesStatus.provider}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-300">
            <BarChart3 className="w-3 h-3" />
            <span>{hermesStatus.inputTokens?.toLocaleString() || 0}↑</span>
            <span className="text-gray-600">/</span>
            <span>{hermesStatus.outputTokens?.toLocaleString() || 0}↓</span>
            <span className="text-gray-600">|</span>
            <span>{(hermesStatus.tokensUsed || 0).toLocaleString()} tok</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-300">
            <Clock className="w-3 h-3" />
            <span>{hermesStatus.elapsed > 0 ? `${hermesStatus.elapsed.toFixed(1)}s` : '--'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className={`w-3 h-3 ${streaming ? 'text-green-400 animate-pulse' : 'text-gray-500'}`} />
            <span className={streaming ? 'text-green-400 font-medium' : 'text-gray-400'}>{hermesStatus.status}</span>
          </div>
          {streaming && (
            <button onClick={handlePause} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              <Pause className="w-3 h-3" />暂停
            </button>
          )}
          <div className="ml-auto text-gray-500">Hermes Agent v0.19.0</div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Bot className="w-12 h-12 mb-3 text-gray-600" />
              <p className="text-sm text-gray-400">开始与 AI 对话</p>
              <p className="text-xs mt-1 text-gray-500">输入您的问题，AI 将借助部门沉淀技能为您服务</p>
              <p className="text-xs mt-3 text-gray-600">可用原生技能: {nativeSkills.length} 个 · 部门技能: {deptSkills.length} 个</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.sender_type === 'agent' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-1">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              )}

              <div className={`max-w-[75%] ${msg.sender_type === 'user' ? 'order-first' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 ${msg.sender_type === 'user' ? 'justify-end' : ''}`}>
                  <span className="text-xs text-gray-400">{msg.sender_name}</span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Thinking Accordion */}
                {msg.thinking_content && (
                  <details className="mb-2 group">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1.5 select-none">
                      <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                      <Brain className="w-3 h-3" />
                      <span>思考过程</span>
                      <span className="text-gray-500">({msg.thinking_content.length} 字)</span>
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
                        }}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>

              {msg.sender_type === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center shrink-0 mt-1">
                  <User className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming Message */}
          {streaming && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-1">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-[75%]">
                <span className="text-xs text-gray-400">AI 助手</span>
                {streamThinking && (
                  <details className="mb-2 group" open={showThinking}>
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1.5 select-none"
                      onClick={(e) => { e.preventDefault(); setShowThinking(!showThinking) }}>
                      <span className={`inline-block transition-transform ${showThinking ? 'rotate-90' : ''}`}>▶</span>
                      <Brain className="w-3 h-3" />
                      <span>思考中...</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-gray-500">({streamThinking.length} 字)</span>
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
          {/* Project Skills Bar */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400 font-medium shrink-0">项目技能:</span>
            <div className="flex items-center gap-1.5 flex-wrap flex-1">
              {projectSkills.map((s) => {
                const isActive = activeSkillIds.has(s.id)
                const source = (s as any).source || 'manual'
                return (
                  <div key={s.id} className="relative group/skill">
                    <button
                      onClick={() => toggleSkill(s.id)}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-all duration-300 ${isActive ? skillSourceColor(source) + ' shadow-[0_0_10px_rgba(59,130,246,0.4)] animate-pulse' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-300'}`}>
                      {isActive && <Zap className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />}
                      {s.skill_name}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSkillFromProject(s.id) }}
                      className="absolute -top-1.5 -right-2 opacity-0 group-hover/skill:opacity-100 transition-opacity w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">
                      <X className="w-2 h-2" />
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => setShowSkillSearch(true)}
              className="shrink-0 px-3 py-0.5 rounded-full text-xs font-medium border border-gray-600 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-500 flex items-center gap-1.5 transition-colors ml-auto">
              <Search className="w-3.5 h-3.5" /> 搜索技能
            </button>
          </div>

          {/* @mention popup (keep for quick access) */}
          {showMention && skills.length > 0 && (
            <div className="absolute bottom-full left-6 mb-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] text-gray-500 border-b border-gray-700">部门技能</div>
              {deptSkills.filter(s => !mentionFilter || s.skill_name.toLowerCase().includes(mentionFilter)).slice(0, 8).map(s => (
                <button key={s.id} onClick={() => handleMentionSelect(s.skill_name)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                  <Zap className="w-3 h-3 text-blue-400" />
                  <span>{s.skill_name}</span>
                  {s.category && <span className="text-gray-600 ml-auto">{s.category}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Chat Input */}
          <div className="relative">
            <ChatInput value={input} onChange={handleInputChange} onSend={handleSend}
              disabled={streaming || project.status !== 'active'}
              placeholder={project.status !== 'active' ? '项目已归档 (只读)' : '输入 @技能名 调用技能... (拖拽文件到此处上传)'}
              projectId={projectId!}
              bottomPanelHeight={bottomHeight || 0} />
          </div>
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
        {/* Project File Browser — 树形结构 + 图标视图 + 文件类型颜色 */}
        <div className="p-4 border-b border-gray-800 shrink-0" style={{ height: sectionHeights.files > 0 ? sectionHeights.files : 'auto', minHeight: 60, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold flex items-center gap-2">
              <FolderOpen className="w-3.5 h-3.5 text-green-400" />
              项目文件
            </h3>
            <div className="flex gap-0.5">
              <button onClick={() => setFileViewMode('list')}
                className={`p-1 rounded ${fileViewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-400'}`}>
                <List className="w-3 h-3" />
              </button>
              <button onClick={() => setFileViewMode('icon')}
                className={`p-1 rounded ${fileViewMode === 'icon' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-400'}`}>
                <Grid3X3 className="w-3 h-3" />
              </button>
            </div>
          </div>
          {fileTree.length === 0 ? (
            <p className="text-xs text-gray-600">项目沙盒为空，上传文件后显示</p>
          ) : (
            <div className="flex-1 overflow-y-auto text-[11px]">
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
                depth={0}
                iconViewPath={iconViewPath}
                onIconViewNav={(p) => setIconViewPath(p ? p.split('/') : [])}
              />
            </div>
          )}
          <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
            拖拽文件到左侧对话框 · 右键在访达中打开
          </p>
        </div>

        {/* Section resize handle: files ↔ skills */}
        <div
          className="h-1.5 hover:h-2 cursor-row-resize hover:bg-green-500/30 transition-all shrink-0 relative group"
          onMouseDown={startResizeSection('files')}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>

        {/* Department Skills */}
        <div className="p-4 border-b border-gray-800 shrink-0" style={{ height: sectionHeights.skills > 0 ? sectionHeights.skills : 'auto', minHeight: 60, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="shrink-0 mb-3">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            部门技能
            <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{deptSkills.length}</span>
          </h3>
          </div>
          {deptSkills.length === 0 ? (
            <div className="flex-1"><p className="text-xs text-gray-500">暂无部门技能</p></div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
              {[...deptSkills].sort((a, b) => (skillUsageCounts[b.id] || 0) - (skillUsageCounts[a.id] || 0)).slice(0, 15).map((s) => {
                const isActive = activeSkillIds.has(s.id)
                const usage = skillUsageCounts[s.id] || 0
                return (
                  <button key={s.id}
                    onClick={() => toggleSkill(s.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const homeDir = '/Users/jiayiren'
                      const deptId = (s as any).department_id || 'default'
                      // Sanitize skill_name same as backend: [^\w\-] → '_'
                      const safeName = s.skill_name.replace(/[^\w\-]/g, '_')
                      const path = `${homeDir}/.hermes/skills/${deptId}/${safeName}`
                      handleContextMenu(e, path)
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 border transition-all duration-300 ${
                      isActive
                        ? 'bg-blue-950/30 border-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                        : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                    }`}>
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-medium ${isActive ? 'text-blue-300' : 'text-gray-400'}`}>
                        {isActive && <Zap className="w-3 h-3 inline mr-1 text-blue-400" />}
                        {s.skill_name}
                      </p>
                      {usage > 0 && (
                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">×{usage}</span>
                      )}
                    </div>
                    {s.category && <p className="text-[10px] text-gray-600 mt-0.5">{s.category}</p>}
                  </button>
                )
              })}
            </div>
          )}
          </div>

        {/* Section resize handle: skills ↔ artifacts */}
        <div
          className="h-1.5 hover:h-2 cursor-row-resize hover:bg-amber-500/30 transition-all shrink-0 relative group"
          onMouseDown={startResizeSection('skills')}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>

        {/* Artifacts — 项目产出物 */}
        <div className="p-4 flex-1 flex flex-col min-h-0" style={{ overflow: 'hidden' }}>
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            项目产出物
            {artifacts.filter((a: any) => a.artifact_path).length > 0 && <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">{artifacts.filter((a: any) => a.artifact_path).length}</span>}
          </h3>
          {artifacts.filter((a: any) => a.artifact_path).length === 0 ? (
            <div className="flex-1"><p className="text-xs text-gray-600">暂无产出文件，对话后将自动检测生成的文件</p></div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {artifacts.filter((a: any) => a.artifact_path).map((a) => (
                <div key={a.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', a.artifact_path || a.title)
                    e.dataTransfer.effectAllowed = 'copy'
                    // Build full path from artifact_path (relative to sandbox)
                    const fullPath = `/Users/jiayiren/Desktop/Hermes_Agent/enterprise-ai-platform/backend/storage/projects/project_${projectId}/${a.artifact_path}`
                    window.dispatchEvent(new CustomEvent('sidebar-drop', {
                      detail: { name: a.title, path: a.artifact_path, stored_path: fullPath, ext: '.' + (a.file_type || 'file'), size: 0 }
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
                      window.open(`http://${window.location.hostname}:8000/api/artifacts/file/${projectId}/${encodeURIComponent(a.artifact_path)}`, '_blank')
                    }
                  }}>
                    <p className="text-xs font-medium text-gray-300 truncate group-hover:text-amber-300 transition-colors">{a.title}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5">{a.artifact_path || a.file_type}</p>
                  </div>
                  <button onClick={(e) => {
                    e.stopPropagation()
                    if (a.artifact_path) {
                      window.open(`http://${window.location.hostname}:8000/api/artifacts/file/${projectId}/${encodeURIComponent(a.artifact_path)}`, '_blank')
                    }
                  }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-700 transition-all shrink-0">
                    <ExternalLink className="w-3 h-3 text-gray-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {globalDragOver && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          onDragOver={handleGlobalDragOver}
          onDragLeave={handleGlobalDragLeave}
          onDrop={handleGlobalDrop}
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
                const alreadyAdded = projectSkills.find(ps => ps.id === s.id || ps.skill_name === s.skill_name)
                return (
                  <button key={i}
                    onClick={() => addSkillToProject(s)}
                    disabled={!!alreadyAdded}
                    className="w-full text-left px-4 py-3 hover:bg-gray-700/50 transition-colors border-b border-gray-700/50 last:border-b-0 disabled:opacity-40 disabled:cursor-not-allowed">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-200 font-medium">{s.skill_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        s.source === 'hermes' ? 'bg-indigo-500/20 text-indigo-400' :
                        s.source === 'import_zip' ? 'bg-emerald-500/20 text-emerald-400' :
                        s.source === 'distillation' ? 'bg-purple-500/20 text-purple-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {s.source === 'hermes' ? '原生' : s.source === 'import_zip' ? '导入' : s.source === 'distillation' ? '蒸馏' : '部门'}
                      </span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                    )}
                    {alreadyAdded && <p className="text-[10px] text-green-400 mt-1">✓ 已添加</p>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 右键菜单 ── */}
      {contextMenu && (
        <div
          className="fixed z-[60] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleRevealInFinder(contextMenu.path)}
            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
            <Folder className="w-3.5 h-3.5 text-blue-400" />
            在访达中打开位置
          </button>
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
    </div>
  )
}
