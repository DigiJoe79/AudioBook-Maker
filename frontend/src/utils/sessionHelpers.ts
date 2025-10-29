
import type { SessionState } from '../types/backend'

export function getCurrentSessionState(): SessionState {
  const stored = localStorage.getItem('audiobook-maker:session-state')

  if (stored) {
    try {
      const parsed = JSON.parse(stored)

      if (
        parsed &&
        typeof parsed === 'object' &&
        'timestamp' in parsed
      ) {
        return {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        }
      }
    } catch (error) {
      console.error('[SessionHelpers] Failed to parse stored session state:', error)
    }
  }

  return {
    selectedProjectId: null,
    selectedChapterId: null,
    selectedSegmentId: null,
    expandedProjects: [],
    timestamp: new Date(),
  }
}
