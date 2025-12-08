/**
 * SSE Event Handlers for React Query Cache Updates
 *
 * This hook connects SSE events from the backend to React Query cache,
 * enabling real-time UI updates without polling. It listens to various
 * event types (job updates, segment changes, exports) and updates the
 * appropriate query cache entries.
 *
 * Event Types Handled:
 * - Job Events: job.created, job.started, job.progress, job.completed, job.failed, job.cancelled, job.resumed
 * - Segment Events: segment.started, segment.completed, segment.failed, segment.updated
 * - Chapter Events: chapter.updated
 * - Export Events: export.started, export.progress, export.completed, export.failed, export.cancelled
 * - Import Events: import.started, import.progress, import.completed, import.failed
 * - Health Events: health.update
 * - Speaker Events: speaker.created, speaker.updated, speaker.deleted, speaker.sample_added, speaker.sample_deleted
 * - Settings Events: settings.updated, settings.reset
 * - Pronunciation Events: pronunciation.rule.created, updated, deleted, bulk_change, test.started, test.completed
 * - STT Events: stt.job.created, started, progress, completed, failed, cancelled, stt.segment.started, analyzed, failed
 * - Engine Events: engine.started, engine.stopped, engine.enabled, engine.disabled
 *
 * IMPORTANT: This hook uses the shared SSE connection from SSEContext.
 * Do NOT call useSSE() directly - use useSSEConnection() instead.
 *
 * @example
 * ```tsx
 * // In your app root or main layout
 * function App() {
 *   useSSEEventHandlers({ enabled: true })
 *   return <YourApp />
 * }
 * ```
 */

import { useEffect, useCallback, useRef } from 'react'
import { useSSEConnection } from '@contexts/SSEContext'
import { useAppStore } from '@store/appStore'
import { logger } from '@utils/logger'
import { useSSEHandlers } from './sse'

// ============================================================================
// Event Router
// ============================================================================

/**
 * Route incoming SSE event to appropriate handler
 *
 * This function parses the incoming SSE event and routes it to the
 * appropriate domain-specific handler based on the event type.
 *
 * @param event - SSE MessageEvent from backend
 * @param handlers - Object containing all event handlers from domain hooks
 * @param backendUrl - Backend URL for health events
 */
function routeEvent(
  event: MessageEvent,
  handlers: ReturnType<typeof useSSEHandlers>,
  backendUrl: string | null
) {
  try {
    // Parse event data
    const data = JSON.parse(event.data)
    const eventType = data.event || event.type

    if (!eventType) {
      logger.group(
        '⚠️ Invalid SSE Event',
        'Received event without type',
        {
          'Data': data,
          'Event': event.type || 'unknown'
        },
        '#FF9800' // Orange for warning
      )
      return
    }

    // Special handling for health events (requires backendUrl)
    if (eventType === 'health.update') {
      if (backendUrl) {
        handlers['health.update'](data, backendUrl)
      } else {
        logger.warn('[SSE] Health update received but no backend URL available')
      }
      return
    }

    // Route to appropriate handler based on event type
    const handler = handlers[eventType as keyof typeof handlers]

    if (handler) {
      // Call the handler with event data
      // Cast to any to handle the different signature of health handler
      // (health handler takes backendUrl as second param, handled separately above)
      ;(handler as any)(data)
    } else {
      // Unknown event type - log warning
      logger.group(
        '⚠️ Unknown SSE Event',
        'Received unhandled event type',
        {
          'Event Type': eventType,
          'Data': JSON.stringify(event.data).substring(0, 200) + '...',
          'Action': 'Ignored'
        },
        '#FF9800' // Orange for warning
      )
    }
  } catch (error) {
    logger.group(
      '❌ Event Router Failed',
      'Failed to parse or route SSE event',
      {
        'Error': error instanceof Error ? error.message : String(error),
        'Event Data': event.data?.substring(0, 200) || 'N/A',
        'Event Type': event.type || 'unknown'
      },
      '#F44336' // Red for error
    )
  }
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook Options
 */
interface UseSSEEventHandlersOptions {
  /** Enable/disable event handlers (default: true) */
  enabled?: boolean
  /**
   * Callback to trigger audio player updates
   * Called for segment.completed, segment.updated (divider), and chapter.updated events
   */
  onAudioUpdate?: (segmentId: string, chapterId: string) => void
  /**
   * Callback for TTS job status changes (completed, failed, cancelled)
   * Called for job.completed, job.failed, and job.cancelled events
   */
  onJobStatusChange?: (status: 'completed' | 'failed' | 'cancelled', jobId: string, chapterId: string) => void
}

/**
 * Main Hook: Connect SSE events to React Query cache
 *
 * This hook automatically subscribes to SSE events from the shared SSE connection
 * and updates the React Query cache in real-time, eliminating the need for polling.
 *
 * IMPORTANT: This hook uses the shared SSE connection from SSEContext.
 * Only ONE EventSource connection is created per app, preventing connection leaks.
 *
 * Architecture:
 * - Uses domain-specific handlers from hooks/sse/ directory
 * - Each domain (TTS, Segment, Export, System, STT) has its own handler file
 * - useSSEHandlers() combines all domain handlers into a single object
 * - routeEvent() dispatches events to the appropriate handler
 *
 * @param options - Hook configuration options
 *
 * @example
 * ```tsx
 * function App() {
 *   // Enable SSE event handlers globally
 *   useSSEEventHandlers({ enabled: true })
 *
 *   return <YourApp />
 * }
 * ```
 */
export function useSSEEventHandlers(options?: UseSSEEventHandlersOptions): void {
  const { enabled = true, onAudioUpdate, onJobStatusChange } = options || {}
  const { connection, subscribe } = useSSEConnection()
  const backendUrl = useAppStore((state) => state.connection.url)
  const lastLoggedStatusRef = useRef<string | null>(null)

  // Get all event handlers from domain-specific hooks
  // This combines handlers from TTS, Segment, Export, System, and STT domains
  // Pass onAudioUpdate and onJobStatusChange callbacks to handlers
  const handlers = useSSEHandlers({ onAudioUpdate, onJobStatusChange })

  // Stabilize event handler callback to prevent re-subscription loops
  // CRITICAL: handlers is not included in deps because the handler functions are already
  // stabilized with useCallback in their respective domain hooks. Including it would
  // cause reconnection loops because useSSEHandlers() returns a new object reference
  // on every render (even though the handler functions themselves are stable).
  const handleEvent = useCallback((event: MessageEvent) => {
    // Route event to appropriate handler with backendUrl context
    routeEvent(event, handlers, backendUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl])

  // Subscribe to SSE events
  useEffect(() => {
    if (!enabled) {
      return
    }

    // Subscribe to events with stable callback
    const unsubscribe = subscribe(handleEvent)
    // Note: Subscribe/unsubscribe logs removed - too noisy during HMR

    // Cleanup on unmount
    return () => {
      unsubscribe()
    }
  }, [enabled, subscribe, handleEvent])

  // Log connection status changes (deduplicated to prevent spam during HMR/remounts)
  useEffect(() => {
    // Skip if status hasn't actually changed
    if (lastLoggedStatusRef.current === connection.status) {
      return
    }
    lastLoggedStatusRef.current = connection.status

    if (connection.status === 'connected') {
      logger.group(
        '📡 SSE Connected',
        'Real-time connection established',
        {
          'Status': connection.status,
          'Type': connection.connectionType,
          'Reconnect Attempts': connection.reconnectAttempts
        },
        '#4CAF50' // Green for success
      )
    } else if (connection.status === 'disconnected') {
      logger.group(
        '📡 SSE Disconnected',
        'Connection lost',
        {
          'Status': connection.status,
          'Last Event': connection.lastEventTime?.toLocaleTimeString() || 'Never'
        },
        '#607D8B' // Gray for disconnection
      )
    } else if (connection.status === 'error') {
      logger.group(
        '📡 SSE Connection Error',
        'Connection error, attempting reconnect',
        {
          'Status': connection.status,
          'Reconnect Attempts': connection.reconnectAttempts,
          'Action': 'Auto-reconnecting'
        },
        '#FF9800' // Orange for warning
      )
    }
  }, [connection.status])

  // Log fallback to polling
  useEffect(() => {
    if (connection.connectionType === 'polling') {
      logger.group(
        '📡 Polling Fallback',
        'SSE unavailable, falling back to polling',
        {
          'Connection Type': connection.connectionType,
          'Polling Interval': '30s',
          'Impact': '99.5% more network traffic',
          'Reason': 'SSE endpoint unreachable'
        },
        '#FF9800' // Orange for fallback warning
      )
    }
  }, [connection.connectionType])
}
