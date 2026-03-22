import { AppShell } from './components/layout/AppShell'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { useTheme } from './hooks/useTheme'
import { useSidecar } from './hooks/useSidecar'
import logo from './assets/logo.png'
import './App.css'

function App() {
  useTheme()
  const { ready } = useSidecar()

  // Loading state while sidecar connects
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center space-y-4">
          <img src={logo} alt="小龙虾" className="w-16 h-16 mx-auto animate-bounce" />
          <p className="text-sm text-zinc-500">正在启动小龙虾...</p>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}

export default App
