import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { api } from '../../services/api'
import { hasPermission } from '../../utils/permissions'
import { FolderOpen, BookOpen, Archive, Plus, ChevronRight, ChevronDown, Loader2, AlertCircle, Pencil, Check, X, Zap, Folder, Palette, Trash2 } from 'lucide-react'

interface Project {
  id: string
  name: string
  status: string
  department_id: string
  department_name: string
  folder_id?: string | null
  created_at: string
}

interface ProjectFolder {
  id: string
  name: string
  color: string
  department_id: string
  position: number
  project_count: number
}

const PRESET_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#6b7280']

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const { currentProjectId, currentDepartmentId, setCurrentProject, setCurrentDepartment } = useAppStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [folders, setFolders] = useState<ProjectFolder[]>([])
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
  // ── 文件夹状态 ──
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(PRESET_COLORS[0])
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null)
  const [renameFolderValue, setRenameFolderValue] = useState('')

  const loadProjects = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const params = ['status=active']
      if (currentDepartmentId) {
        params.push(`department_id=${currentDepartmentId}`)
      }
      const [projData, folderData] = await Promise.all([
        api.getProjects(params.join('&')),
        api.getFolders(currentDepartmentId || undefined).catch(() => []),
      ])
      setProjects(projData)
      setFolders(folderData)
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
      if (user?.department_id) {
        setSelectedDept(user.department_id)
      } else if (depts.length > 0) {
        setSelectedDept(depts[0].id)
      }
    }).catch(() => {})
  }, [currentDepartmentId])

  // 监听项目归档事件，自动刷新列表
  useEffect(() => {
    const handler = () => loadProjects()
    window.addEventListener('project-archived', handler)
    return () => window.removeEventListener('project-archived', handler)
  }, [loadProjects])

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
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

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const deptId = selectedDept || user?.department_id || departments[0]?.id || ''
      if (!deptId) return
      await api.createFolder({ name: newFolderName.trim(), color: newFolderColor, department_id: deptId })
      setShowNewFolder(false)
      setNewFolderName('')
      loadProjects()
    } catch (e: any) {
      alert(e.message || '创建文件夹失败')
    }
  }

  const handleMoveToFolder = async (projectId: string, folderId: string | null) => {
    try {
      await api.moveProjectToFolder(projectId, folderId)
      loadProjects()
    } catch (e: any) {
      alert(e.message || '移动失败')
    }
  }

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('确定删除此文件夹？文件夹内的项目将移出。')) return
    try {
      await api.deleteFolder(folderId)
      loadProjects()
    } catch (e: any) {
      alert(e.message || '删除失败')
    }
  }

  // 分组：有文件夹的项目 vs 无文件夹的项目
  const unfiledProjects = projects.filter(p => !p.folder_id)
  const folderGroups = folders.map(f => ({
    folder: f,
    projects: projects.filter(p => p.folder_id === f.id),
  }))

  const navItems = [
    { icon: FolderOpen, label: '工作台', path: '/', active: location.pathname === '/' || location.pathname.startsWith('/project/') },
    { icon: Zap, label: 'Hermes 全局技能', path: '/global-skills', active: location.pathname === '/global-skills' },
    { icon: BookOpen, label: 'Agent 资源库', path: '/skills', active: location.pathname === '/skills' },
  ]

  // 渲染单个项目行（folderColor 可选，用于继承文件夹颜色）
  const canRename = hasPermission(user?.role, 'project.rename')
  const canDelete = hasPermission(user?.role, 'project.delete')
  const canCreateFolder = hasPermission(user?.role, 'folder.create')

  const renderProject = (p: Project, folderColor?: string) => (
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
              } else if (e.key === 'Escape') setRenameId(null)
            }}
            onBlur={() => setRenameId(null)}
            className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-xs text-gray-200 outline-none"
            autoFocus
          />
          <button onClick={() => setRenameId(null)} className="text-gray-400 hover:text-gray-200"><X className="w-3 h-3" /></button>
        </div>
      ) : (
        <button
          onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`) }}
          draggable={canRename}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/project-id', p.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            currentProjectId === p.id
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
          }`}
        >
          {folderColor ? (
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: folderColor }} />
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
          )}
          <span className="truncate flex-1 text-left">{p.name}</span>
          {canRename && (
            <button
              onClick={(e) => { e.stopPropagation(); setRenameId(p.id); setRenameValue(p.name); setTimeout(() => renameInputRef.current?.focus(), 50) }}
              className="opacity-0 group-hover/proj:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-all shrink-0"
              title="重命名"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`确定删除「${p.name}」？此操作不可恢复。`)) {
                  api.deleteProject(p.id).then(() => {
                    setProjects(prev => prev.filter(pr => pr.id !== p.id))
                    if (currentProjectId === p.id) {
                      setCurrentProject(null)
                      navigate('/')
                    }
                  }).catch((err) => alert('删除失败: ' + err.message))
                }
              }}
              className="opacity-0 group-hover/proj:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-all shrink-0"
              title="删除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </button>
      )}
    </div>
  )

  return (
    <aside className="w-full bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 flex-1 min-h-0">
      {/* New Project Button */}
      <div className="p-3">
        <button
          onClick={() => { setCreateError(''); setShowNewProject(true) }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建工作流
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-2 flex-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => {
              navigate(item.path)
              if (item.path === '/skills' || item.path === '/global-skills') setCurrentProject(null)
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${
              item.active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.active && <ChevronRight className="w-4 h-4 ml-auto shrink-0" />}
          </button>
        ))}

        <div className="my-3 border-t border-gray-800" />

        {/* Active Projects — with folders */}
        <div className="flex items-center justify-between px-3 mb-2">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">进行中的工作流</p>
          {canCreateFolder && (
            <button
              onClick={() => setShowNewFolder(true)}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="新建文件夹"
            >
              <Folder className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>
        ) : loadError ? (
          <div className="px-3 py-2 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /><span>{loadError}</span>
            <button onClick={loadProjects} className="ml-auto text-blue-400 hover:underline">重试</button>
          </div>
        ) : (
          <>
            {/* Folders */}
            {folderGroups.map(({ folder, projects: folderProjects }) => {
              const isExpanded = expandedFolders.has(folder.id)
              return (
                <div key={folder.id}
                  onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.id) }}
                  onDragLeave={() => setDragOverFolder(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const pid = e.dataTransfer.getData('text/project-id')
                    if (pid) handleMoveToFolder(pid, folder.id)
                    setDragOverFolder(null)
                  }}
                  className={`mb-1 rounded-lg transition-colors ${dragOverFolder === folder.id ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''}`}
                >
                  {/* Folder header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-800/50 group/folder cursor-pointer"
                    onClick={() => {
                      setExpandedFolders(prev => {
                        const next = new Set(prev)
                        if (next.has(folder.id)) next.delete(folder.id)
                        else next.add(folder.id)
                        return next
                      })
                    }}
                  >
                    <button className="p-0.5 text-gray-500 shrink-0">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    <div className="w-3 h-3 rounded shrink-0" style={{ backgroundColor: folder.color }} />
                    {renameFolderId === folder.id ? (
                      <input
                        value={renameFolderValue}
                        onChange={(e) => setRenameFolderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            api.updateFolder(folder.id, { name: renameFolderValue.trim() }).then(loadProjects)
                            setRenameFolderId(null)
                          } else if (e.key === 'Escape') setRenameFolderId(null)
                        }}
                        onBlur={() => setRenameFolderId(null)}
                        className="flex-1 bg-gray-800 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-gray-200 outline-none"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-xs text-gray-300 font-medium truncate flex-1">{folder.name}</span>
                    )}
                    <span className="text-[9px] text-gray-500 shrink-0">{folderProjects.length}</span>
                    {/* Folder actions — 仅管理员可见 */}
                    {hasPermission(user?.role, 'folder.rename') && (
                      <div className="opacity-0 group-hover/folder:opacity-100 flex gap-0.5 shrink-0 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); setRenameFolderId(folder.id); setRenameFolderValue(folder.name) }}
                          className="p-0.5 rounded hover:bg-gray-700 text-gray-500" title="重命名">
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id) }}
                          className="p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title="删除文件夹">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Folder contents */}
                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {folderProjects.length === 0 ? (
                        <p className="text-[10px] text-gray-600 px-3 py-1">拖入工作流到此文件夹</p>
                      ) : (
                        folderProjects.map(p => renderProject(p, folder.color))
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Unfiled projects */}
            {unfiledProjects.length > 0 && (
              <>
                {folderGroups.length > 0 && (
                  <p className="px-3 text-[10px] text-gray-500 uppercase tracking-wider mt-2 mb-1">未分类</p>
                )}
                {unfiledProjects.map(renderProject)}
              </>
            )}

            {projects.length === 0 && (
              <p className="px-3 text-xs text-gray-500">暂无工作流</p>
            )}
          </>
        )}
      </nav>

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowNewFolder(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm shadow-2xl animate-fade-in">
            <h3 className="text-sm font-semibold text-white mb-3">新建工作流文件夹</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">文件夹名称</label>
                <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="如：Q3 动画工作流..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} autoFocus />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">标签颜色</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setNewFolderColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${newFolderColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">取消</button>
              <button onClick={handleCreateFolder} disabled={!newFolderName.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { if (!creating) setShowNewProject(false) }} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl animate-fade-in">
            <h3 className="text-lg font-semibold text-white mb-4">新建工作流</h3>
            {createError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />{createError}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">工作流名称 *</label>
                <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="输入工作流名称..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} autoFocus disabled={creating} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">工作流描述（可选）</label>
                <textarea value={newProjectDesc} onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="简要描述工作流目标..." rows={2}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  disabled={creating} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">所属部门</label>
                <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none" disabled={creating}>
                  {departments.length === 0 && <option value="">加载中...</option>}
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowNewProject(false)} disabled={creating}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleCreateProject} disabled={!newProjectName.trim() || creating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
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
