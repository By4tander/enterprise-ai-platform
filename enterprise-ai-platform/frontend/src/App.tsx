import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store'
import { useThemeStore } from './store/theme'
import MainLayout from './components/layout/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ProjectView from './pages/ProjectView'
import AgentResourceHub from './pages/AgentResourceHub'
import HermesGlobalSkills from './pages/HermesGlobalSkills'
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  if (!isAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}

function App() {
  const theme = useThemeStore((s) => s.theme)
  return (
    <BrowserRouter>
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
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
