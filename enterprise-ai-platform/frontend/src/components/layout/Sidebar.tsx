import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { api } from '../../services/api'
import { FolderOpen, BookOpen, Archive, Plus, ChevronRight, Loader2, AlertCircle, Pencil, Check, X } from 'lucide-react'

interface Project {
  id: string
  name: string
  status: string
  department_id: string
  department_name: string
  created_at: string
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const { currentProjectId, currentDepartmentId, setCurrentProject, setCurrentDepartment } = useAppStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [selectedDept, setSelectedDept] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const loadProjects = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const params = ['status=active']
      if (currentDepartmentId) {
        params.push(`department_id=${currentDepartmentId}`)
      }
      const data = await api.getProjects(params.join('&'))
      setProjects(data)
    } catch (e: any) {
      setLoadError(e.message || '加载项目失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
    api.getDepartments().then((depts) => {
      setDepartments(depts)
      // Auto-select user's department
      if (user?.department_id) {
        setSelectedDept(user.department_id)
      } else if (depts.length > 0) {
        setSelectedDept(depts[0].id)
      }
    }).catch(() => {})
  }, [currentDepartmentId])  // 部门切换时重新加载

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      // Use selected department or user's department or first available
      const deptId = selectedDept || user?.department_id || departments[0]?.id || ''
      if (!deptId) {
        setCreateError('请先选择所属部门')
        return
      }
      await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
        department_id: deptId,
      })
      setShowNewProject(false)
      setNewProjectName('')
      setNewProjectDesc('')
      setCreateError('')
      loadProjects()
    } catch (e: any) {
      setCreateError(e.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const navItems = [
    {
      icon: FolderOpen,
      label: '我的项目',
      path: '/',
      active: location.pathname === '/' || location.pathname.startsWith('/project/'),
    },
    {
      icon: BookOpen,
      label: '部门技能/记忆库',
      path: '/skills',
      active: location.pathname === '/skills',
    },
    {
      icon: Archive,
      label: '项目归档区',
      path: '/archived',
      active: location.pathname === '/archived',
    },
  ]

  return (
    <aside className="w-full bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 flex-1 min-h-0">
      {/* New Project Button */}
      <div className="p-3">
        <button
          onClick={() => {
            setCreateError('')
            setShowNewProject(true)
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-2 flex-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => {
              navigate(item.path)
              if (item.path === '/archived' || item.path === '/skills') {
                setCurrentProject(null)
              }
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${
              item.active
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.active && <ChevronRight className="w-4 h-4 ml-auto shrink-0" />}
          </button>
        ))}

        {/* Divider */}
        <div className="my-3 border-t border-gray-800" />

        {/* Active Projects */}
        <p className="px-3 text-xs text-gray-600 uppercase tracking-wider mb-2 font-medium">
          进行中的项目
        </p>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="px-3 py-2 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            <span>{loadError}</span>
            <button onClick={loadProjects} className="ml-auto text-blue-400 hover:underline">重试</button>
          </div>
        ) : projects.length === 0 ? (
          <p className="px-3 text-xs text-gray-600">暂无项目</p>
        ) : (
          projects.map((p) => (
            <div key={p.id} className="group/proj relative">
              {renameId === p.id ? (
                <div className="flex items-center gap-1 px-3 py-1.5">
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const trimmed = renameValue.trim()
                        if (trimmed && trimmed !== p.name) {
                          api.updateProject(p.id, { name: trimmed }).then(() => {
                            setProjects(prev => prev.map(pr => pr.id === p.id ? { ...pr, name: trimmed } : pr))
                          }).catch(() => alert('重命名失败'))
                        }
                        setRenameId(null)
                      } else if (e.key === 'Escape') {
                        setRenameId(null)
                      }
                    }}
                    onBlur={() => setRenameId(null)}
                    className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-xs text-gray-200 outline-none"
                    autoFocus
                  />
                  <button onClick={() => setRenameId(null)} className="text-gray-400 hover:text-gray-200"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setCurrentProject(p.id)
                    navigate(`/project/${p.id}`)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentProjectId === p.id
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="truncate flex-1 text-left">{p.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenameId(p.id)
                      setRenameValue(p.name)
                      setTimeout(() => renameInputRef.current?.focus(), 50)
                    }}
                    className="opacity-0 group-hover/proj:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-all shrink-0"
                    title="重命名"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </button>
              )}
            </div>
          ))
        )}
      </nav>

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => { if (!creating) setShowNewProject(false) }}
          />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl animate-fade-in">
            <h3 className="text-lg font-semibold text-white mb-4">新建项目</h3>

            {createError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {createError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">项目名称 *</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="输入项目名称..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  autoFocus
                  disabled={creating}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">项目描述（可选）</label>
                <textarea
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="简要描述项目目标..."
                  rows={2}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  disabled={creating}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">所属部门</label>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none"
                  disabled={creating}
                >
                  {departments.length === 0 && (
                    <option value="">加载中...</option>
                  )}
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowNewProject(false)}
                disabled={creating}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
