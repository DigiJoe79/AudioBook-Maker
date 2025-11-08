/**
 * ProtectedRoute - Route Guard Component
 *
 * Ensures that certain routes (like /app) are only accessible
 * when a backend connection is established.
 *
 * If not connected, automatically redirects to the start page.
 */

import { Navigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { logger } from '../utils/logger'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isBackendConnected = useAppStore((state) => state.connection.isConnected)
  const currentBackendUrl = useAppStore((state) => state.connection.url)

  logger.group('🔒 Access', 'Validating route access', {
    'Backend Connected': isBackendConnected,
    'Backend URL': currentBackendUrl || 'None'
  }, '#2196F3')

  if (!isBackendConnected) {
    logger.warn('[ProtectedRoute] Access denied - redirecting to /')
    // Redirect to start page if not connected
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
