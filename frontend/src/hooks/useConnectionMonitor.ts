/**
 * useConnectionMonitor Hook
 *
 * Monitors the backend connection during app usage and handles reconnection logic.
 *
 * Flow:
 * 1. Listens to browser online/offline events for instant offline detection
 * 2. Checks navigator.onLine before making health check requests
 * 3. Polls backend health every 3s (fast polling enabled by non-blocking backend thread)
 * 4. Skips health checks during active generation (prevents false positives)
 * 5. On error, verifies backend is actually offline (with deduplication)
 * 6. Starts reconnect loop (2s interval, max 12 attempts = 24s)
 * 7. If reconnect succeeds: triggers onConnectionRestored
 * 8. If max retries reached: user can manually retry or navigate away
 *
 * Browser Offline Detection:
 * - When 'offline' event fires: immediately mark disconnected, stop polling
 * - When 'online' event fires: trigger immediate health check and resume polling
 * - Health checks always check navigator.onLine first to avoid unnecessary requests
 *
 * Performance: Backend health endpoint responds in <1ms via dedicated thread,
 * allowing frequent polling without server load.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@store/appStore'
import { useSSEConnection } from '@contexts/SSEContext'
import { logger } from '@utils/logger'

interface ConnectionMonitorOptions {
  /** Callback when connection is lost */
  onConnectionLost?: () => void

  /** Callback when connection is restored */
  onConnectionRestored?: () => void

  /** Maximum reconnection attempts (default: 12 = 24 seconds at 2s interval) */
  maxRetries?: number

  /** Interval between reconnection attempts in milliseconds (default: 2000) */
  retryInterval?: number

  /** Interval for health checks during normal operation in milliseconds (default: 3000) */
  healthCheckInterval?: number
}

interface ConnectionMonitorResult {
  /** Whether the backend is currently connected */
  isConnected: boolean

  /** Current retry attempt (0 if not retrying) */
  retryCount: number

  /** Maximum retry attempts configured */
  maxRetries: number

  /** Manually trigger a reconnection attempt */
  retryNow: () => Promise<void>
}

/**
 * Monitor backend connection and handle reconnection
 *
 * @param options - Configuration options
 * @returns Connection monitor result
 *
 * @example
 * ```tsx
 * const { isConnected, retryCount, maxRetries } = useConnectionMonitor({
 *   onConnectionLost: () => {
 *     // Save current state
 *     saveSessionState(getCurrentState())
 *   },
 *   onConnectionRestored: () => {
 *     // Connection restored, continue normally
 *   }
 * })
 * ```
 */
export function useConnectionMonitor(
  options: ConnectionMonitorOptions = {}
): ConnectionMonitorResult {
  const {
    onConnectionLost,
    onConnectionRestored,
    maxRetries = 12,  // Increased to maintain ~24s total retry time (was 6 retries × 5s = 30s)
    retryInterval = 2000,  // Faster reconnect (was 5000ms)
    healthCheckInterval = 3000,  // Much faster health checks enabled by non-blocking backend thread (was 10000ms)
  } = options

  const currentBackendUrl = useAppStore((state) => state.connection.url)
  const [isConnected, setIsConnected] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const [isBrowserOnline, setIsBrowserOnline] = useState(navigator.onLine)
  const reconnectIntervalRef = useRef<number | null>(null)
  const healthCheckIntervalRef = useRef<number | null>(null)
  const hasNotifiedLostRef = useRef(false)
  const startHealthCheckLoopRef = useRef<(() => void) | undefined>(undefined)
  const lastErrorEventTimeRef = useRef<number>(0)
  const isCheckingConnectionRef = useRef(false)
  const lastConnectionModeRef = useRef<'sse' | 'polling' | null>(null)

  // Check SSE connection status
  const sseConnection = useSSEConnection()
  const isSseConnected = sseConnection.connection.status === 'connected'

  /**
   * Check if backend is actually reachable
   *
   * Since Non-Blocking Health Monitor was implemented, /health responds in < 1ms
   * even during active TTS generation, so we can use a consistent short timeout.
   */
  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    if (!currentBackendUrl) return false

    // If browser is offline, skip health check
    if (!navigator.onLine) {
      return false
    }

    try {
      // Non-blocking health endpoint responds instantly (< 1ms)
      // No need for dynamic timeouts anymore
      const timeout = 10000

      const response = await fetch(`${currentBackendUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      })

      if (response.ok) {
        // Parse response to check backend status
        const health = await response.json() as { busy?: boolean; activeJobs?: number }

        // Log if backend is busy (for debugging)
        if (health.busy || (health.activeJobs && health.activeJobs > 0)) {
          logger.group(
            '⚡ Health Check',
            'Backend is busy',
            {
              'Active Jobs': health.activeJobs,
              'Busy': health.busy
            },
            '#FF9800'
          )
        }
      }

      return response.ok
    } catch (error) {
      // Log timeout specifically vs. other network errors
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.warn('[ConnectionMonitor] Health check timeout - backend may be overloaded')
      }
      return false
    }
  }, [currentBackendUrl])

  /**
   * Start reconnection loop
   */
  const startReconnectLoop = useCallback(async () => {
    // Clear any existing intervals
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current)
    }
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = null
    }

    // First attempt immediately
    setRetryCount(1)
    logger.group(
      '🔌 Connection Recovery',
      'Attempting Reconnection (1st Try)',
      {
        'Attempt': `1/${maxRetries}`,
        'URL': currentBackendUrl || 'Unknown'
      },
      '#2196F3'  // Blue
    )
    const isOnlineNow = await checkBackendHealth()

    if (isOnlineNow) {
      // Success on first try!
      logger.group(
        '🔌 Connection Recovery',
        'Backend Reconnected Immediately',
        {
          'Result': 'Connected',
          'Attempts': 1,
          'Duration': '<1s'
        },
        '#4CAF50'  // Green for success
      )
      setIsConnected(true)
      setRetryCount(0)
      hasNotifiedLostRef.current = false
      onConnectionRestored?.()
      startHealthCheckLoopRef.current?.() // Resume normal health checks
      return
    }

    // First attempt failed, start interval for remaining attempts
    reconnectIntervalRef.current = window.setInterval(async () => {
      const isOnline = await checkBackendHealth()

      if (isOnline) {
        // Success! Reconnected
        const attemptCount = retryCount
        const totalDuration = attemptCount * retryInterval
        logger.group(
          '🔌 Connection Recovery',
          'Backend Reconnected Successfully',
          {
            'Result': 'Connected',
            'Attempts': attemptCount,
            'Total Duration': `${(totalDuration / 1000).toFixed(1)}s`
          },
          '#4CAF50'  // Green for success
        )
        setIsConnected(true)
        setRetryCount(0)
        hasNotifiedLostRef.current = false

        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current)
          reconnectIntervalRef.current = null
        }

        onConnectionRestored?.()
        startHealthCheckLoopRef.current?.() // Resume normal health checks
      } else {
        // Still offline, increment retry count
        setRetryCount((prev) => {
          const newCount = prev + 1
          logger.group(
            '🔌 Connection Recovery',
            'Reconnection Attempt Failed',
            {
              'Attempt': `${newCount}/${maxRetries}`,
              'Status': newCount >= maxRetries ? 'Giving up' : 'Retrying',
              'Next Retry': newCount >= maxRetries ? 'N/A' : `${retryInterval}ms`
            },
            '#2196F3'  // Blue
          )

          if (newCount >= maxRetries) {
            // Max retries reached, give up
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

  /**
   * Start normal health check loop (during connected state)
   *
   * No need to skip checks during generation - non-blocking health endpoint
   * responds instantly even during TTS processing.
   */
  const startHealthCheckLoop = useCallback(() => {
    // Clear any existing health check interval
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = null
    }

    // Don't start if we're in reconnect mode
    if (reconnectIntervalRef.current) return

    // Don't start polling if SSE is connected (use SSE for health updates)
    if (isSseConnected) {
      // Only log if mode actually changed to prevent duplicate logs during startup
      if (lastConnectionModeRef.current !== 'sse') {
        lastConnectionModeRef.current = 'sse'
        logger.group(
          '🔌 Connection Mode',
          'SSE connected, using real-time updates',
          {
            'Polling': 'disabled',
            'Reason': 'SSE active'
          },
          '#4CAF50'
        )
      }
      return
    }

    // SSE not connected, use polling fallback
    // Only log if mode actually changed to prevent duplicate logs
    if (lastConnectionModeRef.current !== 'polling') {
      lastConnectionModeRef.current = 'polling'
      logger.group(
        '🔌 Connection Mode',
        'SSE disconnected, starting polling fallback',
        {
          'Polling': 'enabled',
          'Interval': `${healthCheckInterval}ms`
        },
        '#FF9800'
      )
    }
    healthCheckIntervalRef.current = window.setInterval(async () => {
      const isOnline = await checkBackendHealth()

      if (!isOnline && !hasNotifiedLostRef.current) {
        // Backend went offline during normal operation
        logger.warn('[ConnectionMonitor] Backend offline detected by health check')
        setIsConnected(false)
        hasNotifiedLostRef.current = true

        // Stop health check loop
        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current)
          healthCheckIntervalRef.current = null
        }

        onConnectionLost?.()
        // Start reconnect loop - use async to avoid blocking
        void startReconnectLoop()
      }
    }, healthCheckInterval)
  }, [isSseConnected, checkBackendHealth, healthCheckInterval, onConnectionLost, startReconnectLoop])

  /**
   * Keep ref updated with latest version
   */
  useEffect(() => {
    startHealthCheckLoopRef.current = startHealthCheckLoop
  }, [startHealthCheckLoop])

  /**
   * Handle connection error event with deduplication and rate limiting
   */
  const handleConnectionError = useCallback(async () => {
    if (!currentBackendUrl) return

    // Prevent duplicate notifications
    if (!isConnected || hasNotifiedLostRef.current) return

    // Prevent concurrent connection checks
    if (isCheckingConnectionRef.current) {
      return
    }

    // Rate limiting: ignore events within 2 seconds of last check
    const now = Date.now()
    const timeSinceLastError = now - lastErrorEventTimeRef.current
    if (timeSinceLastError < 2000) {
      return
    }

    lastErrorEventTimeRef.current = now
    isCheckingConnectionRef.current = true

    //logger.info('[ConnectionMonitor] Connection error detected, verifying...')

    try {
      // Verify it's really offline (not just a transient error)
      const isOnline = await checkBackendHealth()

      if (!isOnline) {
        // Really offline
        logger.warn('[ConnectionMonitor] Backend confirmed offline')
        setIsConnected(false)
        hasNotifiedLostRef.current = true
        onConnectionLost?.()
        startReconnectLoop()
      }
    } finally {
      isCheckingConnectionRef.current = false
    }
  }, [currentBackendUrl, isConnected, checkBackendHealth, onConnectionLost, startReconnectLoop])

  /**
   * Manual retry trigger
   */
  const retryNow = useCallback(async () => {
    logger.group(
      '🔌 Connection Recovery',
      'Manual Retry Triggered',
      {
        'Trigger': 'User action',
        'URL': currentBackendUrl || 'Unknown'
      },
      '#2196F3'  // Blue
    )
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
      startHealthCheckLoopRef.current?.() // Resume normal health checks
    }
  }, [checkBackendHealth, onConnectionRestored])

  /**
   * Listen to browser online/offline events
   */
  useEffect(() => {
    const handleOnline = async () => {
      logger.group(
        '🔌 Browser Network',
        'Browser Online Event',
        {
          'Status': 'Browser detected network connection',
          'Action': 'Verifying backend connection'
        },
        '#2196F3'  // Blue
      )
      setIsBrowserOnline(true)

      // Trigger immediate health check to verify backend connection
      const isBackendOnline = await checkBackendHealth()

      if (isBackendOnline && !isConnected) {
        // Backend is reachable, restore connection
        logger.group(
          '🔌 Connection Recovery',
          'Backend Confirmed Online',
          {
            'Trigger': 'Browser reconnect',
            'Result': 'Connection restored',
            'URL': currentBackendUrl || 'Unknown'
          },
          '#4CAF50'  // Green for success
        )
        setIsConnected(true)
        setRetryCount(0)
        hasNotifiedLostRef.current = false

        // Clear any existing reconnect interval
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current)
          reconnectIntervalRef.current = null
        }

        onConnectionRestored?.()
        startHealthCheckLoopRef.current?.() // Resume normal health checks
      } else if (!isBackendOnline) {
        // Browser is online but backend is still unreachable
        logger.warn('[ConnectionMonitor] Browser online but backend still unreachable')
        // Start reconnect loop if not already running
        if (!reconnectIntervalRef.current && !isConnected) {
          startReconnectLoop()
        }
      }
    }

    const handleOffline = () => {
      logger.warn('[ConnectionMonitor] Browser offline event detected')
      setIsBrowserOnline(false)

      // Immediately mark as disconnected
      if (isConnected && !hasNotifiedLostRef.current) {
        setIsConnected(false)
        hasNotifiedLostRef.current = true

        // Stop health check loop
        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current)
          healthCheckIntervalRef.current = null
        }

        onConnectionLost?.()
      }
    }

    // Add event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      // Cleanup event listeners
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [isConnected, checkBackendHealth, onConnectionLost, onConnectionRestored, startReconnectLoop])

  /**
   * Start health check loop on mount
   */
  useEffect(() => {
    if (currentBackendUrl) {
      startHealthCheckLoopRef.current?.()
    }

    return () => {
      // Cleanup both intervals on unmount
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current)
      }
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current)
      }
    }
    // Only run on mount/unmount and when backend URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBackendUrl])

  /**
   * Restart health check loop when SSE connection status changes
   *
   * When SSE connects: Stop polling, use SSE events
   * When SSE disconnects: Start polling fallback
   */
  useEffect(() => {
    if (currentBackendUrl && isConnected) {
      startHealthCheckLoopRef.current?.()
    }
  }, [currentBackendUrl, isConnected, isSseConnected])

  /**
   * Listen to connection error events (from API calls)
   */
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
