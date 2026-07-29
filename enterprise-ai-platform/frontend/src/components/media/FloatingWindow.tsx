import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Minimize2, GripHorizontal } from 'lucide-react'

interface FloatingWindowProps {
  children: React.ReactNode
  title?: string
  onClose?: () => void
  initialWidth?: number
  initialHeight?: number
  initialX?: number
  initialY?: number
}

export default function FloatingWindow({
  children, title, onClose, initialWidth = 480, initialHeight = 320, initialX, initialY,
}: FloatingWindowProps) {
  const [pos, setPos] = useState({
    x: initialX ?? window.innerWidth - initialWidth - 24,
    y: initialY ?? window.innerHeight - initialHeight - 80,
  })
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  // Drag
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y }
  }, [pos])

  useEffect(() => {
    if (!isDragging) return
    const move = (e: MouseEvent) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, dragStart.current.posX + (e.clientX - dragStart.current.x))),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragStart.current.posY + (e.clientY - dragStart.current.y))),
      })
    }
    const up = () => setIsDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [isDragging])

  // Resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  useEffect(() => {
    if (!isResizing) return
    const move = (e: MouseEvent) => {
      setSize({
        w: Math.max(280, resizeStart.current.w + (e.clientX - resizeStart.current.x)),
        h: Math.max(180, resizeStart.current.h + (e.clientY - resizeStart.current.y)),
      })
    }
    const up = () => setIsResizing(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [isResizing])

  return (
    <div
      className="fixed z-[200] flex flex-col rounded-xl overflow-hidden shadow-2xl border border-gray-700 bg-gray-900"
      style={{
        left: pos.x, top: pos.y, width: size.w, height: size.h,
        transition: (isDragging || isResizing) ? 'none' : 'box-shadow 0.2s',
        boxShadow: (isDragging || isResizing) ? '0 25px 50px -12px rgba(0,0,0,0.6)' : '0 20px 40px -12px rgba(0,0,0,0.5)',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 cursor-move shrink-0 select-none"
        onMouseDown={handleDragStart}
      >
        <GripHorizontal className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-[11px] text-gray-400 truncate flex-1">{title || '浮动窗口'}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title="收回面板"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
        onMouseDown={handleResizeStart}
      >
        <svg className="w-4 h-4 text-gray-600" viewBox="0 0 16 16">
          <path d="M14 16L16 14M10 16L16 10M6 16L16 6" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  )
}
