import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAppStore } from '../store'
import { Archive, FileText, Calendar } from 'lucide-react'

export default function ArchivedProjects() {
  const navigate = useNavigate()
  const { setCurrentProject, currentDepartmentId } = useAppStore()
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = ['status=archived']
    if (currentDepartmentId) {
      params.push(`department_id=${currentDepartmentId}`)
    }
    api.getProjects(params.join('&'))
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false))  }, [])

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">项目归档区</h1>
        <p className="text-sm text-gray-500 mt-1">查阅已结案项目的历史产出与提炼报告</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
          <Archive className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">暂无已归档项目</p>
          <p className="text-xs text-gray-600 mt-1">进行中的项目可以在此归档，系统会自动提炼技能</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p: any) => (
            <div
              key={p.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white">{p.name}</h3>
                  {p.description && (
                    <p className="text-xs text-gray-500 mt-1">{p.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-600">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(p.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    {p.archived_at && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Archive className="w-3 h-3" />
                        归档于 {new Date(p.archived_at).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {p.artifact_count || 0} 个产出物
                    </span>
                    <span>{p.department_name}</span>
                    <span>@{p.owner_name}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCurrentProject(p.id)
                    navigate(`/project/${p.id}`)
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
