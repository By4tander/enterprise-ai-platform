import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Maximize2, X, ExternalLink
} from 'lucide-react'

interface VideoPlayerProps {
  src: string
  filename: string
  onPopOut?: () => void
  onClose?: () => void
  compact?: boolean
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function VideoPlayer({ src, filename, onPopOut, onClose, compact }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)

  // Auto-play on mount
  useEffect(() => {
    videoRef.current?.play().catch(() => {})
    setPlaying(true)
  }, [src])

  // Time update
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const update = () => setCurrentTime(v.currentTime)
    const loaded = () => setDuration(v.duration)
    const ended = () => setPlaying(false)
    v.addEventListener('timeupdate', update)
    v.addEventListener('loadedmetadata', loaded)
    v.addEventListener('ended', ended)
    return () => { v.removeEventListener('timeupdate', update); v.removeEventListener('loadedmetadata', loaded); v.removeEventListener('ended', ended) }
  }, [src])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }, [])

  const seek = (sec: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.min(duration, Math.max(0, v.currentTime + sec))
  }

  const handleProgressClick = (e: React.MouseEvent) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || !duration) return
    const pct = (e.clientX - rect.left) / rect.width
    videoRef.current!.currentTime = pct * duration
  }

  const handleProgressHover = (e: React.MouseEvent) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || !duration) return
    const pct = (e.clientX - rect.left) / rect.width
    setHoverTime(pct * duration)
    setHoverX(e.clientX - rect.left)
  }

  const changeSpeed = (s: number) => {
    setSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
    setShowSpeedMenu(false)
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(!muted)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) { videoRef.current.volume = val; videoRef.current.muted = val === 0 }
    setMuted(val === 0)
  }

  const progress = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-col h-full bg-black/90 rounded-lg overflow-hidden">
      {/* Header — hidden in compact mode (FloatingWindow provides its own) */}
      {!compact && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/80 border-b border-gray-800 shrink-0">
          <span className="text-[11px] text-gray-400 truncate flex-1">{filename}</span>
          {onPopOut && (
            <button onClick={onPopOut} className="p-1 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors" title="独立窗口">
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="关闭">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Video */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          className="max-w-full max-h-full object-contain"
          preload="metadata"
        />
        {/* Play/Pause overlay */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="shrink-0 bg-gray-900/90 px-3 py-2 space-y-1.5">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1.5 bg-gray-700 rounded-full cursor-pointer group hover:h-2.5 transition-all"
          onClick={handleProgressClick}
          onMouseMove={handleProgressHover}
          onMouseLeave={() => setHoverTime(null)}
        >
          <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
          />
          {/* Hover time tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-7 px-1.5 py-0.5 bg-gray-800 text-[10px] text-white rounded shadow whitespace-nowrap pointer-events-none"
              style={{ left: hoverX, transform: 'translateX(-50%)' }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1">
          <button onClick={togglePlay} className="p-1 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors">
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => seek(-5)} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="后退5秒">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => seek(5)} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="快进5秒">
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <span className="text-[10px] text-gray-400 px-1.5 font-mono">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Volume */}
          <button onClick={toggleMute} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
            {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <input
            type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-14 h-1 accent-blue-500 cursor-pointer"
          />

          {/* Speed */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border border-gray-700"
            >
              {speed}x
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={`block w-full px-4 py-1.5 text-[11px] text-left transition-colors ${
                      s === speed ? 'bg-blue-500/20 text-blue-300' : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
