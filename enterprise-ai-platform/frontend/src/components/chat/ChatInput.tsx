import { useRef, useState, useCallback, useEffect } from 'react'
import { Send, Paperclip, X, FileText, Image, File, Square, ChevronUp } from 'lucide-react'

interface UploadedFile {
  file_id: string
  filename: string
  size: number
  relative_path: string
  stored_path?: string
  content_type: string
}

interface ChatInputProps {
  value: string
  onChange: (v: string) => void
  onSend: (text: string, files: UploadedFile[]) => void
  onStop?: () => void
  isStreaming?: boolean
  placeholder?: string
  projectId: string
  bottomPanelHeight?: number
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <Image className="w-4 h-4" />
  if (type.includes('pdf')) return <FileText className="w-4 h-4" />
  return <File className="w-4 h-4" />
}

function formatSize(bytes: number) {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

const MIN_ROWS = 1
const MAX_ROWS = 8
const LINE_HEIGHT_PX = 20 // text-sm leading-relaxed ≈ 20px

export default function ChatInput({
  value, onChange, onSend, onStop, isStreaming, placeholder, projectId, bottomPanelHeight
}: ChatInputProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [rows, setRows] = useState(MIN_ROWS)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── 监听全局拖放事件（从 ProjectView 发出） ──
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as File[]
      if (files) {
        for (const file of files) uploadFile(file)
      }
    }
    window.addEventListener('global-drop', handler)
    return () => window.removeEventListener('global-drop', handler)
  }, [projectId])
  useEffect(() => {
    const lineCount = (value.match(/\n/g) || []).length + 1
    setRows(Math.min(Math.max(lineCount, MIN_ROWS), MAX_ROWS))
  }, [value])

  // ── 监听侧边栏拖放（沙盒内文件直接引用） ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any
      if (detail && detail.name) {
        const fakeId = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setFiles((prev) => [...prev, {
          file_id: fakeId, filename: detail.name,
          relative_path: detail.path || '', stored_path: detail.stored_path || '',
          size: detail.size || 0, content_type: '',
        }])
      }
    }
    window.addEventListener('sidebar-drop', handler)
    return () => window.removeEventListener('sidebar-drop', handler)
  }, [])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('project_id', projectId)

      const token = localStorage.getItem('access_token')
      const res = await fetch(`http://${window.location.hostname}:8000/api/files/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '上传失败' }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setFiles((prev) => [...prev, data])
    } catch (e: any) {
      alert(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (selected) {
      for (let i = 0; i < selected.length; i++) {
        uploadFile(selected[i])
      }
    }
    e.target.value = ''
  }

  // ── 监听全局拖放事件（从页面级 handler 发出） ──
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as File[]
      if (files) {
        for (const file of files) uploadFile(file)
      }
    }
    window.addEventListener('global-drop', handler)
    return () => window.removeEventListener('global-drop', handler)
  }, [projectId])

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.file_id !== id))
  }

  const handleSend = () => {
    if (!value.trim() && files.length === 0) return
    onSend(value.trim(), files)
    setFiles([])
  }

  // ── Keyboard: Enter = newline, Cmd/Ctrl+Enter = send or queue ──
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        // Cmd+Enter (Mac) / Ctrl+Enter (Win) → send (idle) or queue (streaming)
        e.preventDefault()
        if (value.trim() || files.length > 0) {
          onSend(value.trim(), files)
          setFiles([])
        }
      }
      // Plain Enter → insert newline (default behavior, don't prevent)
      return
    }
  }

  // Determine button state
  const hasContent = value.trim().length > 0 || files.length > 0

  return (
    <>
      {/* ── Chat Input Container ── */}
      <div className="relative">
        {/* File preview cards */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {files.map((f) => (
              <div
                key={f.file_id}
                className="flex items-center gap-2 bg-gray-700/80 border border-gray-600 rounded-lg px-2.5 py-1.5 text-xs group"
              >
                {getFileIcon(f.content_type)}
                <div className="flex flex-col min-w-0">
                  <span className="text-gray-300 truncate max-w-[120px]">{f.filename}</span>
                  <span className="text-gray-500">{formatSize(f.size) || (f.stored_path ? '沙盒引用' : '')}</span>
                </div>
                <button
                  onClick={() => removeFile(f.file_id)}
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex items-center gap-1.5 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-1.5 text-xs">
                <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-400">上传中...</span>
              </div>
            )}
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-3 items-end">
          {/* File select button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-10 h-10 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-xl flex items-center justify-center transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            multiple
            accept=".txt,.md,.py,.js,.ts,.tsx,.jsx,.json,.yaml,.yml,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.odt,.ods,.odp,.csv,.png,.jpg,.jpeg,.gif,.svg,.webp,.bmp,.tiff,.heic,.html,.css,.scss,.less,.xml,.zip,.gz,.tar,.7z,.rar,.mp3,.wav,.mp4,.mov,.avi,.mkv"
          />

          {/* Auto-expanding textarea — ALWAYS enabled, even during streaming */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Agent 执行中，可继续输入排队...' : (placeholder || '输入您的问题... (Enter 换行, Cmd+Enter 发送)')}
            rows={Math.max(rows, bottomPanelHeight ? Math.floor(bottomPanelHeight / 24) : MIN_ROWS)}
            style={{
              minHeight: `${LINE_HEIGHT_PX * MIN_ROWS}px`,
              maxHeight: bottomPanelHeight ? `${bottomPanelHeight - 60}px` : `${LINE_HEIGHT_PX * MAX_ROWS}px`
            }}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-gray-600 resize-none overflow-y-auto"
          />

          {/* Send / Stop / Queue button — dynamic */}
          {isStreaming ? (
            <>
              {/* Queue button — adds to task queue (only when there's content) */}
              {hasContent && (
                <button
                  onClick={handleSend}
                  title="加入队列 (Cmd+Enter)"
                  className="shrink-0 h-10 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-amber-500/20"
                >
                  <ChevronUp className="w-4 h-4" />
                  <span className="text-xs font-medium">排队</span>
                </button>
              )}
              {/* Stop button — terminates current execution */}
              <button
                onClick={onStop}
                title="终止当前执行"
                className="shrink-0 w-10 h-10 bg-red-600 hover:bg-red-500 text-white rounded-xl flex items-center justify-center transition-all animate-pulse shadow-lg shadow-red-500/30"
              >
                <Square className="w-4 h-4" fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              onClick={handleSend}
              disabled={!hasContent}
              title={hasContent ? '发送 (Cmd+Enter)' : '输入内容后发送'}
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                hasContent
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
