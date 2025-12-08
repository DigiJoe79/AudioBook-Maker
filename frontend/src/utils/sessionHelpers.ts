/**
 * Session State Helpers
 *
 * Utilities for managing session state that needs to be preserved
 * across backend disconnections and reconnections.
 */

import type { SessionState } from '@types'
import { logger } from '@utils/logger'

/**
 * Get the current session state
 *
 * This attempts to read the session state that AppLayout saves to localStorage.
 * If no saved state exists, returns a default empty state.
 *
 * @returns Current session state or empty default
 */
export function getCurrentSessionState(): SessionState {
  // Try to get from localStorage if AppLayout has saved it
  const stored = localStorage.getItem('audiobook-maker:session-state')

  if (stored) {
    try {
      const parsed = JSON.parse(stored)

      // Validate that it has the required structure
      if (
        parsed &&
        typeof parsed === 'object' &&
        'timestamp' in parsed
      ) {
        logger.group(
          '💾 Session',
          'Restored Session State',
          {
            'Project': parsed.selectedProjectId || 'None',
            'Chapter': parsed.selectedChapterId || 'None',
            'Segment': parsed.selectedSegmentId || 'None',
            'Expanded Projects': parsed.expandedProjects?.length || 0,
            'Timestamp': parsed.timestamp
          },
          '#2196F3'  // Blue for info
        )

        return {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        }
      }
    } catch (error) {
      logger.group(
        '💾 Session',
        'Failed to Parse Session State',
        {
          'Error': error,
          'Action': 'Using default empty state'
        },
        '#FF9800'  // Orange for warning
      )
      // Fall through to default
    }
  }

  // Return default empty state
  logger.group(
    '💾 Session',
    'Using Default Session State',
    {
      'Reason': 'No saved state found in localStorage',
      'Selected': 'None'
    },
    '#2196F3'  // Blue for info
  )

  return {
    selectedProjectId: null,
    selectedChapterId: null,
    selectedSegmentId: null,
    expandedProjects: [],
    timestamp: new Date(),
  }
}
