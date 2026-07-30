import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { useThemeStore } from '../../store/theme'
import { api } from '../../services/api'
import { ChevronDown, Settings } from 'lucide-react'
import SettingsModal from '../settings/SettingsModal'

interface Department {
  id: string
  name: string
}

export default function Header() {
  const { user, logout } = useAuthStore()
  const { setCurrentDepartment, currentDepartmentId } = useAppStore()
  const navigate = useNavigate()
  const [departments, setDepartments] = useState<Department[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'account' | 'theme' | 'model'>('account')

  useEffect(() => {
    api.getDepartments().then((depts) => {
      setDepartments(depts)
    }).catch(() => {})
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const visibleDepartments = user?.role === 'super_admin'
    ? departments
    : departments.filter(d => d.id === user?.department_id)

  const currentDeptName = departments.find(d => d.id === currentDepartmentId)?.name
    || departments.find(d => d.id === user?.department_id)?.name
    || ''

  return (
    <>
      <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0 z-50">
        {/* Left: Logo & Name */}
        <div className="flex items-center gap-4">
          {/* Sleek SVG Logo */}
          <div className="flex items-center gap-2.5">
            <svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M32 4L58 19V49L32 64L6 49V19L32 4Z"
                fill="url(#logoGrad)" stroke="url(#logoStroke)" strokeWidth="2"/>
              <text x="32" y="42" textAnchor="middle"
                fill="white" fontSize="28" fontWeight="900" fontFamily="system-ui, sans-serif">
                Z
              </text>
              <defs>
                <linearGradient id="logoGrad" x1="6" y1="4" x2="58" y2="64" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1"/>
                  <stop offset="0.5" stopColor="#8b5cf6"/>
                  <stop offset="1" stopColor="#a855f7"/>
                </linearGradient>
                <linearGradient id="logoStroke" x1="6" y1="4" x2="58" y2="64" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818cf8"/>
                  <stop offset="1" stopColor="#c084fc"/>
                </linearGradient>
              </defs>
            </svg>
            <span className="text-sm font-bold text-white tracking-wide">
              智影<span className="text-indigo-400">·</span>Agent工作平台
            </span>
          </div>

          {/* Department Switcher */}
          <div className="relative">
            <select
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none cursor-pointer pr-8"
              value={currentDepartmentId || ''}
              onChange={(e) => setCurrentDepartment(e.target.value || null)}
              disabled={user?.role === 'member'}
            >
              {user?.role === 'super_admin' && (
                <option value="">全部部门</option>
              )}
              {visibleDepartments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          </div>

          {currentDeptName && (
            <span className="text-xs px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-full">
              {currentDeptName}
            </span>
          )}
        </div>

        {/* Right: Settings + User */}
        <div className="flex items-center gap-2">
          {/* Settings button */}
          <button
            onClick={() => { setSettingsTab('theme'); setShowSettings(true) }}
            className="w-8 h-8 rounded-lg hover:bg-gray-800 flex items-center justify-center transition-colors text-gray-400"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* User area — click to open settings */}
          <button
            onClick={() => { setSettingsTab('account'); setShowSettings(true) }}
            className="flex items-center gap-2 hover:bg-gray-800 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              {(() => { const s = user?.display_name || user?.username || 'U'; const ch = [...s][0] || 'U'; return /\p{Emoji}/u.test(ch) ? ch : ch.toUpperCase() })()}
            </div>
            <div className="hidden sm:flex flex-col items-start">
              <span className="text-xs font-medium text-gray-300">{user?.display_name}</span>
              <span className="text-[10px] text-gray-500">
                {user?.role === 'super_admin' ? '超级管理员' :
                 user?.role === 'dept_admin' ? '部门主管' : '成员'}
              </span>
            </div>
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      <SettingsModal show={showSettings} onClose={() => setShowSettings(false)} defaultTab={settingsTab} />
    </>
  )
}
