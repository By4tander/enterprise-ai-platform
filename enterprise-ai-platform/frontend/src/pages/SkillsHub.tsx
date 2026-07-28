import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { useAppStore } from '../store'
import { BookOpen, Star, Check, X, ExternalLink, AlertCircle, Upload, Info } from 'lucide-react'
import ImportSkillModal from '../components/skills/ImportSkillModal'

interface Skill {
  id: string
  skill_name: string
  content_prompt: string
  category: string | null
  is_approved: boolean
  usage_count: number
  rating: number
  auto_inject: boolean
  derived_from_project_name: string | null
  created_at: string
  // Phase 5 provenance
  created_by_username: string | null
  import_source: string | null
  original_source_url: string | null
  metadata_json: string | null
}

export default function SkillsHub() {
  const { currentDepartmentId } = useAppStore()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [infoSkill, setInfoSkill] = useState<Skill | null>(null)

  const loadSkills = async () => {
    setLoading(true)
    try {
      const deptParam = currentDepartmentId ? `department_id=${currentDepartmentId}` : ''
      const data = await api.getSkills(currentDepartmentId || undefined)
      setSkills(data)
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkills()
  }, [currentDepartmentId])

  const handleToggleApprove = async (skill: Skill) => {
    try {
      await api.updateSkill(skill.id, { is_approved: !skill.is_approved })
      loadSkills()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleToggleAutoInject = async (skill: Skill) => {
    try {
      await api.updateSkill(skill.id, { auto_inject: !skill.auto_inject })
      loadSkills()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`w-3 h-3 ${i < Math.round(rating) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-600'}`}
      />
    ))
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">部门技能/记忆库</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理从已结案项目中提炼的公共技能、Prompt 模板和 SOP
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
        >
          <Upload className="w-4 h-4" />
          导入 Skill
        </button>
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

      {/* Provenance Info Modal */}
      {infoSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setInfoSkill(null)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" />
                技能来源
              </h3>
              <button onClick={() => setInfoSkill(null)} className="p-1 hover:bg-gray-700 rounded text-gray-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs text-gray-500">技能名称</p>
                <p className="text-sm text-white font-medium">{infoSkill.skill_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">导入/创建方式</p>
                  <p className="text-sm text-gray-300">
                    {infoSkill.import_source === 'distillation' && '🔄 项目结案提炼'}
                    {infoSkill.import_source === 'import' && '📋 手动导入'}
                    {infoSkill.import_source === 'import_zip' && '📦 ZIP 技能包导入'}
                    {infoSkill.import_source === 'manual' && '✏️ 手动创建'}
                    {(!infoSkill.import_source || infoSkill.import_source === 'None') && '➖ 未记录'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">创建人</p>
                  <p className="text-sm text-gray-300">{infoSkill.created_by_username || '系统'}</p>
                </div>
              </div>
              {infoSkill.derived_from_project_name && (
                <div>
                  <p className="text-xs text-gray-500">来源项目</p>
                  <p className="text-sm text-gray-300">{infoSkill.derived_from_project_name}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">创建时间</p>
                <p className="text-sm text-gray-300">
                  {new Date(infoSkill.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
              {infoSkill.original_source_url && (
                <div>
                  <p className="text-xs text-gray-500">原始来源</p>
                  <a href={infoSkill.original_source_url} target="_blank" rel="noopener"
                     className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />
                    {infoSkill.original_source_url}
                  </a>
                </div>
              )}
              {infoSkill.metadata_json && (() => {
                try {
                  const meta = JSON.parse(infoSkill.metadata_json)
                  return (
                    <div>
                      <p className="text-xs text-gray-500">额外信息</p>
                      <div className="text-xs text-gray-400 bg-gray-900 rounded-lg p-2 mt-1 space-y-1">
                        {meta.original_filename && <p>📁 原始文件: {meta.original_filename}</p>}
                        {meta.skill_format && <p>📋 格式: {meta.skill_format}</p>}
                        {meta.original_engine && <p>⚙️ 适配引擎: {meta.original_engine}</p>}
                        {meta.tags?.length > 0 && <p>🏷️ 标签: {meta.tags.join(', ')}</p>}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : skills.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">暂无部门技能</p>
          <p className="text-xs text-gray-600 mt-1">当项目结案归档后，系统将自动提炼技能存入此库</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors"
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-800">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{skill.skill_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {skill.category && (
                        <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">
                          {skill.category}
                        </span>
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
                        <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">
                          默认注入
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setInfoSkill(skill) }}
                      className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400 transition-colors"
                      title="查看来源"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                    {renderStars(skill.rating)}
                  </div>
                </div>
              </div>

              {/* Content Preview */}
              <div className="px-4 py-3 max-h-32 overflow-y-auto">
                <p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-4">
                  {skill.content_prompt}
                </p>
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-gray-800 flex items-center justify-between bg-gray-900/50">
                <div className="flex items-center gap-3 text-[10px] text-gray-600">
                  <span>使用 {skill.usage_count} 次</span>
                  {skill.derived_from_project_name && (
                    <span className="flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      来自: {skill.derived_from_project_name}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleApprove(skill)}
                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                      skill.is_approved
                        ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                        : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                    }`}
                  >
                    {skill.is_approved ? '取消审核' : '审核通过'}
                  </button>
                  <button
                    onClick={() => handleToggleAutoInject(skill)}
                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                      skill.auto_inject
                        ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {skill.auto_inject ? '取消注入' : '注入新项目'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
