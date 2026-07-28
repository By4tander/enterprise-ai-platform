import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { useThemeStore } from '../../store/theme'
import { api } from '../../services/api'
import { ChevronDown, LogOut, Settings, Sun, Moon } from 'lucide-react'

interface Department {
  id: string
  name: string
}

export default function Header() {
  const { user, logout } = useAuthStore()
  const { setCurrentDepartment, currentDepartmentId } = useAppStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()
  const [departments, setDepartments] = useState<Department[]>([])
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

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
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0 z-50">
      {/* Left: Logo & Name */}
      <div className="flex items-center gap-4">
        {/* Sleek SVG Logo */}
        <div className="flex items-center gap-2.5">
          <svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Outer hexagon ring */}
            <path d="M32 4L58 19V49L32 64L6 49V19L32 4Z" 
              fill="url(#logoGrad)" stroke="url(#logoStroke)" strokeWidth="2"/>
            {/* Inner Z character */}
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
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 rounded-lg hover:bg-gray-800 flex items-center justify-center transition-colors text-gray-400"
          >
            <Settings className="w-4 h-4" />
          </button>
          {showSettings && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 py-1">
                <div className="px-3 py-2 border-b border-gray-700">
                  <p className="text-xs text-gray-400 font-medium">外观设置</p>
                </div>
                <button
                  onClick={() => { theme !== 'dark' && toggle(); setShowSettings(false) }}
                  className={`w-full px-3 py-2 text-sm flex items-center gap-2.5 text-left transition-colors ${
                    theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400' : 'text-gray-300 hover:bg-gray-700'
                  }`}>
                  <Moon className="w-4 h-4" /> 暗色模式
                  {theme === 'dark' && <span className="ml-auto text-[10px] text-indigo-400">✓</span>}
                </button>
                <button
                  onClick={() => { theme !== 'light' && toggle(); setShowSettings(false) }}
                  className={`w-full px-3 py-2 text-sm flex items-center gap-2.5 text-left transition-colors ${
                    theme === 'light' ? 'bg-indigo-500/10 text-indigo-400' : 'text-gray-300 hover:bg-gray-700'
                  }`}>
                  <Sun className="w-4 h-4" /> 明亮模式
                  {theme === 'light' && <span className="ml-auto text-[10px] text-indigo-400">✓</span>}
                </button>
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              {(user?.display_name || user?.username || 'U')[0].toUpperCase()}
            </div>
            <div className="hidden sm:flex flex-col items-start">
              <span className="text-xs font-medium text-gray-300">{user?.display_name}</span>
              <span className="text-[10px] text-gray-500">
                {user?.role === 'super_admin' ? '超级管理员' :
                 user?.role === 'dept_admin' ? '部门主管' : '成员'}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 py-1">
                <div className="px-3 py-2 border-b border-gray-700">
                  <p className="text-sm text-gray-200">{user?.display_name}</p>
                  <p className="text-xs text-gray-500">@{user?.username}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2 text-left"
                >
                  <LogOut className="w-4 h-4" /> 退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
