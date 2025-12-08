/**
 * ProtectedRoute - Route Guard Component
 *
 * Ensures that certain routes (like /app) are only accessible
 * when a backend connection is established.
 *
 * If not connected, automatically redirects to the start page.
 */

import { Navigate } from 'react-router'
import { useAppStore } from '@store/appStore'
import { logger } from '@utils/logger'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isBackendConnected = useAppStore((state) => state.connection.isConnected)

  if (!isBackendConnected) {
    logger.warn('[ProtectedRoute] Access denied - redirecting to /')
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
