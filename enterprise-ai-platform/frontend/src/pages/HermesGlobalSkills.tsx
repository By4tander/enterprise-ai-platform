import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Zap, Shield, Code, Search, Brain, Settings, ChevronRight, Loader2,
  Upload, X, Check, Apple, Github, Palette, Database, Mail, BookOpen,
  Cpu, Globe, Home, Film, BarChart3, Terminal, FileText, FolderOpen
} from 'lucide-react'
import { api } from '../services/api'

interface GlobalSkill {
  id: string
  skill_name: string
  description: string | null
  content_prompt: string
  category: string | null
  scope: string
  import_source: string | null
  usage_count: number
  auto_inject: boolean
  is_approved: boolean
  file_path?: string
}

const CATEGORY_META: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  'apple':                { icon: Apple,     color: 'text-gray-300 bg-gray-500/10 border-gray-500/20',  label: 'Apple 生态' },
  'autonomous-ai-agents': { icon: Cpu,       color: 'text-violet-400 bg-violet-500/10 border-violet-500/20', label: 'AI Agent' },
  'creative':             { icon: Palette,   color: 'text-pink-400 bg-pink-500/10 border-pink-500/20',  label: '创意设计' },
  'data-science':         { icon: Database,  color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',  label: '数据科学' },
  'email':                { icon: Mail,      color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',  label: '邮件' },
  'evaluation':           { icon: BarChart3, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: '评估' },
  'github':               { icon: Github,    color: 'text-gray-300 bg-gray-500/10 border-gray-500/20',  label: 'GitHub' },
  'inference':            { icon: Terminal,  color: 'text-green-400 bg-green-500/10 border-green-500/20', label: '推理引擎' },
  'media':                { icon: Film,      color: 'text-red-400 bg-red-500/10 border-red-500/20',    label: '媒体' },
  'mlops':                { icon: Settings,  color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', label: 'MLOps' },
  'models':               { icon: Brain,     color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', label: '模型' },
  'note-taking':          { icon: BookOpen,  color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', label: '笔记' },
  'productivity':         { icon: FileText,  color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: '生产力' },
  'research':             { icon: Search,    color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',    label: '研究' },
  'skills':               { icon: Zap,       color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: '核心技能' },
  'smart-home':           { icon: Home,      color: 'text-teal-400 bg-teal-500/10 border-teal-500/20',  label: '智能家居' },
  'social-media':         { icon: Globe,     color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',  label: '社交媒体' },
  'software-development': { icon: Code,      color: 'text-blue-300 bg-blue-500/10 border-blue-500/20',  label: '软件开发' },
  '用户上传':              { icon: Upload,    color: 'text-green-400 bg-green-500/10 border-green-500/20', label: '用户上传' },
}

export default function HermesGlobalSkills() {
  const [skills, setSkills] = useState<GlobalSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [detailSkill, setDetailSkill] = useState<GlobalSkill | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; skill: GlobalSkill } | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [topTab, setTopTab] = useState<'all' | 'native' | 'custom'>('all')
  const [subFilter, setSubFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => { loadSkills() }, [])

  const loadSkills = async () => {
    try {
      setLoading(true)
      const data = await api.getGlobalSkills()
      setSkills(data)
    } catch (e) {
      console.error('Failed to load global skills:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('access_token') || ''
      const res = await fetch('/api/skills/global/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        setUploadResult({ type: 'error', message: err.detail || '上传失败' })
      } else {
        const data = await res.json()
        setUploadResult({ type: 'success', message: `「${data.skill_name || file.name}」上传成功！` })
        await loadSkills()
        setTimeout(() => { setShowUpload(false); setUploadResult(null) }, 1500)
      }
    } catch (err) {
      setUploadResult({ type: 'error', message: '上传失败: ' + err })
    } finally {
      setUploading(false)
    }
  }

  // Search filter (applied to all)
  const searchFiltered = skills.filter(s => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return s.skill_name.toLowerCase().includes(q) ||
           (s.description || '').toLowerCase().includes(q) ||
           (s.category || '').toLowerCase().includes(q)
  })

  // Top-level tab split (from full list, not search-filtered — categories always visible)
  const allNative = skills.filter(s => s.import_source === 'hermes_native')
  const allCustom = skills.filter(s => s.import_source !== 'hermes_native')

  // Native sub-categories (from full native list)
  const nativeCategories = [...new Set(allNative.map(s => s.category).filter(Boolean))] as string[]

  // Apply top tab + sub filter + search
  const filtered = searchFiltered.filter(s => {
    if (topTab === 'native' && s.import_source !== 'hermes_native') return false
    if (topTab === 'custom' && s.import_source === 'hermes_native') return false
    if (subFilter !== 'all' && s.category !== subFilter) return false
    return true
  })

  const nativeFiltered = filtered.filter(s => s.import_source === 'hermes_native')
  const customFiltered = filtered.filter(s => s.import_source !== 'hermes_native')

  const nativeGrouped = nativeFiltered.reduce((acc, skill) => {
    const cat = skill.category || '其他'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(skill)
    return acc
  }, {} as Record<string, GlobalSkill[]>)

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Header */}
      <div className="shrink-0 px-8 py-6 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Hermes 全局技能</h1>
              <p className="text-sm text-gray-400">原生内置 · 全公司共享 · Agent 自主调用</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="搜索技能..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-gray-500 w-56"
              />
            </div>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              上传技能
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3 max-w-3xl leading-relaxed">
          全局技能包含 Hermes 原生内置的 {allNative.length} 个技能和用户上传的 {allCustom.length} 个技能。
          原生技能来自 Hermes 开源社区，覆盖 AI Agent、创意设计、软件开发、数据科学、生产力工具等领域。
          Agent 在对话过程中会根据任务需求自主调用这些技能。
        </p>
      </div>

      {/* Top-level tabs + Sub-category filter */}
      <div className="shrink-0 px-8 py-3 border-b border-gray-800 space-y-2">
        {/* Top tabs */}
        <div className="flex items-center gap-2">
          {[
            { key: 'all' as const, label: '全部', count: skills.length },
            { key: 'native' as const, label: '系统内置', count: allNative.length },
            { key: 'custom' as const, label: '自定义', count: allCustom.length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setTopTab(tab.key); setSubFilter('all') }}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                topTab === tab.key
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-[10px] opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>
        {/* Sub-category filter (only when on native tab or all) */}
        {topTab !== 'custom' && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setSubFilter('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                subFilter === 'all'
                  ? 'bg-gray-700 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              全部分类
            </button>
            {nativeCategories.map(cat => {
              const meta = CATEGORY_META[cat]
              const count = allNative.filter(s => s.category === cat).length
              return (
                <button
                  key={cat}
                  onClick={() => setSubFilter(cat)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                    subFilter === cat
                      ? 'bg-gray-700 text-gray-200'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  {meta?.label || cat}
                  <span className="ml-1 opacity-50">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Brain className="w-12 h-12 mb-3 text-gray-600" />
            <p className="text-sm">暂无全局技能</p>
            <p className="text-xs mt-1">请确认 Hermes 已安装并配置</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* User uploaded skills */}
            {customFiltered.length > 0 && (topTab === 'all' || topTab === 'custom') && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center text-green-400 bg-green-500/10 border border-green-500/20">
                    <Upload className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-sm font-semibold text-gray-300">自定义技能</h2>
                  <span className="text-[10px] text-gray-600">{customFiltered.length} 个技能</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
                    用户上传
                  </span>
                </div>
                <div className="grid gap-3">
                  {customFiltered.map(skill => (
                    <SkillCard key={skill.id} skill={skill} onDetail={setDetailSkill} onContextMenu={(s, x, y) => setContextMenu({ x, y, skill: s })} />
                  ))}
                </div>
              </div>
            )}

            {/* Native skills grouped by category */}
            {Object.entries(nativeGrouped).map(([category, categorySkills]) => {
              const meta = CATEGORY_META[category] || { icon: Settings, color: 'text-gray-400 bg-gray-500/10 border-gray-500/20', label: category }
              const Icon = meta.icon
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${meta.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <h2 className="text-sm font-semibold text-gray-300">{meta.label}</h2>
                    <span className="text-[10px] text-gray-600">{categorySkills.length} 个技能</span>
                    <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
                      原生
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {categorySkills.map(skill => (
                      <SkillCard key={skill.id} skill={skill} onDetail={setDetailSkill} onContextMenu={(s, x, y) => setContextMenu({ x, y, skill: s })} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowUpload(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">上传全局技能</h3>
              <button onClick={() => setShowUpload(false)} className="text-gray-500 hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              上传技能包或单个技能文件，支持 WorkBuddy / Claude Code / Codex / OpenClaw 等格式。
            </p>
            <label
              className={`block w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                uploadDragOver
                  ? 'border-amber-400 bg-amber-500/10 scale-[1.02]'
                  : 'border-gray-600 hover:border-amber-500/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDragOver(true) }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDragOver(false) }}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation(); setUploadDragOver(false)
                const file = e.dataTransfer.files?.[0]
                if (file) {
                  const formData = new FormData()
                  formData.append('file', file)
                  setUploading(true)
                  setUploadResult(null)
                  const token = localStorage.getItem('access_token') || ''
                  fetch('/api/skills/global/upload', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                  }).then(res => {
                    if (!res.ok) return res.json().then(err => { throw new Error(err.detail || '上传失败') })
                    return res.json()
                  }).then((data) => {
                    setUploadResult({ type: 'success', message: `「${data.skill_name || file.name}」上传成功！` })
                    loadSkills()
                    setTimeout(() => { setShowUpload(false); setUploadResult(null) }, 1500)
                  }).catch(err => {
                    setUploadResult({ type: 'error', message: err.message || '上传失败' })
                  }).finally(() => setUploading(false))
                }
              }}
            >
              <input type="file" accept=".md,.json,.yaml,.yml,.zip" onChange={handleUpload} className="hidden" />
              {uploading ? (
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
              ) : uploadResult ? (
                <div className="flex flex-col items-center">
                  {uploadResult.type === 'success' ? (
                    <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  ) : (
                    <X className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  )}
                  <p className={`text-sm font-medium ${uploadResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {uploadResult.message}
                  </p>
                </div>
              ) : uploadDragOver ? (
                <>
                  <Upload className="w-8 h-8 text-amber-400 mx-auto mb-2 animate-bounce" />
                  <p className="text-sm text-amber-300 font-medium">松开即可上传</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">点击选择文件或拖拽到此处</p>
                  <p className="text-[10px] text-gray-600 mt-1">支持 .zip / .md / .json / .yaml</p>
                </>
              )}
            </label>
          </div>
        </div>
      )}

      {/* Skill Detail Modal */}
      {detailSkill && <SkillDetailModal skill={detailSkill} onClose={() => setDetailSkill(null)} />}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          skill={contextMenu.skill}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

function getSkillPath(skill: GlobalSkill): string {
  if (skill.file_path) return skill.file_path.replace('/SKILL.md', '')
  if (skill.id.startsWith('native:')) {
    const parts = skill.id.replace('native:', '').split('/')
    return `/Users/jiayiren/.hermes/skills/${parts[0]}/${parts[1]}`
  }
  return ''
}

function SkillCard({ skill, onDetail, onContextMenu }: {
  skill: GlobalSkill
  onDetail: (s: GlobalSkill) => void
  onContextMenu: (s: GlobalSkill, x: number, y: number) => void
}) {
  const isNative = skill.import_source === 'hermes_native'
  const meta = CATEGORY_META[skill.category || ''] || { icon: Settings, color: 'text-gray-400 bg-gray-500/10 border-gray-500/20' }
  const Icon = meta.icon

  return (
    <div
      className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-all cursor-pointer"
      onClick={() => onDetail(skill)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(skill, e.clientX, e.clientY) }}
    >
      <div className="px-5 py-4 flex items-center gap-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">{skill.skill_name}</span>
            {isNative && (
              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">原生</span>
            )}
            {!isNative && (
              <span className="text-[9px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">自定义</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{skill.description || '暂无描述'}</p>
        </div>
        <span className="text-[10px] text-gray-600 shrink-0">{skill.category}</span>
      </div>
    </div>
  )
}

function SkillDetailModal({ skill, onClose }: { skill: GlobalSkill; onClose: () => void }) {
  const isNative = skill.import_source === 'hermes_native'
  const meta = CATEGORY_META[skill.category || ''] || { icon: Settings, color: 'text-gray-400 bg-gray-500/10 border-gray-500/20' }
  const Icon = meta.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-gray-700 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white">{skill.skill_name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              {isNative && <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full">Hermes 原生</span>}
              {!isNative && <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full">自定义</span>}
              {skill.category && <span className="text-[10px] text-gray-500">{skill.category}</span>}
              {skill.auto_inject && <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">自动注入</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Description */}
        {skill.description && (
          <div className="shrink-0 px-6 py-3 border-b border-gray-700/50 bg-gray-800/50">
            <p className="text-sm text-gray-300 leading-relaxed">{skill.description}</p>
          </div>
        )}
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 prose prose-invert prose-sm max-w-none
          prose-headings:text-gray-200 prose-p:text-gray-400 prose-strong:text-amber-300
          prose-code:text-pink-400 prose-code:bg-gray-900/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-gray-900/50 prose-pre:border prose-pre:border-gray-700/50
          prose-a:text-blue-400 prose-li:text-gray-400 prose-td:text-gray-400 prose-th:text-gray-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {skill.content_prompt}
          </ReactMarkdown>
        </div>
        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t border-gray-700 text-[10px] text-gray-500">
          <span>来源: {isNative ? 'Hermes 开源社区' : skill.import_source || '手动导入'}</span>
        </div>
      </div>
    </div>
  )
}

function ContextMenu({ x, y, skill, onClose }: { x: number; y: number; skill: GlobalSkill; onClose: () => void }) {
  const handleReveal = () => {
    const path = getSkillPath(skill)
    if (path) {
      const token = localStorage.getItem('access_token') || ''
      fetch('/api/files/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path }),
      }).catch(() => {})
    }
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        className="fixed z-[61] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
        style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 60) }}
      >
        <button
          onClick={handleReveal}
          className="w-full px-4 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
          打开文件夹位置
        </button>
      </div>
    </>
  )
}
