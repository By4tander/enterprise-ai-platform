import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAppStore } from '../store'
import {
  FolderOpen, MessageSquare, FileText, Clock, Archive, Zap,
  Plus, ChevronRight, ChevronDown, Palette, Trash2, Folder,
  BarChart3, TrendingUp,
} from 'lucide-react'

interface FolderItem {
  id: string; name: string; color: string; department_id: string; position: number; project_count: number
}

const FOLDER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#f97316']

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function SparkLineChart({ data, labels, color = '#f59e0b' }: { data: number[]; labels?: string[]; color?: string }) {
  const hasData = data.length >= 1 && data.some(v => v > 0)
  const displayData = hasData ? data : [0]
  const displayLabels = labels || displayData.map((_, i) => `${i + 1}`)

  const max = Math.max(...displayData, 1)
  const padX = 52; const padY = 32; const padB = 32; const padR = 24
  const minChartW = 600
  const pointSpacing = 48
  const chartW = Math.max(minChartW, displayData.length * pointSpacing)
  const svgW = padX + chartW + padR
  const svgH = 220

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="overflow-visible">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={hasData ? 0.35 : 0.1} />
          <stop offset="50%" stopColor={color} stopOpacity={hasData ? 0.1 : 0.03} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor={color} />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="dotGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* Grid */}
      {(() => {
        const chartH = svgH - padY - padB
        const stepX = chartW / Math.max(displayData.length - 1, 1)
        const toY = (v: number) => padY + chartH - (v / max) * chartH
        const yTicks = 5
        const yLines = Array.from({ length: yTicks + 1 }, (_, i) => { const v = (max / yTicks) * i; return { y: toY(v), v } })
        const points = displayData.map((v, i) => `${padX + i * stepX},${toY(v)}`).join(' ')
        const areaPoints = `${padX},${padY + chartH} ${points} ${padX + chartW},${padY + chartH}`

        return (
          <>
            {/* Y grid + labels */}
            {yLines.map((t, i) => (
              <g key={i}>
                <line x1={padX} y1={t.y} x2={padX + chartW} y2={t.y} stroke="#1e293b" strokeWidth="1" opacity="0.6" strokeDasharray={i === yTicks ? "" : "3,6"} />
                <text x={padX - 10} y={t.y + 4} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">{formatTokens(t.v)}</text>
              </g>
            ))}
            {/* Area fill */}
            <polygon points={areaPoints} fill="url(#sparkGrad)" />
            {/* Glow line behind */}
            <polyline points={points} fill="none" stroke={hasData ? color : '#374151'} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#glow)" />
            {/* Main line */}
            <polyline points={points} fill="none" stroke={hasData ? "url(#lineGrad)" : '#374151'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* Data dots */}
            {displayData.map((v, i) => {
              const x = padX + i * stepX; const y = toY(v)
              const isLast = i === displayData.length - 1
              return (
                <g key={i}>
                  {isLast && hasData && <circle cx={x} cy={y} r="10" fill={color} opacity="0.15" filter="url(#dotGlow)" />}
                  <circle cx={x} cy={y} r={isLast ? 4.5 : 3} fill={isLast ? color : (hasData ? color : '#4b5563')} stroke="#0f172a" strokeWidth="2" />
                  {isLast && hasData && (
                    <text x={x} y={y - 14} textAnchor="middle" fill={color} fontSize="11" fontWeight="600">{formatTokens(v)}</text>
                  )}
                </g>
              )
            })}
            {/* X labels — show all if ≤14, otherwise every Nth */}
            {displayData.map((_, i) => {
              const interval = displayData.length <= 14 ? 1 : Math.ceil(displayData.length / 10)
              if (i % interval !== 0 && i !== displayData.length - 1) return null
              return <text key={i} x={padX + i * stepX} y={padY + chartH + 20} textAnchor="middle" fill="#64748b" fontSize="9">{displayLabels[i]}</text>
            })}
          </>
        )
      })()}
    </svg>
    </div>
  )
}

function ProjectBarChart({ projects }: { projects: any[] }) {
  const sorted = [...projects].filter(p => (p.token_count || 0) > 0).sort((a, b) => b.token_count - a.token_count)
  if (sorted.length === 0) return <div className="h-[220px] flex items-center justify-center text-xs text-gray-600">暂无项目 Token 数据</div>
  const max = sorted[0]?.token_count || 1
  const barW = Math.max(40, Math.min(64, 600 / sorted.length))
  const svgW = Math.max(680, sorted.length * (barW + 16) + 60)
  const barColors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#ef4444', '#6366f1']

  return (
    <div className="h-[220px] overflow-x-auto overflow-y-hidden">
      <svg width={svgW} height="220" viewBox={`0 0 ${svgW} 220`} className="overflow-visible">
        <defs>
          {barColors.map((c, i) => (
            <linearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.9" />
              <stop offset="100%" stopColor={c} stopOpacity="0.35" />
            </linearGradient>
          ))}
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = 180 - pct * 160
          return (
            <g key={i}>
              <line x1="44" y1={y} x2={svgW - 16} y2={y} stroke="#1e293b" strokeWidth="1" opacity="0.5" strokeDasharray={i === 0 ? "" : "3,6"} />
              <text x="40" y={y + 4} textAnchor="end" fill="#64748b" fontSize="9" fontFamily="monospace">{formatTokens(max * pct)}</text>
            </g>
          )
        })}
        {/* Bars */}
        {sorted.map((p, i) => {
          const x = 54 + i * (barW + 16)
          const barH = (p.token_count / max) * 160
          const y = 180 - barH
          const c = barColors[i % barColors.length]
          return (
            <g key={p.id}>
              <rect x={x} y={y} width={barW} height={barH} rx="4" fill={`url(#barGrad${i % barColors.length})`} />
              <rect x={x} y={y} width={barW} height={barH} rx="4" fill="none" stroke={c} strokeWidth="1" opacity="0.3" />
              <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill={c} fontSize="10" fontWeight="600">{formatTokens(p.token_count)}</text>
              <text x={x + barW / 2} y="202" textAnchor="middle" fill="#94a3b8" fontSize="9" transform={`rotate(-25, ${x + barW / 2}, 200)`}>
                {p.name.length > 10 ? p.name.slice(0, 10) + '..' : p.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { setCurrentProject, currentDepartmentId, user } = useAppStore()
  const [projects, setProjects] = useState<any[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tokenStats, setTokenStats] = useState<any>(null)
  const [chartView, setChartView] = useState<'trend' | 'project'>('trend')
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [projectFilter, setProjectFilter] = useState<'all' | 'active'>('all')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0])
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const isAdmin = user?.role === 'super_admin' || user?.role === 'dept_admin'

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = currentDepartmentId ? `department_id=${currentDepartmentId}` : ''
      const [projData, folderData, stats] = await Promise.all([
        api.getProjects(params),
        api.getFolders(currentDepartmentId || undefined).catch(() => []),
        api.getTokenStats().catch(() => null),
      ])
      setProjects(projData || [])
      setFolders(folderData || [])
      setTokenStats(stats)
    } catch {} finally { setLoading(false) }
  }, [currentDepartmentId])

  useEffect(() => { loadData() }, [loadData])

  // Group projects by folder
  const folderedProjects = new Map<string | null, any[]>()
  for (const p of projects) {
    const key = p.folder_id || null
    if (!folderedProjects.has(key)) folderedProjects.set(key, [])
    folderedProjects.get(key)!.push(p)
  }
  const unfoldered = folderedProjects.get(null) || []

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || !currentDepartmentId) return
    try {
      await api.createFolder({ name: newFolderName.trim(), color: newFolderColor, department_id: currentDepartmentId })
      setNewFolderName(''); setShowNewFolder(false); loadData()
    } catch {}
  }

  const deleteFolder = async (id: string) => {
    if (!confirm('删除文件夹？项目不会被删除，只会移出文件夹。')) return
    try { await api.deleteFolder(id); loadData() } catch {}
  }

  const updateFolder = async (id: string) => {
    if (!editName.trim()) return
    try { await api.updateFolder(id, { name: editName.trim(), color: editColor }); setEditingFolder(null); loadData() } catch {}
  }

  const moveProjectToFolder = async (projectId: string, folderId: string | null) => {
    try { await api.moveProjectToFolder(projectId, folderId); loadData() } catch {}
  }

  const stats = {
    active: projects.filter((p: any) => p.status === 'active').length,
    archived: projects.filter((p: any) => p.status === 'archived').length,
    total: projects.length,
  }

  // Build daily chart data (last 14 days)
  const chartData = tokenStats?.daily
    ? Object.entries(tokenStats.daily).slice(-14).map(([_, v]: any) => v)
    : []

  const ProjectCard = ({ p }: { p: any }) => (
    <button
      onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`) }}
      className="text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-all hover:shadow-lg w-full"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-white truncate text-sm">{p.name}</h3>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ml-2 ${
          p.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'
        }`}>
          {p.status === 'active' ? '进行中' : '已归档'}
        </span>
      </div>
      {p.description && <p className="text-xs text-gray-400 mb-2 line-clamp-1">{p.description}</p>}
      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{p.message_count || 0}</span>
        <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{p.artifact_count || 0}</span>
        {(p.token_count || 0) > 0 && (
          <span className="flex items-center gap-1 text-amber-400"><Zap className="w-3 h-3" />{formatTokens(p.token_count)}</span>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{p.department_name}</span>
        <span className="text-[10px] text-gray-500">@{p.owner_name}</span>
      </div>
    </button>
  )

  const FolderSection = ({ folder }: { folder: FolderItem }) => {
    const projs = folderedProjects.get(folder.id) || []
    const isOpen = expandedFolders.has(folder.id)
    const isEditing = editingFolder === folder.id
    return (
      <div className="border border-gray-800 rounded-xl overflow-hidden mb-3" style={{ borderColor: folder.color + '30' }}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900/80" style={{ borderLeft: `3px solid ${folder.color}` }}>
          <button onClick={() => toggleFolder(folder.id)} className="text-gray-400 hover:text-white transition-colors">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <Folder className="w-4 h-4 shrink-0" style={{ color: folder.color }} />
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <input value={editName} onChange={e => setEditName(e.target.value)} className="bg-gray-800 text-white text-sm px-2 py-0.5 rounded border border-gray-700 flex-1" autoFocus />
              <div className="flex gap-1">
                {FOLDER_COLORS.map(c => (
                  <button key={c} onClick={() => setEditColor(c)} className={`w-4 h-4 rounded-full border-2 ${editColor === c ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
              <button onClick={() => updateFolder(folder.id)} className="text-xs text-green-400 hover:text-green-300">保存</button>
              <button onClick={() => setEditingFolder(null)} className="text-xs text-gray-400 hover:text-gray-300">取消</button>
            </div>
          ) : (
            <>
              <span className="text-sm font-medium text-white flex-1">{folder.name}</span>
              <span className="text-[10px] text-gray-400">{projs.length} 个工作流</span>
              {isAdmin && (
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => { setEditingFolder(folder.id); setEditName(folder.name); setEditColor(folder.color) }}
                    className="p-1 rounded text-gray-600 hover:text-gray-400 transition-colors"><Palette className="w-3 h-3" /></button>
                  <button onClick={() => deleteFolder(folder.id)}
                    className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                </div>
              )}
            </>
          )}
        </div>
        {isOpen && (
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 bg-gray-950/50">
            {projs.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">工作台</h1>
        <p className="text-sm text-gray-500 mt-1">管理您的工作流与 AI 协作</p>
      </div>

      {/* Token Stats + Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
          {[
            { icon: FolderOpen, label: '活跃工作流', value: stats.active, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { icon: Archive, label: '已归档', value: stats.archived, color: 'text-purple-400', bg: 'bg-purple-500/10' },
            { icon: Clock, label: '工作流总数', value: stats.total, color: 'text-green-400', bg: 'bg-green-500/10' },
          ].map((stat) => (
            <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center">
              <div className="flex items-center gap-3 flex-1">
                <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center`}>
                  <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
                </div>
                <span className="text-sm text-gray-300 font-medium">{stat.label}</span>
              </div>
              <span className="text-xl font-bold text-white ml-4">{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Token stats chart */}
        <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5 relative overflow-hidden">
          {/* Subtle grid background */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

          {/* Header */}
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5">
                <button onClick={() => setChartView('trend')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${chartView === 'trend' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500 hover:text-gray-300'}`}>
                  <TrendingUp className="w-3 h-3 inline mr-1" />趋势
                </button>
                <button onClick={() => setChartView('project')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${chartView === 'project' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-500 hover:text-gray-300'}`}>
                  <BarChart3 className="w-3 h-3 inline mr-1" />项目
                </button>
              </div>
              {chartView === 'trend' && (
                <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5 ml-2">
                  {(['daily', 'weekly', 'monthly'] as const).map(p => (
                    <button key={p} onClick={() => setChartPeriod(p)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${chartPeriod === p ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {{ daily: '日', weekly: '周', monthly: '月' }[p]}
                    </button>
                  ))}
                </div>
              )}
              {chartView === 'project' && (
                <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5 ml-2">
                  {(['all', 'active'] as const).map(f => (
                    <button key={f} onClick={() => setProjectFilter(f)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${projectFilter === f ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {f === 'all' ? '全部项目' : '进行中'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-5 text-[11px]">
              <span className="text-gray-500">7天 <span className="text-blue-400 font-semibold">{formatTokens(tokenStats?.total_7d || 0)}</span></span>
              <span className="text-gray-500">30天 <span className="text-amber-400 font-semibold">{formatTokens(tokenStats?.total_30d || 0)}</span></span>
              <span className="text-gray-500">总计 <span className="text-green-400 font-semibold">{formatTokens(tokenStats?.total_all || 0)}</span></span>
            </div>
          </div>

          {/* Chart area */}
          <div className="relative" style={{ height: chartView === 'trend' ? 220 : 'auto' }}>
            {chartView === 'trend' ? (() => {
              const daily = tokenStats?.daily || {}
              const entries = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
              let labels: string[] = []; let values: number[] = []
              if (chartPeriod === 'daily') {
                labels = entries.map(([d]) => d.slice(5)); values = entries.map(([_, v]) => v as number)
              } else if (chartPeriod === 'weekly') {
                const weeks = new Map<string, number>()
                entries.forEach(([d, v]) => { const dt = new Date(d); const ws = new Date(dt); ws.setDate(dt.getDate() - dt.getDay()); const k = ws.toISOString().slice(5, 10); weeks.set(k, (weeks.get(k) || 0) + (v as number)) })
                labels = [...weeks.keys()].map(k => k + '周'); values = [...weeks.values()]
              } else {
                const months = new Map<string, number>()
                entries.forEach(([d, v]) => { const k = d.slice(0, 7); months.set(k, (months.get(k) || 0) + (v as number)) })
                labels = [...months.keys()].map(k => k.slice(5)); values = [...months.values()]
              }
              return <SparkLineChart data={values} labels={labels} color="#f59e0b" />
            })() : (
              <ProjectBarChart projects={projectFilter === 'active' ? projects.filter((p: any) => p.status === 'active') : projects} />
            )}
          </div>
        </div>
      </div>

      {/* Project List with Folders */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">全部工作流</h2>
          {isAdmin && (
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 新建文件夹
            </button>
          )}
        </div>

        {/* New folder input */}
        {showNewFolder && (
          <div className="mb-4 p-3 bg-gray-900 border border-gray-800 rounded-xl flex items-center gap-3">
            <Folder className="w-4 h-4 text-gray-500" />
            <input
              value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              placeholder="文件夹名称" autoFocus
              className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700 flex-1 focus:outline-none focus:border-blue-500"
              onKeyDown={e => e.key === 'Enter' && createFolder()}
            />
            <div className="flex gap-1">
              {FOLDER_COLORS.map(c => (
                <button key={c} onClick={() => setNewFolderColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${newFolderColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <button onClick={createFolder} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">创建</button>
            <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-400">取消</button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-xl">
            <FolderOpen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">暂无工作流</p>
            <p className="text-xs text-gray-600 mt-1">点击左侧「新建工作流」开始</p>
          </div>
        ) : (
          <>
            {/* Folder sections */}
            {folders.map(f => <FolderSection key={f.id} folder={f} />)}

            {/* Unfoldered projects */}
            {unfoldered.length > 0 && (
              <div className="mb-3">
        <div className="flex items-center gap-2 px-1 mb-2">
          <FolderOpen className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-400 uppercase tracking-wider">未归类</span>
          <span className="text-[10px] text-gray-500">({unfoldered.length})</span>
        </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {unfoldered.map(p => <ProjectCard key={p.id} p={p} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
