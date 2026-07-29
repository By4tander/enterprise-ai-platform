import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAppStore } from '../store'
import { FolderOpen, MessageSquare, FileText, Clock, Archive } from 'lucide-react'

export default function Dashboard() {
  const navigate = useNavigate()
  const { setCurrentProject, currentDepartmentId } = useAppStore()
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = currentDepartmentId ? `department_id=${currentDepartmentId}` : ''
    api.getProjects(params)
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentDepartmentId])

  const stats = {
    active: projects.filter((p: any) => p.status === 'active').length,
    archived: projects.filter((p: any) => p.status === 'archived').length,
    total: projects.length,
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">工作台</h1>
        <p className="text-sm text-gray-500 mt-1">管理您的工作流与 AI 协作</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { icon: FolderOpen, label: '活跃工作流', value: stats.active, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { icon: Archive, label: '已归档', value: stats.archived, color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { icon: Clock, label: '工作流总数', value: stats.total, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map((stat) => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Project List */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">全部工作流</h2>
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
            <FolderOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">暂无工作流</p>
            <p className="text-xs text-gray-600 mt-1">点击左侧「新建工作流」开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p: any) => (
              <button
                key={p.id}
                onClick={() => {
                  setCurrentProject(p.id)
                  navigate(`/project/${p.id}`)
                }}
                className="text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-all hover:shadow-lg"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-medium text-white truncate">{p.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ml-2 ${
                    p.status === 'active'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-gray-500/10 text-gray-400'
                  }`}>
                    {p.status === 'active' ? '进行中' : '已归档'}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-gray-500 mb-3 line-clamp-2">{p.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> {p.message_count || 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" /> {p.artifact_count || 0}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-600">{p.department_name}</span>
                  <span className="text-xs text-gray-600">@{p.owner_name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
