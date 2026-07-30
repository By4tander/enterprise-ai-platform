import { useState, useEffect, useMemo } from 'react'
import { useAuthStore, useAppStore } from '../../store'
import { useThemeStore } from '../../store/theme'
import { api } from '../../services/api'
import { hasPermission } from '../../utils/permissions'
import {
  X, User, Palette, Cpu, Sun, Moon, Eye, EyeOff, Save, Plus,
  Users, ChevronRight, ChevronDown, Check, Loader2, Key, UserPlus, LogOut, Settings, Trash2
} from 'lucide-react'

type TabKey = 'account' | 'theme' | 'model'

interface SettingsModalProps {
  show: boolean
  onClose: () => void
  defaultTab?: TabKey
}

// ── Pinyin mapping for departments ──
const DEPT_PINYIN: Record<string, string> = { '编剧部': 'bianju', '美术部': 'meishu', '发行部': 'faxing', '综合部': 'zonghe' }

export default function SettingsModal({ show, onClose, defaultTab = 'account' }: SettingsModalProps) {
  const { user, logout } = useAuthStore()
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab)

  if (!show) return null

  const tabs: { key: TabKey; label: string; icon: typeof User; adminOnly?: boolean }[] = [
    { key: 'account', label: '账号管理', icon: User },
    { key: 'theme', label: '外观主题', icon: Palette },
    { key: 'model', label: '模型配置', icon: Cpu, adminOnly: true },
  ]
  const visibleTabs = tabs.filter(t => !t.adminOnly || hasPermission(user?.role, 'user.manage'))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl w-[800px] h-[560px] flex shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* ── Sidebar ── */}
        <div className="w-52 shrink-0 sidebar-bg border-r border-gray-200 flex flex-col">
          {/* User info */}
          <div className="p-5 border-b border-gray-200">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold mb-3 shadow-lg shadow-indigo-500/20">
              {(() => { const s = user?.display_name || user?.username || 'U'; const ch = [...s][0] || 'U'; return /\p{Emoji}/u.test(ch) ? ch : ch.toUpperCase() })()}
            </div>
            <p className="text-sm font-semibold text-white truncate">{user?.display_name}</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">@{user?.username}</p>
            <span className="inline-block text-[10px] px-2 py-0.5 mt-2 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {user?.role === 'super_admin' ? '超级管理员' : user?.role === 'dept_admin' ? '部门主管' : '成员'}
            </span>
          </div>
          {/* Tab list */}
          <nav className="flex-1 p-3 space-y-0.5">
            {visibleTabs.map(tab => {
              const Icon = tab.icon
              const active = activeTab === tab.key
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active ? 'bg-indigo-500/10 text-indigo-400' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                  }`}>
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {active && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
                </button>
              )
            })}
          </nav>
          {/* Logout */}
          <div className="p-3 border-t border-gray-200">
            <button onClick={() => { logout(); onClose() }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors">
              <LogOut className="w-4 h-4" />退出登录
            </button>
          </div>
        </div>
        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'account' && <AccountTab />}
          {activeTab === 'theme' && <ThemeTab />}
          {activeTab === 'model' && <ModelTab />}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   Tab 1: Account Management
   ═══════════════════════════════════════════════════ */

function AccountTab() {
  const { user, setAuth, token } = useAuthStore()
  const isAdmin = hasPermission(user?.role, 'user.manage')

  // Profile editing
  const [editUsername, setEditUsername] = useState(user?.username || '')
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)

  // Admin: user list
  const [users, setUsers] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [createData, setCreateData] = useState({ username: '', display_name: '', password: '', department_id: '', role: 'dept_admin' })
  const [createMsg, setCreateMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetPwdTarget, setResetPwdTarget] = useState<any | null>(null)
  const [resetPwdValue, setResetPwdValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (isAdmin) {
      api.getUsers().then(setUsers).catch(() => {})
      api.getDepartments().then(setDepartments).catch(() => {})
    }
  }, [isAdmin])

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users
    const q = searchQuery.toLowerCase()
    return users.filter(u => u.username.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q))
  }, [users, searchQuery])

  const handleSaveAll = async () => {
    setSaving(true); setMsg(null)
    try {
      const updates: any = {}
      // Username change
      if (editUsername !== user!.username) {
        if (editUsername.length < 2) { setMsg({ type: 'err', text: '用户名至少2个字符' }); setSaving(false); return }
        updates.username = editUsername
      }
      // Display name change
      if (displayName !== user!.display_name) {
        updates.display_name = displayName
      }
      // Password change
      if (newPwd) {
        if (!currentPwd) { setMsg({ type: 'err', text: '修改密码需填写当前密码' }); setSaving(false); return }
        if (newPwd.length < 4) { setMsg({ type: 'err', text: '新密码至少4个字符' }); setSaving(false); return }
        updates.current_password = currentPwd
        updates.password = newPwd
      }
      if (Object.keys(updates).length === 0) { setMsg({ type: 'ok', text: '无变更' }); setSaving(false); return }
      await api.updateUser(user!.id, updates)
      setAuth(token!, { ...user!, display_name: displayName, username: editUsername })
      setCurrentPwd(''); setNewPwd('')
      setMsg({ type: 'ok', text: '已保存' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const handleDeleteUser = async (u: any) => {
    try {
      await api.deleteUser(u.id)
      setUsers(prev => prev.filter(x => x.id !== u.id))
      setDeleteTarget(null)
    } catch (e: any) { alert(e.message) }
  }

  const getDefaultPassword = (u: any) => {
    const dept = departments.find(d => d.id === u.department_id)
    const deptPinyin = DEPT_PINYIN[dept?.name || ''] || 'user'
    if (u.role === 'dept_admin') return deptPinyin
    return deptPinyin + '123'
  }

  const handleResetPassword = async (u: any) => {
    const pwd = resetPwdValue || getDefaultPassword(u)
    try {
      await api.updateUser(u.id, { password: pwd })
      setResetPwdTarget(null); setResetPwdValue('')
      alert(`已重置「${u.display_name}」的密码为：${pwd}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleCreateUser = async () => {
    if (!createData.username || !createData.password || !createData.department_id) {
      setCreateMsg({ type: 'err', text: '请填写完整信息' }); return
    }
    setCreating(true); setCreateMsg(null)
    try {
      await api.register(createData)
      setCreateMsg({ type: 'ok', text: '创建成功' })
      setCreateData({ username: '', display_name: '', password: '', department_id: '', role: 'dept_admin' })
      api.getUsers().then(setUsers).catch(() => {})
      setTimeout(() => setShowCreate(false), 1000)
    } catch (e: any) { setCreateMsg({ type: 'err', text: e.message }) }
    finally { setCreating(false) }
  }

  const getDeptName = (id: string) => departments.find(d => d.id === id)?.name || '—'

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-6">账号管理</h2>

      {/* ── Personal Info ── */}
      <div className="space-y-4 mb-8">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">登录用户名</label>
            <input value={editUsername} onChange={e => setEditUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">昵称</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">修改密码（可选）</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={showPwd ? 'text' : 'password'} value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} placeholder="当前密码"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500 placeholder-gray-600" />
            </div>
            <div className="relative flex-1">
              <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="新密码（至少4位）"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500 placeholder-gray-600" />
            </div>
            <button onClick={() => setShowPwd(!showPwd)} className="p-2 text-gray-500 hover:text-gray-300 transition-colors">
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          {msg && (
            <p className={`text-xs ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
          )}
          <div className="ml-auto">
            <button onClick={handleSaveAll} disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" />{saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Admin: All Accounts ── */}
      {isAdmin && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />全部账号
              <span className="text-[10px] text-gray-600 font-normal">({users.length})</span>
            </h3>
            <div className="flex items-center gap-2">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索..."
                className="px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-indigo-500 w-32" />
              <button onClick={() => setShowCreate(true)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1">
                <UserPlus className="w-3 h-3" />新建
              </button>
            </div>
          </div>

          {/* Create user form */}
          {showCreate && (
            <div className="mb-4 p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
              <p className="text-xs text-gray-400 mb-3">创建新账号</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <input value={createData.username} onChange={e => setCreateData({ ...createData, username: e.target.value })} placeholder="用户名（如：bianju）"
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
                <input value={createData.display_name} onChange={e => setCreateData({ ...createData, display_name: e.target.value })} placeholder="显示名称（如：编剧）"
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
                <input value={createData.password} onChange={e => setCreateData({ ...createData, password: e.target.value })} placeholder="密码"
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
                <select value={createData.department_id} onChange={e => setCreateData({ ...createData, department_id: e.target.value })}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500">
                  <option value="">选择部门</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={createData.role} onChange={e => setCreateData({ ...createData, role: e.target.value })}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500">
                  <option value="dept_admin">部门管理员</option>
                  <option value="member">普通成员</option>
                </select>
              </div>
              {createMsg && <p className={`text-xs mb-2 ${createMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{createMsg.text}</p>}
              <div className="flex gap-2">
                <button onClick={handleCreateUser} disabled={creating}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50">
                  {creating ? '创建中...' : '创建'}
                </button>
                <button onClick={() => { setShowCreate(false); setCreateMsg(null) }}
                  className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-300 transition-colors">取消</button>
              </div>
            </div>
          )}

          {/* Reset password modal */}
          {resetPwdTarget && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setResetPwdTarget(null)} />
              <div className="relative bg-gray-800 border border-gray-700 rounded-xl p-5 w-80 shadow-2xl">
                <p className="text-sm font-semibold text-white mb-2">重置密码 — {resetPwdTarget.display_name}</p>
                <p className="text-xs text-gray-400 mb-3">默认密码: <span className="text-indigo-400 font-mono">{getDefaultPassword(resetPwdTarget)}</span></p>
                <input value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)}
                  placeholder={`留空则使用默认密码`} autoFocus
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500 mb-4" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setResetPwdTarget(null)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300">取消</button>
                  <button onClick={() => handleResetPassword(resetPwdTarget)}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded-lg transition-colors">确认重置</button>
                </div>
              </div>
            </div>
          )}

          {/* Delete user confirmation */}
          {deleteTarget && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
              <div className="relative bg-gray-800 border border-red-500/30 rounded-xl p-5 w-80 shadow-2xl">
                <p className="text-sm font-semibold text-white mb-2">删除账号</p>
                <p className="text-xs text-gray-400 mb-4">确定要删除「<span className="text-white">{deleteTarget.display_name}</span>」(@{deleteTarget.username}) 吗？此操作不可恢复。</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300">取消</button>
                  <button onClick={() => handleDeleteUser(deleteTarget)}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors">确认删除</button>
                </div>
              </div>
            </div>
          )}

          {/* User list */}
          <div className="space-y-1 max-h-[320px] overflow-y-auto">
            {filteredUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors group">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-xs font-bold text-indigo-300">
                  {(() => { const s = u.display_name || u.username; const ch = [...s][0] || '?'; return /\p{Emoji}/u.test(ch) ? ch : ch.toUpperCase() })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{u.display_name} <span className="text-gray-600 text-xs">@{u.username}</span></p>
                  <p className="text-[10px] text-gray-500">{getDeptName(u.department_id)} · {
                    u.role === 'super_admin' ? '超级管理员' : u.role === 'dept_admin' ? '部门管理员' : '成员'
                  }</p>
                </div>
                {u.id !== user?.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => { setResetPwdTarget(u); setResetPwdValue('') }}
                      className="px-2 py-1 text-[10px] text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all flex items-center gap-1">
                      <Key className="w-3 h-3" />重置密码
                    </button>
                    {user?.role === 'super_admin' && (
                      <button onClick={() => setDeleteTarget(u)}
                        className="px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10 rounded-lg transition-all flex items-center gap-1">
                        <Trash2 className="w-3 h-3" />删除
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">无匹配结果</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   Tab 2: Theme
   ═══════════════════════════════════════════════════ */

function ThemeTab() {
  const { theme, toggle } = useThemeStore()

  const themes = [
    { key: 'dark', label: '暗色模式', desc: '低亮度，适合长时间工作', icon: Moon, gradient: 'from-gray-800 to-gray-900' },
    { key: 'light', label: '明亮模式', desc: '高亮度，适合明亮环境', icon: Sun, gradient: 'from-gray-100 to-gray-200' },
  ]

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-2">外观主题</h2>
      <p className="text-xs text-gray-500 mb-6">选择适合您的工作环境的主题风格</p>
      <div className="space-y-3">
        {themes.map(t => {
          const Icon = t.icon
          const active = theme === t.key
          return (
            <button key={t.key} onClick={() => { if (!active) toggle() }}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                active ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
              }`}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${t.gradient} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${active ? 'text-indigo-400' : t.key === 'dark' ? 'text-gray-400' : 'text-amber-500'}`} />
              </div>
              <div className="flex-1 text-left">
                <p className={`text-sm font-medium ${active ? 'text-indigo-400' : 'text-gray-300'}`}>{t.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
              </div>
              {active && <Check className="w-5 h-5 text-indigo-400" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   Tab 3: Model Configuration
   ═══════════════════════════════════════════════════ */

export interface ModelConfig {
  id: string
  name: string
  provider: string
  model_name: string
  api_key: string
  api_base: string
}

export const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', defaultBase: 'https://api.anthropic.com' },
  { value: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1' },
  { value: 'zhipu', label: '智谱 AI', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'qwen', label: '通义千问', defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'moonshot', label: 'Moonshot', defaultBase: 'https://api.moonshot.cn/v1' },
  { value: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1' },
  { value: 'custom', label: '自定义', defaultBase: '' },
]

export function getModelConfigs(): ModelConfig[] {
  try { return JSON.parse(localStorage.getItem('model_configs') || '[]') } catch { return [] }
}
export function saveModelConfigs(configs: ModelConfig[]) {
  localStorage.setItem('model_configs', JSON.stringify(configs))
}
export function getActiveModelId(): string {
  return localStorage.getItem('active_model_id') || ''
}
export function setActiveModelId(id: string) {
  localStorage.setItem('active_model_id', id)
}

/* ═══════════════════════════════════════════════════
   Tab 3 (new): Model Configuration → reads from Hermes
   ═══════════════════════════════════════════════════ */

function ModelTab() {
  const [models, setModels] = useState<any[]>([])
  const [current, setCurrent] = useState<{ model: string; provider: string }>({ model: '', provider: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setLoading(true)
    setError('')
    api.getAvailableModels().then(data => {
      const list = data.models || []
      setModels(list)
      setCurrent(data.current || { model: '', provider: '' })
      if (list.length > 0) {
        const active = list.find((m: any) => m.active)
        if (active) setExpanded({ [active.provider]: true })
      }
    }).catch((e: any) => {
      setError('加载模型失败: ' + (e.message || '请确认后端服务正常'))
    }).finally(() => setLoading(false))
  }, [])

  const handleSwitch = async (model: any) => {
    if (model.active) return
    setSwitching(true)
    try {
      await api.switchModel({ model: model.name, provider: model.provider, thinking: model.thinking, thinking_effort: model.thinking_effort })
      setModels(prev => prev.map(m => ({ ...m, active: m.id === model.id })))
      setCurrent({ model: model.name, provider: model.provider })
      window.dispatchEvent(new CustomEvent('model-switched', { detail: { from: current.model, to: model.name } }))
    } catch (e: any) {
      alert('切换失败: ' + (e.message || '未知错误'))
    } finally { setSwitching(false) }
  }

  // Group models by provider
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {}
    ;(models || []).forEach(m => {
      if (!groups[m.provider]) groups[m.provider] = []
      groups[m.provider].push(m)
    })
    return groups
  }, [models])

  const providerNames: Record<string, string> = { deepseek: 'DeepSeek', dashscope: '通义千问', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter' }

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-2">模型配置</h2>
      <p className="text-xs text-gray-500 mb-6">模型由 Hermes 管理，自动检测可用模型。API Key 安全存储在后端。</p>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-gray-500 animate-spin" /></div>
      ) : error ? (
        <div className="text-center py-12 bg-red-500/5 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 border border-gray-700 rounded-xl space-y-3">
          <Cpu className="w-10 h-10 text-gray-600 mx-auto" />
          <p className="text-sm text-gray-500">Hermes 尚未配置模型</p>
          <p className="text-xs text-gray-600">终端运行 <code className="text-indigo-400 bg-indigo-500/10 px-1 rounded">hermes provider add</code> 添加</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[340px] overflow-y-auto">
          <div className="p-3 rounded-xl border border-indigo-500/20 model-card-current">
            <p className="text-[10px] text-gray-500 mb-1">当前模型</p>
            <p className="text-sm font-semibold text-indigo-400">{current.model} <span className="text-xs text-gray-500 font-normal">· {current.provider}</span></p>
          </div>
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <div key={provider} className="border border-gray-700 rounded-xl overflow-hidden">
              <button onClick={() => setExpanded(prev => ({ ...prev, [provider]: !prev[provider] }))}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left model-card-group">
                <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded[provider] ? '' : '-rotate-90'}`} />
                <span className="text-xs font-medium text-gray-300">{providerNames[provider] || provider}</span>
                <span className="text-[10px] text-gray-600">({providerModels.length})</span>
              </button>
              {expanded[provider] && (
                <div className="px-2 pb-2 space-y-1">
                  {providerModels.map(m => (
                    <button key={m.id} onClick={() => handleSwitch(m)} disabled={switching}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                        m.active ? 'model-card-active cursor-default' : 'model-card hover:bg-gray-100 dark:hover:bg-gray-700/50'
                      }`}>
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        m.active ? 'bg-indigo-500/20 text-indigo-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }`}>{m.label[0]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs ${m.active ? 'text-indigo-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{m.label}</span>
                          {m.thinking && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">思考</span>}
                          {m.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full model-badge-active">当前</span>}
                        </div>
                        <p className="text-[10px] text-gray-500">{m.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
