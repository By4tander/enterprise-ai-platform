import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore, useVideoStore } from './store'
import { useThemeStore } from './store/theme'
import MainLayout from './components/layout/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ProjectView from './pages/ProjectView'
import AgentResourceHub from './pages/AgentResourceHub'
import HermesGlobalSkills from './pages/HermesGlobalSkills'
import AIToolsPage from './pages/AIToolsPage'
import FloatingWindow from './components/media/FloatingWindow'
import VideoPlayer from './components/media/VideoPlayer'
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  if (!isAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GlobalVideoPlayer() {
  const videoSrc = useVideoStore(s => s.videoSrc)
  const setVideoSrc = useVideoStore(s => s.setVideoSrc)
  if (!videoSrc) return null
  return (
    <FloatingWindow
      title={videoSrc.name}
      onClose={() => setVideoSrc(null)}
      initialWidth={480}
      initialHeight={340}
    >
      <VideoPlayer
        src={videoSrc.src}
        filename={videoSrc.name}
        onClose={() => setVideoSrc(null)}
        compact
      />
    </FloatingWindow>
  )
}

function App() {
  const theme = useThemeStore((s) => s.theme)
  return (
    <BrowserRouter>
      <GlobalVideoPlayer />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <div className={theme}>
                <MainLayout />
              </div>
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="project/:projectId" element={<ProjectView />} />
          <Route path="skills" element={<AgentResourceHub />} />
          <Route path="global-skills" element={<HermesGlobalSkills />} />
          <Route path="ai-tools" element={<AIToolsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
