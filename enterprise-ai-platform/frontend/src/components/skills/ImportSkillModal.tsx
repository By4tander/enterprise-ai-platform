import { useState, useRef, useEffect } from 'react'
import { Upload, FileText, X, Loader2, Check, Code, FileJson, Package, Building2 } from 'lucide-react'

interface ImportSkillModalProps {
  show: boolean
  departmentId: string
  onClose: () => void
  onImported: () => void
}

interface Department {
  id: string
  name: string
}

export default function ImportSkillModal({
  show, departmentId, onClose, onImported
}: ImportSkillModalProps) {
  const [mode, setMode] = useState<'paste' | 'file' | 'zip'>('paste')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedDeptId, setSelectedDeptId] = useState(departmentId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // Fetch departments if none provided
  useEffect(() => {
    if (!departmentId) {
      const token = localStorage.getItem('access_token')
      fetch(`http://${window.location.hostname}:8000/api/departments/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setDepartments(data)
            if (data.length > 0) setSelectedDeptId(data[0].id)
          }
        })
        .catch(() => {})
    }
  }, [departmentId])

  const effectiveDeptId = departmentId || selectedDeptId

  if (!show) return null

  const handleTextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    setText(content)
    tryPreview(content)
    e.target.value = ''
  }

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.name.endsWith('.zip')) {
      setError('请上传 .zip 文件')
      return
    }
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('access_token')
      const formData = new FormData()
      formData.append('file', file)
      formData.append('department_id', effectiveDeptId)

      const res = await fetch(`http://${window.location.hostname}:8000/api/skills/import/zip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '导入失败' }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      onImported()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
    e.target.value = ''
  }

  const tryPreview = (content: string) => {
    try {
      const parsed = JSON.parse(content)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      setPreview(items.slice(0, 5).map((item: any) => ({
        skill_name: item.skill_name || item.name || '?',
        content_preview: (item.content_prompt || item.prompt || item.content || '').slice(0, 100),
        category: item.category || '',
      })))
    } catch {
      const lines = content.split('\n')
      const sections: any[] = []
      let cur: any = null
      for (const line of lines) {
        if (line.startsWith('# ')) {
          if (cur) sections.push(cur)
          cur = { skill_name: line.slice(2).trim(), content_preview: '' }
        } else if (cur && line.trim()) {
          cur.content_preview = (cur.content_preview + ' ' + line.trim()).slice(0, 100)
        }
      }
      if (cur) sections.push(cur)
      setPreview(sections.slice(0, 5))
    }
  }

  const handleImport = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`http://${window.location.hostname}:8000/api/skills/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ department_id: effectiveDeptId, content: text }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '导入失败' }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      onImported()
      setText('')
      setPreview([])
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl animate-fade-in max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            导入 Skill
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-gray-700 shrink-0">
          <button onClick={() => setMode('paste')} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${mode === 'paste' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-400/5' : 'text-gray-500 hover:text-gray-300'}`}>
            <Code className="w-3.5 h-3.5 inline mr-1" />粘贴内容
          </button>
          <button onClick={() => setMode('file')} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${mode === 'file' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-400/5' : 'text-gray-500 hover:text-gray-300'}`}>
            <FileJson className="w-3.5 h-3.5 inline mr-1" />上传文件
          </button>
          <button onClick={() => setMode('zip')} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${mode === 'zip' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-400/5' : 'text-gray-500 hover:text-gray-300'}`}>
            <Package className="w-3.5 h-3.5 inline mr-1" />ZIP技能包
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Department Selector (only show if no departmentId prop) */}
          {!departmentId && departments.length > 0 && (
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-500 shrink-0" />
              <select
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
          )}

          {mode === 'paste' && (
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); tryPreview(e.target.value) }}
              placeholder={`粘贴 JSON / YAML / Markdown 内容...\n\nJSON 示例:\n[{"skill_name": "我的技能", "content_prompt": "技能详细 Prompt...", "category": "分类"}]`}
              rows={10}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
            />
          )}

          {mode === 'file' && (
            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors">
              <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-400">点击上传 Skill 文件</p>
              <p className="text-xs text-gray-600 mt-1">支持 .json / .yaml / .yml / .md</p>
              <input ref={fileInputRef} type="file" accept=".json,.yaml,.yml,.md" onChange={handleTextFile} className="hidden" />
            </div>
          )}

          {mode === 'zip' && (
            <div onClick={() => zipInputRef.current?.click()} className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors">
              <Package className="w-10 h-10 text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-400 font-medium">上传 ZIP 技能包</p>
              <p className="text-xs text-gray-600 mt-2">
                自动识别并导入所有技能文件
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">WorkBuddy</span>
                <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">Claude Code</span>
                <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full">OpenAI Codex</span>
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full">OpenClaw</span>
                <span className="text-[10px] px-2 py-0.5 bg-gray-500/10 text-gray-400 rounded-full">Generic</span>
              </div>
              <input ref={zipInputRef} type="file" accept=".zip" onChange={handleZipUpload} className="hidden" />
            </div>
          )}

          {/* Preview (for paste/file mode) */}
          {preview.length > 0 && mode !== 'zip' && (
            <div>
              <p className="text-xs text-gray-500 mb-2 font-medium">解析预览 ({preview.length} 个技能)</p>
              <div className="space-y-1.5">
                {preview.map((item, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-300">{item.skill_name}</p>
                      <p className="text-[10px] text-gray-600 truncate">{item.content_preview}</p>
                    </div>
                    {item.category && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded shrink-0 ml-auto">{item.category}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {mode !== 'zip' && (
          <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-700 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">取消</button>
            <button onClick={handleImport} disabled={!text.trim() || loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? '导入中...' : `确认导入 (${preview.length})`}
            </button>
          </div>
        )}
        {mode === 'zip' && (
          <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-700 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">取消</button>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                ZIP 解压解析中...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
