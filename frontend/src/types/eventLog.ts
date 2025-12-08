/**
 * Event Log Types
 *
 * Type definitions for the Event Log System that tracks SSE events
 * with filtering and search capabilities.
 *
 * Consumer-First Principle: All types use camelCase (frontend-consumed).
 */

/**
 * Event Category - Domain classification for SSE events
 */
export type EventCategory =
  | 'tts'           // TTS job events
  | 'quality'       // Quality analysis events (STT + Audio)
  | 'export'        // Export job events
  | 'health'        // Health/system events
  | 'speakers'      // Speaker management events
  | 'settings'      // Settings events
  | 'chapter'       // Chapter events
  | 'segment'       // Segment events
  | 'pronunciation' // Pronunciation rule events

/**
 * Event Severity - Importance/impact level
 */
export type EventSeverity = 'info' | 'success' | 'warning' | 'error'

/**
 * Time Range - Predefined time filters
 */
export type TimeRange = '5min' | '1hour' | 'today' | 'all'

/**
 * Log Event - Single event in the activity log
 */
export interface LogEvent {
  /** Unique event ID (timestamp + random) */
  id: string

  /** Event timestamp */
  timestamp: Date

  /** Event category (domain) */
  category: EventCategory

  /** Event severity level */
  severity: EventSeverity

  /** SSE event type (e.g., 'job.started', 'segment.completed') */
  eventType: string

  /** Human-readable message */
  message: string

  /** Original event data (optional) */
  payload?: Record<string, any>
}

/**
 * Filter State - Current filter settings
 */
export interface FilterState {
  /** Enabled categories */
  categories: Set<EventCategory>

  /** Enabled severities */
  severities: Set<EventSeverity>

  /** Time range filter */
  timeRange: TimeRange

  /** Search query string */
  searchQuery: string
}

/**
 * Event Log Store State
 */
export interface EventLogState {
  /** Array of logged events (max 1000) */
  events: LogEvent[]

  /** Current filter settings */
  filters: FilterState

  /** Auto-scroll to latest event */
  autoScroll: boolean

  /** Maximum number of events to store */
  maxEvents: number
}

/**
 * Event Log Store Actions
 */
export interface EventLogActions {
  /** Add new event to log */
  addEvent: (event: Partial<LogEvent>) => void

  /** Clear all events */
  clearEvents: () => void

  /** Set specific filter */
  setFilter: <K extends keyof FilterState>(
    filterKey: K,
    value: FilterState[K]
  ) => void

  /** Reset filters to default */
  resetFilters: () => void

  /** Toggle auto-scroll */
  toggleAutoScroll: () => void

  /** Get filtered events based on current filters */
  getFilteredEvents: () => LogEvent[]
}

/**
 * Complete Event Log Store
 */
export type EventLogStore = EventLogState & EventLogActions
