import { useState, useRef, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'

export default function MainLayout() {
  const [leftWidth, setLeftWidth] = useState(240)
  const [collapsed, setCollapsed] = useState(false)
  const resizeRef = useRef<{ startX: number; startSize: number } | null>(null)

  // Left sidebar resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = e.clientX - resizeRef.current.startX
      setLeftWidth(Math.max(160, Math.min(400, resizeRef.current.startSize + delta)))
    }
    const onUp = () => { resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        {!collapsed && (
          <>
            <div style={{ width: leftWidth }} className="shrink-0 flex flex-col">
              <Sidebar />
              {/* Collapse button — inside sidebar at bottom */}
              <button
                onClick={() => setCollapsed(true)}
                className="h-8 flex items-center justify-center hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-200 border-t border-gray-800 shrink-0"
                title="收起侧栏">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            {/* Resize handle */}
            <div
              className="w-1 hover:w-1.5 cursor-col-resize hover:bg-indigo-500/30 transition-all shrink-0 relative group bg-gray-800"
              onMouseDown={(e) => {
                e.preventDefault()
                resizeRef.current = { startX: e.clientX, startSize: leftWidth }
              }}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          </>
        )}
        {/* Expand button when collapsed */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="shrink-0 w-8 flex items-start pt-3 justify-center hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-200"
            title="展开侧栏">
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
