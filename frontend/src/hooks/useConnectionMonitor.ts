
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { logger } from '../utils/logger'

interface ConnectionMonitorOptions {
  onConnectionLost?: () => void

  onConnectionRestored?: () => void

  maxRetries?: number

  retryInterval?: number

  healthCheckInterval?: number
}

interface ConnectionMonitorResult {
  isConnected: boolean

  retryCount: number

  maxRetries: number

  retryNow: () => Promise<void>
}

export function useConnectionMonitor(
  options: ConnectionMonitorOptions = {}
): ConnectionMonitorResult {
  const {
    onConnectionLost,
    onConnectionRestored,
    maxRetries = 12,
    retryInterval = 2000,
    healthCheckInterval = 3000,
  } = options

  const currentBackendUrl = useAppStore((state) => state.connection.url)
  const [isConnected, setIsConnected] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const reconnectIntervalRef = useRef<number | null>(null)
  const healthCheckIntervalRef = useRef<number | null>(null)
  const hasNotifiedLostRef = useRef(false)
  const startHealthCheckLoopRef = useRef<() => void>()
  const lastErrorEventTimeRef = useRef<number>(0)
  const isCheckingConnectionRef = useRef(false)

  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    if (!currentBackendUrl) return false

    try {
      const activeGenerations = useAppStore.getState().activeGenerations

      const timeout = activeGenerations.size > 0 ? 30000 : 10000

      const response = await fetch(`${currentBackendUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      })

      if (response.ok) {
        const health = await response.json() as { busy?: boolean; activeJobs?: number }

        if (health.busy || (health.activeJobs && health.activeJobs > 0)) {
          logger.debug(`[ConnectionMonitor] Backend is busy (${health.activeJobs} active jobs)`)
        }
      }

      return response.ok
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.warn('[ConnectionMonitor] Health check timeout - backend may be overloaded')
      }
      return false
    }
  }, [currentBackendUrl])

  const startReconnectLoop = useCallback(async () => {
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current)
    }
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = null
    }

    setRetryCount(1)
    logger.info(`[ConnectionMonitor] Reconnect attempt 1/${maxRetries}`)
    const isOnlineNow = await checkBackendHealth()

    if (isOnlineNow) {
      logger.info('[ConnectionMonitor] Backend reconnected immediately')
      setIsConnected(true)
      setRetryCount(0)
      hasNotifiedLostRef.current = false
      onConnectionRestored?.()
      startHealthCheckLoopRef.current?.()
      return
    }

    reconnectIntervalRef.current = setInterval(async () => {
      const isOnline = await checkBackendHealth()

      if (isOnline) {
        logger.info('[ConnectionMonitor] Backend reconnected successfully')
        setIsConnected(true)
        setRetryCount(0)
        hasNotifiedLostRef.current = false

        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current)
          reconnectIntervalRef.current = null
        }

        onConnectionRestored?.()
        startHealthCheckLoopRef.current?.()
      } else {
        setRetryCount((prev) => {
          const newCount = prev + 1
          logger.info(`[ConnectionMonitor] Reconnect attempt ${newCount}/${maxRetries}`)

          if (newCount >= maxRetries) {
            logger.warn('[ConnectionMonitor] Max retries reached, giving up')
            if (reconnectIntervalRef.current) {
              clearInterval(reconnectIntervalRef.current)
              reconnectIntervalRef.current = null
            }
          }

          return newCount
        })
      }
    }, retryInterval)
  }, [checkBackendHealth, maxRetries, retryInterval, onConnectionRestored])

  const startHealthCheckLoop = useCallback(() => {
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
    }

    if (reconnectIntervalRef.current) return

    logger.debug('[ConnectionMonitor] Starting health check interval')
    healthCheckIntervalRef.current = setInterval(async () => {
      const activeGenerations = useAppStore.getState().activeGenerations
      if (activeGenerations.size > 0) {
        logger.debug('[ConnectionMonitor] Skipping health check - backend busy with generation')
        return
      }

      const isOnline = await checkBackendHealth()

      if (!isOnline && !hasNotifiedLostRef.current) {
        logger.warn('[ConnectionMonitor] Backend offline detected by health check')
        setIsConnected(false)
        hasNotifiedLostRef.current = true

        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current)
          healthCheckIntervalRef.current = null
        }

        onConnectionLost?.()
        void startReconnectLoop()
      }
    }, healthCheckInterval)
  }, [checkBackendHealth, healthCheckInterval, onConnectionLost, startReconnectLoop])

  useEffect(() => {
    startHealthCheckLoopRef.current = startHealthCheckLoop
  }, [startHealthCheckLoop])

  const handleConnectionError = useCallback(async () => {
    if (!currentBackendUrl) return

    if (!isConnected || hasNotifiedLostRef.current) return

    if (isCheckingConnectionRef.current) {
      logger.debug('[ConnectionMonitor] Connection check already in progress, skipping')
      return
    }

    const now = Date.now()
    const timeSinceLastError = now - lastErrorEventTimeRef.current
    if (timeSinceLastError < 2000) {
      logger.debug(`[ConnectionMonitor] Ignoring duplicate error event (${timeSinceLastError}ms since last)`)
      return
    }

    const activeGenerations = useAppStore.getState().activeGenerations
    if (activeGenerations.size > 0) {
      logger.debug('[ConnectionMonitor] Error event during active generation - likely timeout, not connection loss')
      return
    }

    lastErrorEventTimeRef.current = now
    isCheckingConnectionRef.current = true

    logger.info('[ConnectionMonitor] Connection error detected, verifying...')

    try {
      const isOnline = await checkBackendHealth()

      if (!isOnline) {
        logger.warn('[ConnectionMonitor] Backend confirmed offline')
        setIsConnected(false)
        hasNotifiedLostRef.current = true
        onConnectionLost?.()
        startReconnectLoop()
      } else {
        logger.debug('[ConnectionMonitor] Backend still reachable, false alarm')
      }
    } finally {
      isCheckingConnectionRef.current = false
    }
  }, [currentBackendUrl, isConnected, checkBackendHealth, onConnectionLost, startReconnectLoop])

  const retryNow = useCallback(async () => {
    logger.info('[ConnectionMonitor] Manual retry triggered')
    const isOnline = await checkBackendHealth()

    if (isOnline) {
      setIsConnected(true)
      setRetryCount(0)
      hasNotifiedLostRef.current = false

      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current)
        reconnectIntervalRef.current = null
      }

      onConnectionRestored?.()
      startHealthCheckLoopRef.current?.()
    }
  }, [checkBackendHealth, onConnectionRestored])

  useEffect(() => {
    if (currentBackendUrl) {
      logger.debug('[ConnectionMonitor] Initializing health check on mount')
      startHealthCheckLoopRef.current?.()
    }

    return () => {
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current)
      }
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBackendUrl])

  useEffect(() => {
    window.addEventListener('backend-connection-error', handleConnectionError)

    return () => {
      window.removeEventListener('backend-connection-error', handleConnectionError)
    }
  }, [handleConnectionError])

  return {
    isConnected,
    retryCount,
    maxRetries,
    retryNow,
  }
}
