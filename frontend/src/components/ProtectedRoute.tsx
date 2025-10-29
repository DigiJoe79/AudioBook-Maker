
import { Navigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isBackendConnected = useAppStore((state) => state.connection.isConnected)
  const currentBackendUrl = useAppStore((state) => state.connection.url)

  console.log('[ProtectedRoute] Checking access', {
    isBackendConnected,
    currentBackendUrl,
  })

  if (!isBackendConnected) {
    console.log('[ProtectedRoute] Access denied - redirecting to /')
    return <Navigate to="/" replace />
  }

  console.log('[ProtectedRoute] Access granted - rendering children')
  return <>{children}</>
}
