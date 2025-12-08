/**
 * Event Log Store
 *
 * Zustand store for managing SSE event logs with filtering,
 * search, and persistence capabilities.
 *
 * Architecture:
 * - Max 1000 events (auto-trim oldest)
 * - localStorage persistence for filters and autoScroll
 * - Consumer-First Principle: camelCase naming
 *
 * Performance:
 * - Events stored in array (fast iteration)
 * - Filters computed on-demand
 * - Auto-trim prevents memory leaks
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  EventLogStore,
  LogEvent,
  FilterState,
  EventCategory,
  EventSeverity,
  TimeRange,
} from '../types/eventLog'
import { logger } from '@/utils/logger'

/**
 * Default filter state
 *
 * User-relevant categories enabled by default:
 * - tts, stt, export, speakers, pronunciation
 *
 * Debug categories disabled by default:
 * - health (updates every 5s - too verbose)
 * - settings (low priority)
 * - chapter, segment (too verbose for normal use)
 */
const DEFAULT_FILTERS: FilterState = {
  categories: new Set<EventCategory>([
    'tts',
    'quality',
    'export',
    'speakers',
    'pronunciation',
    // Disabled by default (too verbose):
    // 'health', 'settings', 'chapter', 'segment'
  ]),
  severities: new Set<EventSeverity>(['warning', 'error']),
  // 'info' and 'success' disabled by default (reduces noise)
  timeRange: 'all' as TimeRange,
  searchQuery: '',
}

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Check if event matches time range filter
 */
function matchesTimeRange(event: LogEvent, timeRange: TimeRange): boolean {
  if (timeRange === 'all') return true

  const now = new Date()
  const eventTime = new Date(event.timestamp)
  const diffMs = now.getTime() - eventTime.getTime()

  switch (timeRange) {
    case '5min':
      return diffMs <= 5 * 60 * 1000 // 5 minutes
    case '1hour':
      return diffMs <= 60 * 60 * 1000 // 1 hour
    case 'today':
      return (
        eventTime.getDate() === now.getDate() &&
        eventTime.getMonth() === now.getMonth() &&
        eventTime.getFullYear() === now.getFullYear()
      )
    default:
      return true
  }
}

/**
 * Check if event matches search query
 *
 * Searches in:
 * - eventType (e.g., "job.completed")
 * - message (e.g., "TTS job completed successfully")
 * - category (e.g., "tts", "stt")
 * - payload (JSON stringified, e.g., segmentId, chapterId, etc.)
 */
function matchesSearch(event: LogEvent, query: string): boolean {
  if (!query) return true

  const lowerQuery = query.toLowerCase()

  // Search in eventType, message, and category (fast string checks)
  if (
    event.eventType.toLowerCase().includes(lowerQuery) ||
    event.message.toLowerCase().includes(lowerQuery) ||
    event.category.toLowerCase().includes(lowerQuery)
  ) {
    return true
  }

  // Search in payload (if present)
  if (event.payload) {
    try {
      const payloadString = JSON.stringify(event.payload).toLowerCase()
      if (payloadString.includes(lowerQuery)) {
        return true
      }
    } catch (error) {
      // Ignore JSON.stringify errors (edge case, shouldn't happen)
      logger.warn('[EventLog] Failed to stringify payload for search', { error })
    }
  }

  return false
}

/**
 * Event Log Store
 *
 * Manages SSE event logs with filtering and search.
 *
 * @example
 * ```tsx
 * // Add event
 * eventLogStore.getState().addEvent({
 *   category: 'tts',
 *   severity: 'success',
 *   eventType: 'job.completed',
 *   message: 'TTS job completed successfully'
 * })
 *
 * // Get filtered events
 * const filtered = eventLogStore.getState().getFilteredEvents()
 *
 * // Clear events
 * eventLogStore.getState().clearEvents()
 * ```
 */
export const eventLogStore = create<EventLogStore>()(
  persist(
    (set, get) => ({
      // State
      events: [],
      filters: DEFAULT_FILTERS,
      autoScroll: true,
      maxEvents: 1000,

      // Actions
      addEvent: (event: Partial<LogEvent>) => {
        set((state) => {
          // Generate ID and timestamp if not provided
          const newEvent: LogEvent = {
            id: event.id || generateEventId(),
            timestamp: event.timestamp || new Date(),
            category: event.category || 'health',
            severity: event.severity || 'info',
            eventType: event.eventType || 'unknown',
            message: event.message || 'Unknown event',
            payload: event.payload,
          }

          // Add new event and trim to maxEvents
          const updatedEvents = [...state.events, newEvent]
          if (updatedEvents.length > state.maxEvents) {
            // Remove oldest events
            updatedEvents.splice(0, updatedEvents.length - state.maxEvents)
          }

          return { events: updatedEvents }
        })
      },

      clearEvents: () => {
        set({ events: [] })
      },

      setFilter: (filterKey, value) => {
        set((state) => ({
          filters: {
            ...state.filters,
            [filterKey]: value,
          },
        }))
      },

      resetFilters: () => {
        set({ filters: DEFAULT_FILTERS })
      },

      toggleAutoScroll: () => {
        set((state) => ({ autoScroll: !state.autoScroll }))
      },

      getFilteredEvents: () => {
        const { events, filters } = get()

        return events.filter((event) => {
          // Category filter
          if (!filters.categories.has(event.category)) {
            return false
          }

          // Severity filter
          if (!filters.severities.has(event.severity)) {
            return false
          }

          // Time range filter
          if (!matchesTimeRange(event, filters.timeRange)) {
            return false
          }

          // Search filter
          if (!matchesSearch(event, filters.searchQuery)) {
            return false
          }

          return true
        })
      },
    }),
    {
      name: 'eventLog', // localStorage key
      partialize: (state) => ({
        // Persist only filters and autoScroll
        // Events are not persisted (volatile, memory-only)
        filters: {
          // Convert Set to Array for serialization
          categories: Array.from(state.filters.categories),
          severities: Array.from(state.filters.severities),
          timeRange: state.filters.timeRange,
          // Don't persist searchQuery (temporary)
          searchQuery: '',
        },
        autoScroll: state.autoScroll,
      }),
      merge: (persistedState: any, currentState) => {
        // Merge persisted state with default state
        // Convert arrays back to Sets
        const persistedCategories = persistedState?.filters?.categories
        const persistedSeverities = persistedState?.filters?.severities

        return {
          ...currentState,
          filters: {
            ...currentState.filters,
            ...(persistedState?.filters || {}),
            // Use persisted arrays if non-empty, otherwise fall back to defaults
            categories: new Set(
              persistedCategories && persistedCategories.length > 0
                ? persistedCategories
                : Array.from(DEFAULT_FILTERS.categories)
            ),
            severities: new Set(
              persistedSeverities && persistedSeverities.length > 0
                ? persistedSeverities
                : Array.from(DEFAULT_FILTERS.severities)
            ),
          },
          autoScroll: persistedState?.autoScroll ?? currentState.autoScroll,
        }
      },
    }
  )
)
