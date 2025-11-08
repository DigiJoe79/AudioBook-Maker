/**
 * SSE Context - Single Shared EventSource Connection
 *
 * This context ensures only ONE EventSource connection is created for the entire app,
 * preventing duplicate connections and connection leaks.
 *
 * Architecture:
 * - SSEProvider wraps the app and creates the EventSource
 * - useSSEConnection() returns the connection status for UI display
 * - useSSEEventHandlers() subscribes to events for React Query cache updates
 * - Both hooks use the SAME underlying EventSource instance
 */

import { createContext, useContext, ReactNode, useMemo, useCallback } from 'react'
import { useSSE } from '../hooks/useServerSentEvents'
import { logger } from '@/utils/logger'

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
 * SSE Context Value
 */
interface SSEContextValue {
  connection: SSEConnection
  subscribe: (callback: (event: MessageEvent) => void) => () => void
}

/**
 * SSE Context
 */
const SSEContext = createContext<SSEContextValue | null>(null)

/**
 * SSE Provider Props
 */
interface SSEProviderProps {
  children: ReactNode
  enabled?: boolean
}

/**
 * SSE Provider - Creates and manages single EventSource connection
 *
 * This provider should wrap your app at the root level to ensure
 * only one EventSource connection exists.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <SSEProvider enabled={true}>
 *       <YourApp />
 *     </SSEProvider>
 *   )
 * }
 * ```
 */
export function SSEProvider({ children, enabled = true }: SSEProviderProps) {
  // Subscribers list - stores all event callbacks
  const subscribers = useMemo<Set<(event: MessageEvent) => void>>(() => new Set(), [])

  // Memoize channels array to prevent re-renders
  const channels = useMemo(() => ['jobs', 'health', 'speakers', 'settings'], [])

  // Stabilize onEvent callback to prevent reconnections
  // CRITICAL: Without useCallback, this function is recreated on every render,
  // causing useSSE's connect() to be recreated, triggering reconnection loops
  const onEvent = useCallback((event: MessageEvent) => {
    // Parse and log SSE events
    try {
      const data = JSON.parse(event.data)
      const eventType = data.event || event.type || 'unknown'

      // Use logger.group() - automatically gated by import.meta.env.DEV
      logger.group(
        '📡 SSE Event',
        eventType,
        {
          'Event Type': eventType,
          'Data': data,
          'Channel': data._channel || 'unknown',
          'Timestamp': data._timestamp || 'N/A'
        },
        '#2196F3'  // Blue badge color
      )
    } catch (error) {
      logger.error('[SSE] Failed to parse event data:', error)
    }

    // Broadcast event to all subscribers
    subscribers.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        logger.error('[SSE] Subscriber callback error:', error)
      }
    })
  }, [subscribers])

  // Create single EventSource connection
  const connection = useSSE({
    channels,
    enabled,
    onEvent,
  })

  // Stabilize subscribe function to prevent re-subscription loops
  // CRITICAL: Without useCallback, this function is recreated whenever connection changes,
  // causing useSSEEventHandlers to unsubscribe/resubscribe constantly
  const subscribe = useCallback((callback: (event: MessageEvent) => void) => {
    subscribers.add(callback)
    // Return unsubscribe function
    return () => {
      subscribers.delete(callback)
    }
  }, [subscribers])

  // Create context value
  const contextValue = useMemo<SSEContextValue>(
    () => ({
      connection,
      subscribe,
    }),
    [connection, subscribe]
  )

  return <SSEContext.Provider value={contextValue}>{children}</SSEContext.Provider>
}

/**
 * Hook to access SSE connection status
 *
 * Use this hook to display connection status in UI (e.g., status indicator).
 *
 * @example
 * ```tsx
 * function StatusIndicator() {
 *   const { connection } = useSSEConnection()
 *
 *   if (connection.connectionType === 'sse' && connection.status === 'connected') {
 *     return <Chip label="Real-time" color="success" />
 *   }
 *
 *   return null
 * }
 * ```
 */
export function useSSEConnection(): SSEContextValue {
  const context = useContext(SSEContext)
  if (!context) {
    throw new Error('useSSEConnection must be used within SSEProvider')
  }
  return context
}
