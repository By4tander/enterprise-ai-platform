import React, { useState, useRef, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, RotateCw, Download, Maximize2 } from 'lucide-react'

interface ImageViewerProps {
  src: string
  filename: string
  onClose: () => void
}

export default function ImageViewer({ src, filename, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setScale(s => Math.min(5, Math.max(0.2, s + delta)))
  }

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y }
  }
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging) return
      setPosition({
        x: dragStart.current.posX + (e.clientX - dragStart.current.x),
        y: dragStart.current.posY + (e.clientY - dragStart.current.y),
      })
    }
    const handleUp = () => setIsDragging(false)
    if (isDragging) {
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    }
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [isDragging])

  const resetView = () => { setScale(1); setRotation(0); setPosition({ x: 0, y: 0 }) }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[101] flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-900/90 border border-gray-700 backdrop-blur-sm shadow-xl">
        <button onClick={() => setScale(s => Math.min(5, s + 0.25))} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="放大">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => setScale(s => Math.max(0.2, s - 0.25))} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="缩小">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-400 px-2 min-w-[48px] text-center">{Math.round(scale * 100)}%</span>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button onClick={() => setRotation(r => r + 90)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="旋转">
          <RotateCw className="w-4 h-4" />
        </button>
        <button onClick={resetView} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="重置">
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <a href={src} download={filename} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="下载">
          <Download className="w-4 h-4" />
        </a>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-1" title="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filename */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[101] px-3 py-1.5 rounded-lg bg-gray-900/80 border border-gray-700 text-xs text-gray-400">
        {filename}
      </div>

      {/* Image */}
      <div
        ref={containerRef}
        className="relative z-[100] cursor-grab active:cursor-grabbing select-none"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        <img
          src={src}
          alt={filename}
          draggable={false}
          className="max-w-[85vw] max-h-[85vh] object-contain"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease',
          }}
          onDoubleClick={resetView}
        />
      </div>
    </div>
  )
}
