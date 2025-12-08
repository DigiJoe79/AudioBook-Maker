import { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '@store/appStore'
import { logger } from '@utils/logger'

/**
 * SSE Connection Status and Metadata
 */
interface SSEConnection {
  /** Current connection status */
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  /** Active connection type (sse, polling fallback, or none) */
  connectionType: 'sse' | 'polling' | 'none'
  /** Timestamp of last received event */
  lastEventTime: Date | null
  /** Number of reconnection attempts since last successful connection */
  reconnectAttempts: number
  /** Total number of events received in current session */
  eventsReceived: number
  /** Connection uptime in milliseconds (null if not connected) */
  uptime: number | null
}

/**
 * Hook Options
 */
interface UseSSEOptions {
  /** Event channels to subscribe to (default: ["jobs", "health"]) */
  channels?: string[]
  /** Enable/disable the connection (default: true) */
  enabled?: boolean
  /** Callback fired for each received event */
  onEvent?: (event: MessageEvent) => void
  /** Maximum reconnection attempts before falling back to polling (default: 5) */
  maxReconnectAttempts?: number
  /** Maximum backoff delay in milliseconds (default: 30000 = 30s) */
  maxBackoffMs?: number
}

/**
 * Reconnection Configuration
 */
interface ReconnectConfig {
  /** Current reconnection attempt counter */
  attempts: number
  /** Current backoff delay in milliseconds */
  currentBackoffMs: number
  /** Timer ID for reconnection timeout */
  timerId: ReturnType<typeof setTimeout> | null
}

/**
 * Calculate exponential backoff delay
 * Formula: min(2^attempt * 1000, maxBackoffMs)
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param maxBackoffMs - Maximum backoff delay
 * @returns Delay in milliseconds
 */
function calculateBackoff(attempt: number, maxBackoffMs: number): number {
  const exponentialDelay = Math.pow(2, attempt) * 1000
  return Math.min(exponentialDelay, maxBackoffMs)
}

/**
 * Server-Sent Events (SSE) Hook with Auto-Reconnect
 *
 * Manages an EventSource connection to the backend SSE endpoint with:
 * - Automatic reconnection with exponential backoff
 * - Fallback to polling mode if SSE is unsupported or unreliable
 * - Connection lifecycle management
 * - Event tracking and statistics
 *
 * @example
 * ```tsx
 * const sseConnection = useSSE({
 *   channels: ['jobs', 'health'],
 *   onEvent: (event) => {
 *     const data = JSON.parse(event.data)
 *     console.log('Received:', data)
 *   }
 * })
 *
 * if (sseConnection.connectionType === 'polling') {
 *   // Fall back to React Query polling
 * }
 * ```
 */
export function useSSE(options?: UseSSEOptions): SSEConnection {
  const backendUrl = useAppStore((state) => state.connection.url)

  // Configuration with defaults
  const {
    channels = ['jobs', 'health'],
    enabled = true,
    onEvent,
    maxReconnectAttempts = 5,
    maxBackoffMs = 30000
  } = options || {}

  // Connection state
  const [connection, setConnection] = useState<SSEConnection>({
    status: 'disconnected',
    connectionType: 'none',
    lastEventTime: null,
    reconnectAttempts: 0,
    eventsReceived: 0,
    uptime: null
  })

  // EventSource instance ref
  const eventSourceRef = useRef<EventSource | null>(null)

  // Reconnection config ref
  const reconnectConfigRef = useRef<ReconnectConfig>({
    attempts: 0,
    currentBackoffMs: 0,
    timerId: null
  })

  // Connection start time for uptime tracking
  const connectionStartTimeRef = useRef<number | null>(null)

  /**
   * Close and cleanup current EventSource
   */
  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    connectionStartTimeRef.current = null
  }, [])

  /**
   * Clear any pending reconnection timer
   */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectConfigRef.current.timerId) {
      clearTimeout(reconnectConfigRef.current.timerId)
      reconnectConfigRef.current.timerId = null
    }
  }, [])

  /**
   * Reset reconnection state (called on successful connection)
   */
  const resetReconnectState = useCallback(() => {
    clearReconnectTimer()
    reconnectConfigRef.current = {
      attempts: 0,
      currentBackoffMs: 0,
      timerId: null
    }
  }, [clearReconnectTimer])

  /**
   * Connect to SSE endpoint
   */
  const connect = useCallback(() => {
    // PREVENT DUPLICATE CONNECTIONS
    // If EventSource is already open and connected, skip reconnection
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      logger.group(
        '📡 SSE',
        'Connection Already Open',
        {
          'Status': 'Skipping duplicate connect()',
          'ReadyState': 'OPEN'
        },
        '#FF9800'  // Orange for warning
      )
      return
    }

    // Cleanup any existing connection
    closeEventSource()
    clearReconnectTimer()

    // Check if SSE is supported
    if (typeof EventSource === 'undefined') {
      logger.group(
        '📡 SSE',
        'Unsupported - Fallback to Polling',
        {
          'Status': 'EventSource API not available in browser',
          'Action': 'Switching to polling mode'
        },
        '#FF9800'  // Orange for warning
      )
      setConnection(prev => ({
        ...prev,
        status: 'disconnected',
        connectionType: 'polling'
      }))
      return
    }

    // Check if we should fall back to polling
    if (reconnectConfigRef.current.attempts >= maxReconnectAttempts) {
      logger.group(
        '📡 SSE',
        'Max Retries - Fallback to Polling',
        {
          'Attempts': reconnectConfigRef.current.attempts,
          'Max Attempts': maxReconnectAttempts,
          'Action': 'Switching to polling mode'
        },
        '#FF9800'  // Orange for warning
      )
      setConnection(prev => ({
        ...prev,
        status: 'disconnected',
        connectionType: 'polling',
        reconnectAttempts: reconnectConfigRef.current.attempts
      }))
      return
    }

    // Build SSE URL with channels
    const channelsParam = channels.join(',')
    const sseUrl = `${backendUrl}/api/events/subscribe?channels=${channelsParam}`

    // Set connecting status
    setConnection(prev => ({
      ...prev,
      status: 'connecting',
      connectionType: 'sse',
      reconnectAttempts: reconnectConfigRef.current.attempts
    }))

    // Create EventSource
    const eventSource = new EventSource(sseUrl)
    eventSourceRef.current = eventSource

    /**
     * Handle connection open
     */
    eventSource.onopen = () => {
      logger.group(
        '📡 SSE',
        'Connection Established',
        {
          'URL': sseUrl,
          'Channels': channels.join(', '),
          'Previous Attempts': reconnectConfigRef.current.attempts
        },
        '#4CAF50'  // Green for success
      )
      connectionStartTimeRef.current = Date.now()
      resetReconnectState()

      setConnection(prev => ({
        ...prev,
        status: 'connected',
        connectionType: 'sse',
        reconnectAttempts: 0,
        uptime: 0
      }))
    }

    /**
     * Handle incoming messages
     */
    eventSource.onmessage = (event: MessageEvent) => {
      const now = Date.now()
      const uptime = connectionStartTimeRef.current
        ? now - connectionStartTimeRef.current
        : null

      setConnection(prev => ({
        ...prev,
        lastEventTime: new Date(),
        eventsReceived: prev.eventsReceived + 1,
        uptime
      }))

      // Call user-provided event handler
      onEvent?.(event)
    }

    /**
     * Handle connection errors
     */
    eventSource.onerror = (error) => {
      // Close current connection
      closeEventSource()

      // Increment reconnect attempts
      const attemptNumber = reconnectConfigRef.current.attempts
      reconnectConfigRef.current.attempts += 1

      // Calculate backoff delay
      const backoffMs = calculateBackoff(attemptNumber, maxBackoffMs)
      reconnectConfigRef.current.currentBackoffMs = backoffMs

      logger.group(
        '📡 SSE',
        'Connection Error - Reconnecting',
        {
          'Error': error,
          'Attempt': reconnectConfigRef.current.attempts,
          'Backoff Delay': `${backoffMs}ms`,
          'URL': `${backendUrl}/api/events/subscribe`
        },
        '#FF9800'  // Orange for errors/warnings
      )

      setConnection(prev => ({
        ...prev,
        status: 'error',
        reconnectAttempts: reconnectConfigRef.current.attempts,
        uptime: null
      }))

      // Schedule reconnection
      reconnectConfigRef.current.timerId = setTimeout(() => {
        connect()
      }, backoffMs)
    }
  }, [
    backendUrl,
    channels,
    maxReconnectAttempts,
    maxBackoffMs,
    onEvent,
    closeEventSource,
    clearReconnectTimer,
    resetReconnectState
  ])

  /**
   * Main effect: Connect/disconnect based on conditions
   */
  useEffect(() => {
    // Don't connect if disabled or no backend URL
    if (!enabled || !backendUrl) {
      setConnection(prev => ({
        ...prev,
        status: 'disconnected',
        connectionType: 'none'
      }))
      return
    }

    // Initiate connection
    connect()

    // Cleanup on unmount or dependency change
    return () => {
      closeEventSource()
      clearReconnectTimer()
    }
  }, [enabled, backendUrl, connect, closeEventSource, clearReconnectTimer])

  /**
   * Uptime tracking effect
   * Updates uptime every second while connected
   */
  useEffect(() => {
    if (connection.status !== 'connected') {
      return
    }

    const interval = setInterval(() => {
      if (connectionStartTimeRef.current) {
        const uptime = Date.now() - connectionStartTimeRef.current
        setConnection(prev => ({
          ...prev,
          uptime
        }))
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [connection.status])

  return connection
}
