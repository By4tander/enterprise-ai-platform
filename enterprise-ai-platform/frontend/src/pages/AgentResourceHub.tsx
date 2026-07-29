/**
 * Agent 资源库 — 四标签页设计
 *
 * 1. 部门技能 — 原 SkillsHub 内容
 * 2. 完结工作流 — 归档项目卡片，支持恢复/永久删除
 * 3. 帧图库 — 项目帧图配置与浏览
 * 4. 角色库 — 项目角色配置与浏览
 */
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../services/api'
import { useAppStore, useAuthStore } from '../store'
import { hasPermission } from '../utils/permissions'
import {
  BookOpen, Star, Check, X, ExternalLink, AlertCircle, Upload, Info,
  FolderOpen, Loader2, ChevronDown, ChevronRight, Archive, RotateCcw,
  Trash2, Image, Users, Settings, Search, Calendar, FileText, RefreshCw,
} from 'lucide-react'
import ImportSkillModal from '../components/skills/ImportSkillModal'

// ── Tab 定义 ──
type TabKey = 'skills' | 'archived' | 'frames' | 'characters'
const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: 'skills',     label: '部门技能',   icon: BookOpen },
  { key: 'archived',   label: '完结工作流', icon: Archive },
  { key: 'frames',     label: '帧图库',     icon: Image },
  { key: 'characters', label: '角色库',     icon: Users },
]

// ═══════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════

export default function AgentResourceHub() {
  const [activeTab, setActiveTab] = useState<TabKey>('skills')

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-0">
        <h1 className="text-2xl font-bold text-white mb-1">Agent 资源库</h1>
        <p className="text-sm text-gray-500 mb-5">管理技能、完结工作流、帧图与角色资源</p>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-800">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'archived' && <ArchivedTab />}
        {activeTab === 'frames' && <MediaTab type="frames" />}
        {activeTab === 'characters' && <MediaTab type="characters" />}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════
//  Tab 1: 部门技能（原 SkillsHub）
// ═══════════════════════════════════════════════════

interface Skill {
  id: string; skill_name: string; content_prompt: string; description: string | null
  category: string | null; department_id: string | null; is_approved: boolean
  usage_count: number; rating: number; auto_inject: boolean
  derived_from_project_name: string | null; created_at: string
  created_by_username: string | null; import_source: string | null
  original_source_url: string | null; metadata_json: string | null
}
interface SkillGroup { key: string; name: string; mainSkill: Skill; subSkills: Skill[]; totalUsage: number; importSource: string | null }

function groupSkills(skills: Skill[]): SkillGroup[] {
  const groups = new Map<string, Skill[]>()
  const ungrouped: SkillGroup[] = []
  for (const skill of skills) {
    let groupKey = skill.id
    if (skill.import_source === 'import_zip' && skill.metadata_json) {
      try { const meta = JSON.parse(skill.metadata_json); if (meta.original_filename) groupKey = meta.original_filename } catch {}
    }
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey)!.push(skill)
  }
  for (const [key, gs] of groups) {
    if (gs.length === 1) {
      ungrouped.push({ key, name: gs[0].skill_name, mainSkill: gs[0], subSkills: [], totalUsage: gs[0].usage_count, importSource: gs[0].import_source })
    } else {
      let mainSkill = gs.find(s => { try { return JSON.parse(s.metadata_json || '{}').skill_format === 'yaml_frontmatter' } catch { return false } }) || gs[0]
      ungrouped.push({ key, name: key.replace('.zip', ''), mainSkill, subSkills: gs.filter(s => s.id !== mainSkill.id), totalUsage: gs.reduce((s, g) => s + g.usage_count, 0), importSource: mainSkill.import_source })
    }
  }
  return ungrouped
}

function SkillsTab() {
  const { currentDepartmentId } = useAppStore()
  const user = useAuthStore((s) => s.user)
  const canImport = hasPermission(user?.role, 'skill.import')
  const canToggleDefault = hasPermission(user?.role, 'skill.toggle_default')
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; skill: Skill } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [draggingSkill, setDraggingSkill] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')
  const [catContextMenu, setCatContextMenu] = useState<{ x: number; y: number; cat: string } | null>(null)
  const [categories, setCategories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`skill_categories_${currentDepartmentId}`) || '[]') } catch { return [] }
  })

  const loadSkills = async () => { setLoading(true); try { setSkills(await api.getSkills(currentDepartmentId || undefined)) } catch {} finally { setLoading(false) } }
  useEffect(() => { loadSkills() }, [currentDepartmentId])

  // Persist categories
  useEffect(() => { localStorage.setItem(`skill_categories_${currentDepartmentId}`, JSON.stringify(categories)) }, [categories, currentDepartmentId])

  // Extract unique categories from skills + custom categories
  const allCategories = useMemo(() => {
    const skillCats = new Set(skills.map(s => s.category).filter(Boolean) as string[])
    categories.forEach(c => skillCats.add(c))
    return [...skillCats].sort()
  }, [skills, categories])

  // Filter skills
  const filteredGroups = useMemo(() => {
    let groups = groupSkills(skills)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      groups = groups.filter(g => g.name.toLowerCase().includes(q) || g.mainSkill.description?.toLowerCase().includes(q))
    }
    if (selectedCategory) {
      groups = groups.filter(g => g.mainSkill.category === selectedCategory)
    }
    return groups
  }, [skills, searchQuery, selectedCategory, categories])

  const handleToggleApprove = async (skill: Skill) => { try { await api.updateSkill(skill.id, { is_approved: !skill.is_approved }); loadSkills() } catch (e: any) { alert(e.message) } }
  const handleToggleAutoInject = async (skill: Skill) => { try { await api.updateSkill(skill.id, { auto_inject: !skill.auto_inject }); loadSkills() } catch (e: any) { alert(e.message) } }
  const handleAssignCategory = async (skillId: string, category: string) => {
    try { await api.updateSkill(skillId, { category }); loadSkills() } catch (e: any) { alert(e.message) }
  }
  const handleDeleteCategory = (cat: string) => {
    // Remove from custom categories and clear all skills with this category
    setCategories(prev => prev.filter(c => c !== cat))
    skills.filter(s => s.category === cat).forEach(s => api.updateSkill(s.id, { category: '' }).catch(() => {}))
    if (selectedCategory === cat) setSelectedCategory(null)
    loadSkills()
    setCatContextMenu(null)
  }
  const handleRenameCategory = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName.trim()) { setEditingCategory(null); return }
    // Update custom categories list
    setCategories(prev => prev.map(c => c === oldName ? newName.trim() : c))
    // Update all skills with old category
    skills.filter(s => s.category === oldName).forEach(s => api.updateSkill(s.id, { category: newName.trim() }).catch(() => {}))
    if (selectedCategory === oldName) setSelectedCategory(newName.trim())
    setEditingCategory(null)
    loadSkills()
  }
  const getSkillPath = (skill: Skill) => `/Users/jiayiren/.hermes/skills/${skill.department_id || 'default'}/${skill.skill_name.replace(/[^\w\-]/g, '_')}`
  const handleReveal = (skill: Skill) => { api.revealInFinder(getSkillPath(skill)).catch((e: any) => alert(e.message)); setContextMenu(null) }
  const renderStars = (r: number) => Array.from({ length: 5 }, (_, i) => <Star key={i} className={`w-3 h-3 ${i < Math.round(r) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-600'}`} />)

  return (
    <>
      {showImport && <ImportSkillModal show={showImport} departmentId={currentDepartmentId || ''} onClose={() => setShowImport(false)} onImported={loadSkills} />}

      {/* Detail Modal */}
      {detailSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetailSkill(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 px-6 py-4 border-b border-gray-700 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><BookOpen className="w-5 h-5 text-blue-400" /></div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white">{detailSkill.skill_name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {detailSkill.category && <span className="text-[10px] text-gray-500">{detailSkill.category}</span>}
                  {detailSkill.auto_inject && <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">默认加载</span>}
                </div>
              </div>
              <button onClick={() => setDetailSkill(null)} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            {detailSkill.description && <div className="shrink-0 px-6 py-3 border-b border-gray-700/50 bg-gray-800/50"><p className="text-sm text-gray-300 leading-relaxed">{detailSkill.description}</p></div>}
            <div className="flex-1 overflow-y-auto px-6 py-4 markdown-body text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{detailSkill.content_prompt}</ReactMarkdown></div>
            <div className="shrink-0 px-6 py-3 border-t border-gray-700 flex items-center justify-between text-[10px] text-gray-500">
              <span>使用 {detailSkill.usage_count} 次 · {detailSkill.created_by_username || '系统'}</span>
              <button onClick={() => handleReveal(detailSkill)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"><FolderOpen className="w-3.5 h-3.5" />打开文件夹</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)} />
          <div className="fixed z-[61] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]" style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 60) }}>
            <button onClick={() => handleReveal(contextMenu.skill)} className="w-full px-4 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"><FolderOpen className="w-3.5 h-3.5 text-gray-400" />打开文件夹位置</button>
            <button onClick={() => { setDetailSkill(contextMenu.skill); setContextMenu(null) }} className="w-full px-4 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"><BookOpen className="w-3.5 h-3.5 text-gray-400" />查看详情</button>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Row 1: Description + Stats + Search + Import */}
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-400">从已结案工作流中提炼的公共技能、Prompt 模板和 SOP</p>
          {!loading && skills.length > 0 && (
            <span className="text-[11px] font-semibold text-gray-400 px-3 py-0.5 rounded-full border border-gray-700 bg-gray-800/50">共 {groupSkills(skills).length} 个技能</span>
          )}
          <div className="flex-1" />
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索技能..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          {canImport && (
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shrink-0"><Upload className="w-3.5 h-3.5" />导入 Skill</button>
          )}
        </div>
        {/* Row 2: Category tags */}
        <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setSelectedCategory(null)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${!selectedCategory ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800'}`}>
              全部
            </button>
            {allCategories.map(cat => (
              editingCategory === cat ? (
                <input key={cat} value={editCategoryName} onChange={e => setEditCategoryName(e.target.value)} autoFocus
                  onBlur={() => handleRenameCategory(cat, editCategoryName)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat, editCategoryName); if (e.key === 'Escape') setEditingCategory(null) }}
                  className="px-2 py-0.5 rounded-md text-[11px] bg-gray-800 border border-blue-500 text-gray-300 focus:outline-none w-20"
                />
              ) : (
                <button key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  onContextMenu={(e) => { e.preventDefault(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCategory(cat) }}
                  onDragLeave={() => setDragOverCategory(null)}
                  onDrop={(e) => { e.preventDefault(); const sid = e.dataTransfer.getData('text/plain'); if (sid) handleAssignCategory(sid, cat); setDragOverCategory(null) }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                    dragOverCategory === cat ? 'bg-green-500/20 text-green-300 border-green-500/40 scale-105' :
                    selectedCategory === cat ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                    'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800'
                  }`}>
                  {cat}
                </button>
              )
            ))}
            <button onClick={() => setShowNewCategory(true)}
              className="px-2 py-1 rounded-md text-[11px] text-gray-600 hover:text-gray-400 hover:bg-gray-800 border border-dashed border-gray-700 transition-all"
              title="新建分类标签">
              +
            </button>
        </div>
        {/* New category input */}
        {showNewCategory && (
          <div className="flex items-center gap-2">
            <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="分类名称" autoFocus
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              onKeyDown={e => { if (e.key === 'Enter' && newCategoryName.trim()) { setCategories(prev => [...prev, newCategoryName.trim()]); setNewCategoryName(''); setShowNewCategory(false) } }}
            />
            <button onClick={() => { if (newCategoryName.trim()) { setCategories(prev => [...prev, newCategoryName.trim()]); setNewCategoryName(''); setShowNewCategory(false) } }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">添加</button>
            <button onClick={() => setShowNewCategory(false)} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-400">取消</button>
          </div>
        )}
      </div>
      

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>
      ) : skills.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">暂无部门技能</p>
          <p className="text-xs text-gray-600 mt-1">当工作流结案归档后，系统将自动提炼技能存入此库</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.key)
            const hasSubSkills = group.subSkills.length > 0
            const skill = group.mainSkill
            return (
              <div key={group.key}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', skill.id); setDraggingSkill(skill.id) }}
                onDragEnd={() => setDraggingSkill(null)}
                className={`bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors cursor-grab active:cursor-grabbing ${draggingSkill === skill.id ? 'opacity-50' : ''}`}>
                <div className="cursor-pointer" onClick={() => setDetailSkill(skill)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, skill }) }}>
                  <div className="p-4 border-b border-gray-800">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {hasSubSkills && <button onClick={(e) => { e.stopPropagation(); setExpandedGroups(prev => { const next = new Set(prev); next.has(group.key) ? next.delete(group.key) : next.add(group.key); return next }) }} className="p-0.5 rounded hover:bg-gray-700 text-gray-400 transition-colors">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>}
                          <h3 className="text-sm font-semibold text-white truncate">{group.name}</h3>
                          {hasSubSkills && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded-full shrink-0">{group.subSkills.length} 子技能</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {skill.category && <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">{skill.category}</span>}
                          {skill.is_approved ? <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full flex items-center gap-1"><Check className="w-3 h-3" /> 已审核</span> : <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> 待审核</span>}
                          {skill.auto_inject && <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">默认加载</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setDetailSkill(skill) }} className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400 transition-colors" title="查看详情"><Info className="w-3.5 h-3.5" /></button>
                        {renderStars(skill.rating)}
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-3 max-h-24 overflow-y-auto"><p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-3">{skill.content_prompt}</p></div>
                  <div className="px-4 py-2.5 border-t border-gray-800 flex items-center justify-between bg-gray-900/50">
                    <div className="flex items-center gap-3 text-[10px] text-gray-600">
                      <span>使用 {group.totalUsage} 次</span>
                      {skill.derived_from_project_name && <span className="flex items-center gap-1"><ExternalLink className="w-3 h-3" />来自: {skill.derived_from_project_name}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={(e) => { e.stopPropagation(); handleToggleApprove(skill) }} className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${skill.is_approved ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'}`}>{skill.is_approved ? '取消审核' : '审核通过'}</button>
                      {canToggleDefault ? <button onClick={(e) => { e.stopPropagation(); handleToggleAutoInject(skill) }} className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${skill.auto_inject ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>{skill.auto_inject ? '取消默认加载' : '默认加载'}</button> : skill.auto_inject && <span className="text-[10px] px-2 py-1 rounded-lg bg-purple-500/10 text-purple-400 cursor-default">默认加载</span>}
                    </div>
                  </div>
                </div>
                {hasSubSkills && isExpanded && (
                  <div className="border-t border-gray-800 bg-gray-800/30 p-4">
                    <p className="text-[10px] text-gray-500 mb-2">子技能 ({group.subSkills.length})</p>
                    <div className="space-y-1.5">
                      {group.subSkills.map((sub) => (
                        <div key={sub.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors" onClick={() => setDetailSkill(sub)}>
                          <div className="flex-1 min-w-0"><p className="text-xs font-medium text-gray-300 truncate">{sub.skill_name}</p></div>
                          <span className="text-[10px] text-gray-600 shrink-0">使用 {sub.usage_count} 次</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)} />
          <div className="fixed z-[61] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 100) }}>
            <button onClick={() => { setDetailSkill(contextMenu.skill); setContextMenu(null) }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <BookOpen className="w-3.5 h-3.5 text-blue-400" />查看详情
            </button>
            {contextMenu.skill.category && (
              <button onClick={() => { handleAssignCategory(contextMenu.skill.id, ''); setContextMenu(null) }}
                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
                <X className="w-3.5 h-3.5 text-amber-400" />取消分组
              </button>
            )}
            <button onClick={() => { handleReveal(contextMenu.skill); setContextMenu(null) }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <FolderOpen className="w-3.5 h-3.5 text-gray-400" />打开文件夹
            </button>
          </div>
        </>
      )}

      {/* Category Context Menu */}
      {catContextMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setCatContextMenu(null)} />
          <div className="fixed z-[61] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: Math.min(catContextMenu.x, window.innerWidth - 160), top: Math.min(catContextMenu.y, window.innerHeight - 80) }}>
            <button onClick={() => { setEditingCategory(catContextMenu.cat); setEditCategoryName(catContextMenu.cat); setCatContextMenu(null) }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <Settings className="w-3.5 h-3.5 text-blue-400" />重命名
            </button>
            {categories.includes(catContextMenu.cat) && (
              <button onClick={() => handleDeleteCategory(catContextMenu.cat)}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />删除标签
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}


// ═══════════════════════════════════════════════════
//  Tab 2: 完结工作流
// ═══════════════════════════════════════════════════

function ArchivedTab() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const { setCurrentProject, currentDepartmentId } = useAppStore()
  const canDelete = hasPermission(user?.role, 'project.delete')
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null)
  const [memoryModal, setMemoryModal] = useState<any | null>(null)
  const [memoryContent, setMemoryContent] = useState<any[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter((p: any) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
  }, [projects, searchQuery])

  const load = async () => {
    setLoading(true)
    try {
      const params = ['status=archived']
      if (currentDepartmentId) params.push(`department_id=${currentDepartmentId}`)
      setProjects(await api.getProjects(params.join('&')))
    } catch {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [currentDepartmentId])

  const handleRestore = async (p: any) => {
    setRestoring(p.id)
    try {
      await api.updateProject(p.id, { status: 'active' })
      // 恢复后刷新列表
      await load()
      // 同时刷新左侧工作流列表（通过 setCurrentProject 触发）
      setCurrentProject(p.id)
    } catch (e: any) { alert(e.message) } finally { setRestoring(null) }
  }

  const handleViewMemory = async (p: any) => {
    setMemoryModal(p)
    setMemoryLoading(true)
    try {
      // 获取该项目的对话消息作为记忆内容
      const messages = await api.getMessages(p.id)
      setMemoryContent(messages || [])
    } catch (e: any) {
      setMemoryContent([])
    } finally { setMemoryLoading(false) }
  }

  const handlePermanentDelete = async () => {
    if (!confirmDelete) return
    try {
      await api.deleteProject(confirmDelete.id)
      setConfirmDelete(null)
      load()
    } catch (e: any) { alert(e.message) }
  }

  return (
    <>
      {/* 记忆详情弹窗 */}
      {memoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMemoryModal(null)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="shrink-0 px-6 py-4 border-b border-gray-700 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><FileText className="w-5 h-5 text-amber-400" /></div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white">{memoryModal.name} — 对话记忆</h2>
                <p className="text-xs text-gray-400 mt-0.5">归档时的完整对话记录</p>
              </div>
              <button onClick={() => setMemoryModal(null)} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {memoryLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-gray-500 animate-spin" /></div>
              ) : memoryContent.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">暂无对话记录</p>
              ) : (
                memoryContent.map((msg: any, idx: number) => (
                  <div key={idx} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.sender_type === 'user'
                        ? 'bg-blue-600/20 border border-blue-500/20'
                        : 'bg-gray-700/50 border border-gray-600/50'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-medium ${msg.sender_type === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
                          {msg.sender_type === 'user' ? (msg.sender_name || '用户') : 'Agent'}
                        </span>
                        <span className="text-[9px] text-gray-600">{msg.created_at ? new Date(msg.created_at).toLocaleString('zh-CN') : ''}</span>
                      </div>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      {msg.thinking_content && (
                        <details className="mt-2">
                          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-400">查看思考过程</summary>
                          <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{msg.thinking_content}</p>
                        </details>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 确认永久删除弹窗 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-gray-800 border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center"><Trash2 className="w-5 h-5 text-red-400" /></div>
              <div>
                <h3 className="text-base font-semibold text-white">永久删除工作流</h3>
                <p className="text-xs text-gray-400 mt-0.5">此操作不可恢复</p>
              </div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 mb-5">
              <p className="text-sm text-gray-300 mb-2">即将永久删除「<span className="text-white font-medium">{confirmDelete.name}</span>」：</p>
              <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>项目工程文件和沙盒数据将被清除</li>
                <li>所有对话记录和消息历史将被删除</li>
                <li>已提炼的技能和记忆将 <span className="text-green-400 font-medium">保留</span></li>
              </ul>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 border border-gray-600 transition-colors">取消</button>
              <button onClick={handlePermanentDelete} className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors">确认永久删除</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">已结案的工作流，可查看记忆总结或恢复为进行中</p>
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索工作流..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
          </div>
          <button onClick={load} className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors" title="刷新"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <Archive className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">{searchQuery ? '未找到匹配的工作流' : '暂无完结工作流'}</p>
          {!searchQuery && <p className="text-xs text-gray-600 mt-1">在工作流页面点击「结案归档」后会出现在这里</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p: any) => (
            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors group">
              {/* Card header */}
              <div className="p-4 border-b border-gray-800">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{p.name}</h3>
                    {p.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.description}</p>}
                  </div>
                  <span className="text-[10px] px-2 py-0.5 bg-gray-700 text-gray-400 rounded-full shrink-0 ml-2">已归档</span>
                </div>
              </div>

              {/* Memory summary area — 可点击查看完整记忆 */}
              <div className="px-4 py-3 cursor-pointer hover:bg-gray-800/30 transition-colors" onClick={() => handleViewMemory(p)}>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium">对话记忆 · 点击查看</span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-3">
                  {p.description || '包含完整的多轮对话记录、Agent 思考过程与产出物。点击此处展开查看。'}
                </p>
              </div>

              {/* Metadata */}
              <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-3 text-[10px] text-gray-600">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(p.created_at).toLocaleDateString('zh-CN')}</span>
                {p.archived_at && <span className="flex items-center gap-1 text-amber-400"><Archive className="w-3 h-3" />归档于 {new Date(p.archived_at).toLocaleDateString('zh-CN')}</span>}
                <span>{p.department_name}</span>
              </div>

              {/* Actions */}
              <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/50 flex items-center gap-2">
                <button
                  onClick={() => navigate(`/project/${p.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  查看详情
                </button>
                <button
                  onClick={() => handleRestore(p)}
                  disabled={restoring === p.id}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors disabled:opacity-50"
                >
                  {restoring === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  恢复工作流
                </button>
                {canDelete && (
                  <button
                    onClick={() => setConfirmDelete(p)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="永久删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}


// ═══════════════════════════════════════════════════
//  Tab 3 & 4: 帧图库 / 角色库（共用组件）
// ═══════════════════════════════════════════════════

interface MediaTabProps { type: 'frames' | 'characters' }

function MediaTab({ type }: MediaTabProps) {
  const { currentDepartmentId } = useAppStore()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [configModal, setConfigModal] = useState<{ projectId: string; projectName: string } | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter((p: any) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
  }, [projects, searchQuery])
  const STORAGE_KEY = `media_paths_${type}`

  const icon = type === 'frames' ? Image : Users
  const label = type === 'frames' ? '帧图' : '角色'
  const Icon = icon

  const load = async () => {
    setLoading(true)
    try { setProjects(await api.getProjects(currentDepartmentId ? `department_id=${currentDepartmentId}` : '')) } catch {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [currentDepartmentId])

  const getPathMap = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} } }
  const getPath = (projectId: string) => getPathMap()[projectId] || ''

  const savePath = () => {
    if (!configModal) return
    const map = getPathMap()
    map[configModal.projectId] = configPath.trim()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    setConfigModal(null)
    setConfigPath('')
  }

  const handleOpen = (p: any) => {
    const path = getPath(p.id)
    if (!path) {
      setConfigModal({ projectId: p.id, projectName: p.name })
      setConfigPath('')
    } else {
      api.revealInFinder(path).catch((e: any) => alert(e.message))
    }
  }

  return (
    <>
      {/* 配置路径弹窗 */}
      {configModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfigModal(null)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Settings className="w-5 h-5 text-blue-400" /></div>
              <div>
                <h3 className="text-base font-semibold text-white">配置{label}路径</h3>
                <p className="text-xs text-gray-400 mt-0.5">为「{configModal.projectName}」设置{label}文件夹路径</p>
              </div>
            </div>
            <input
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
              placeholder={`/Users/you/Projects/${configModal.projectName}/${label}`}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-gray-600 mb-5"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfigModal(null)} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 border border-gray-600 transition-colors">取消</button>
              <button onClick={savePath} className="px-4 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors">保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">每个工作流的{label}资源，通过配置本地文件夹路径浏览</p>
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`搜索${label}...`}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
          </div>
          <button onClick={load} className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors" title="刷新"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <Icon className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">{searchQuery ? '未找到匹配的工作流' : '暂无工作流'}</p>
          {!searchQuery && <p className="text-xs text-gray-600 mt-1">创建项目后可配置{label}路径</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p: any) => {
            const path = getPath(p.id)
            return (
              <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors group">
                {/* 预览区 */}
                <div className="h-32 bg-gray-800/50 flex items-center justify-center border-b border-gray-800">
                  {path ? (
                    <div className="text-center"><Icon className="w-8 h-8 text-gray-600 mb-1" /><p className="text-[10px] text-gray-500 max-w-[160px] truncate">{path}</p></div>
                  ) : (
                    <div className="text-center"><Settings className="w-8 h-8 text-gray-700 mb-1" /><p className="text-xs text-gray-600">未配置路径</p></div>
                  )}
                </div>
                {/* Info */}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-white truncate">{p.name}</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{p.department_name} · @ {p.owner_name}</p>
                </div>
                {/* Actions */}
                <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/50 flex items-center gap-2">
                  <button onClick={() => handleOpen(p)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${path ? 'text-gray-300 bg-gray-700 hover:bg-gray-600' : 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20'}`}>
                    {path ? <><FolderOpen className="w-3.5 h-3.5" />打开文件夹</> : <><Settings className="w-3.5 h-3.5" />配置路径</>}
                  </button>
                  <button onClick={() => { setConfigModal({ projectId: p.id, projectName: p.name }); setConfigPath(path) }} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors" title="修改路径"><Settings className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
