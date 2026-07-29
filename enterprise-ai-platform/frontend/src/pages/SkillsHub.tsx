import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../services/api'
import { useAppStore, useAuthStore } from '../store'
import { hasPermission } from '../utils/permissions'
import { BookOpen, Star, Check, X, ExternalLink, AlertCircle, Upload, Info, FolderOpen, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import ImportSkillModal from '../components/skills/ImportSkillModal'

interface Skill {
  id: string
  skill_name: string
  content_prompt: string
  description: string | null
  category: string | null
  department_id: string | null
  is_approved: boolean
  usage_count: number
  rating: number
  auto_inject: boolean
  derived_from_project_name: string | null
  created_at: string
  created_by_username: string | null
  import_source: string | null
  original_source_url: string | null
  metadata_json: string | null
}

interface SkillGroup {
  key: string
  name: string
  mainSkill: Skill
  subSkills: Skill[]
  totalUsage: number
  importSource: string | null
}

function groupSkills(skills: Skill[]): SkillGroup[] {
  const groups = new Map<string, Skill[]>()
  const ungrouped: SkillGroup[] = []

  for (const skill of skills) {
    let groupKey = skill.id // default: each skill is its own group
    if (skill.import_source === 'import_zip' && skill.metadata_json) {
      try {
        const meta = JSON.parse(skill.metadata_json)
        if (meta.original_filename) {
          groupKey = meta.original_filename
        }
      } catch {}
    }
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey)!.push(skill)
  }

  for (const [key, groupSkills] of groups) {
    if (groupSkills.length === 1) {
      // Single skill, no grouping needed
      ungrouped.push({
        key,
        name: groupSkills[0].skill_name,
        mainSkill: groupSkills[0],
        subSkills: [],
        totalUsage: groupSkills[0].usage_count,
        importSource: groupSkills[0].import_source,
      })
    } else {
      // Multiple skills from same ZIP — find the main one (yaml_frontmatter format)
      let mainSkill = groupSkills.find(s => {
        try { return JSON.parse(s.metadata_json || '{}').skill_format === 'yaml_frontmatter' } catch { return false }
      }) || groupSkills[0]
      const subSkills = groupSkills.filter(s => s.id !== mainSkill.id)
      const totalUsage = groupSkills.reduce((sum, s) => sum + s.usage_count, 0)
      ungrouped.push({
        key,
        name: key.replace('.zip', ''),
        mainSkill,
        subSkills,
        totalUsage,
        importSource: mainSkill.import_source,
      })
    }
  }
  return ungrouped
}

export default function SkillsHub() {
  const { currentDepartmentId } = useAppStore()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; skill: Skill } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const loadSkills = async () => {
    setLoading(true)
    try {
      const data = await api.getSkills(currentDepartmentId || undefined)
      setSkills(data)
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSkills() }, [currentDepartmentId])

  const handleToggleApprove = async (skill: Skill) => {
    try {
      await api.updateSkill(skill.id, { is_approved: !skill.is_approved })
      loadSkills()
    } catch (e: any) { alert(e.message) }
  }

  const handleToggleAutoInject = async (skill: Skill) => {
    try {
      await api.updateSkill(skill.id, { auto_inject: !skill.auto_inject })
      loadSkills()
    } catch (e: any) { alert(e.message) }
  }

  const getSkillPath = (skill: Skill): string => {
    const deptId = skill.department_id || 'default'
    const safeName = skill.skill_name.replace(/[^\w\-]/g, '_')
    return `/Users/jiayiren/.hermes/skills/${deptId}/${safeName}`
  }

  const handleReveal = (skill: Skill) => {
    const path = getSkillPath(skill)
    api.revealInFinder(path).catch((e: any) => alert(e.message))
    setContextMenu(null)
  }

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star key={i} className={`w-3 h-3 ${i < Math.round(rating) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-600'}`} />
    ))
  }

  const user = useAuthStore((s) => s.user)
  const canImport = hasPermission(user?.role, 'skill.import')
  const canToggleDefault = hasPermission(user?.role, 'skill.toggle_default')

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">部门技能/记忆库</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理从已结案项目中提炼的公共技能、Prompt 模板和 SOP
          </p>
        </div>
        {canImport && (
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            <Upload className="w-4 h-4" />
            导入 Skill
          </button>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <ImportSkillModal
          show={showImport}
          departmentId={currentDepartmentId || ''}
          onClose={() => setShowImport(false)}
          onImported={loadSkills}
        />
      )}

      {/* Skill Detail Modal */}
      {detailSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetailSkill(null)}>
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
                <h2 className="text-base font-semibold text-white">{detailSkill.skill_name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {detailSkill.category && <span className="text-[10px] text-gray-500">{detailSkill.category}</span>}
                  {detailSkill.import_source && <span className="text-[10px] text-gray-500">· {detailSkill.import_source}</span>}
                  {detailSkill.auto_inject && <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">默认加载</span>}
                </div>
              </div>
              <button onClick={() => setDetailSkill(null)} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {detailSkill.description && (
              <div className="shrink-0 px-6 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm text-gray-300 leading-relaxed">{detailSkill.description}</p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-4 markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detailSkill.content_prompt}
              </ReactMarkdown>
            </div>
            <div className="shrink-0 px-6 py-3 border-t border-gray-700 flex items-center justify-between text-[10px] text-gray-500">
              <span>使用 {detailSkill.usage_count} 次 · {detailSkill.created_by_username || '系统'}</span>
              <button
                onClick={() => handleReveal(detailSkill)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                打开文件夹
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[61] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 60) }}
          >
            <button
              onClick={() => handleReveal(contextMenu.skill)}
              className="w-full px-4 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
              打开文件夹位置
            </button>
            <button
              onClick={() => { setDetailSkill(contextMenu.skill); setContextMenu(null) }}
              className="w-full px-4 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-gray-400" />
              查看详情
            </button>
          </div>
        </>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>
      ) : skills.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">暂无部门技能</p>
          <p className="text-xs text-gray-600 mt-1">当项目结案归档后，系统将自动提炼技能存入此库</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupSkills(skills).map((group) => {
            const isExpanded = expandedGroups.has(group.key)
            const hasSubSkills = group.subSkills.length > 0
            const skill = group.mainSkill
            return (
              <div key={group.key} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors">
                {/* Main skill card */}
                <div
                  className="cursor-pointer"
                  onClick={() => setDetailSkill(skill)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, skill }) }}
                >
                  <div className="p-4 border-b border-gray-800">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {hasSubSkills && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedGroups(prev => {
                                  const next = new Set(prev)
                                  if (next.has(group.key)) next.delete(group.key)
                                  else next.add(group.key)
                                  return next
                                })
                              }}
                              className="p-0.5 rounded hover:bg-gray-700 text-gray-400 transition-colors"
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          )}
                          <h3 className="text-sm font-semibold text-white truncate">{group.name}</h3>
                          {hasSubSkills && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded-full shrink-0">
                              {group.subSkills.length} 子技能
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {skill.category && (
                            <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">{skill.category}</span>
                          )}
                          {skill.is_approved ? (
                            <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full flex items-center gap-1">
                              <Check className="w-3 h-3" /> 已审核
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> 待审核
                            </span>
                          )}
                          {skill.auto_inject && (
                            <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">默认加载</span>
                          )}
                          {group.importSource === 'import_zip' && (
                            <span className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded-full">ZIP 导入</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetailSkill(skill) }}
                          className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400 transition-colors"
                          title="查看详情"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                        {renderStars(skill.rating)}
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-3 max-h-24 overflow-y-auto">
                    <p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-3">{skill.content_prompt}</p>
                  </div>
                  <div className="px-4 py-2.5 border-t border-gray-800 flex items-center justify-between bg-gray-900/50">
                    <div className="flex items-center gap-3 text-[10px] text-gray-600">
                      <span>使用 {group.totalUsage} 次</span>
                      {skill.derived_from_project_name && (
                        <span className="flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          来自: {skill.derived_from_project_name}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleApprove(skill) }}
                        className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                          skill.is_approved ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                        }`}
                      >
                        {skill.is_approved ? '取消审核' : '审核通过'}
                      </button>
                      {canToggleDefault ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleAutoInject(skill) }}
                          className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                            skill.auto_inject ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          {skill.auto_inject ? '取消默认加载' : '默认加载'}
                        </button>
                      ) : (
                        skill.auto_inject && (
                          <span className="text-[10px] px-2 py-1 rounded-lg bg-purple-500/10 text-purple-400 cursor-default">
                            默认加载
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-skills (expandable) */}
                {hasSubSkills && isExpanded && (
                  <div className="border-t border-gray-800 bg-gray-800/30">
                    <div className="px-4 py-2">
                      <p className="text-[10px] text-gray-500 mb-2">子技能 ({group.subSkills.length})</p>
                      <div className="space-y-1.5">
                        {group.subSkills.map((sub) => (
                          <div
                            key={sub.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors"
                            onClick={() => setDetailSkill(sub)}
                            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, skill: sub }) }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-300 truncate">{sub.skill_name}</p>
                              <p className="text-[10px] text-gray-500 truncate mt-0.5">{sub.description || sub.category || ''}</p>
                            </div>
                            <span className="text-[10px] text-gray-600 shrink-0">使用 {sub.usage_count} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
