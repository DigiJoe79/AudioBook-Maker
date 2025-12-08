/**
 * SSE System Event Handlers
 *
 * Handles system-related SSE events including:
 * - Health events (health.update)
 * - Speaker events (speaker.created, speaker.updated, speaker.deleted, speaker.sample_added, speaker.sample_deleted)
 * - Settings events (settings.updated, settings.reset)
 * - Pronunciation Rules events (pronunciation.rule.created, updated, deleted, bulk_change, rules.imported)
 * - Import events (import.started, import.progress, import.completed, import.failed)
 * - Project events (project.created, project.updated, project.deleted)
 * - Chapter events (chapter.created, chapter.deleted, chapter.reordered)
 */

import { useCallback } from 'react'
import { useQueryClient, QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'
import type {
  HealthUpdateData,
  SpeakerCreatedData,
  SpeakerUpdatedData,
  SpeakerDeletedData,
  SpeakerSampleAddedData,
  SpeakerSampleDeletedData,
  SettingsUpdatedData,
  SettingsResetData,
  PronunciationRuleCreatedData,
  PronunciationRuleUpdatedData,
  PronunciationRuleDeletedData,
  PronunciationRuleBulkChangeData,
  ImportStartedData,
  ImportProgressData,
  ImportCompletedData,
  ImportFailedData,
  ImportCancelledData,
  ProjectReorderedData,
} from '@/types/sseEvents'

// ============================================================================
// Health Event Handlers
// ============================================================================

/**
 * Handle health.update event
 * Action: Update backend health cache with latest status
 *
 * This enables real-time health monitoring via SSE instead of polling.
 * The health data is cached in React Query and used by useConnectionMonitor.
 *
 * NOTE: Engine availability (hasTtsEngine, hasTextEngine, hasSttEngine, hasAudioEngine)
 * comes ONLY from engine.status SSE events, NOT from health.update.
 * The backend sends null for these fields in health.update.
 */
function handleHealthUpdate(
  data: HealthUpdateData,
  queryClient: QueryClient,
  backendUrl: string
) {
  try {
    // Update backend-health query cache
    // Note: Cache structure matches useBackendHealth return type
    queryClient.setQueryData(
      queryKeys.health(),
      {
        status: data.status,
        version: data.version,
        timestamp: data.timestamp,
        database: data.database,
        ttsEngines: data.ttsEngines,
        busy: data.busy,
        activeJobs: data.activeJobs,
      }
    )

    // Log significant status changes or database issues
    if (data.status === 'error') {
      logger.error('[SSE] Health update - Backend error: status=error')
    } else if (!data.database) {
      logger.warn('[SSE] Health update - Database connectivity issue')
    }
    // Health updates logged at debug level via shouldLog() environment gating
  } catch (error) {
    logger.error('[SSE] Failed to handle health.update event:', error)
  }
}

// ============================================================================
// Speaker Event Handlers
// ============================================================================

/**
 * Handle speaker.created event
 */
function handleSpeakerCreated(data: SpeakerCreatedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Speaker created', {
      'Speaker ID': data.speakerId,
      'Event Type': 'speaker.created'
    }, '#4CAF50')

    // Invalidate speakers list query
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.created event:', error)
  }
}

/**
 * Handle speaker.updated event
 */
function handleSpeakerUpdated(data: SpeakerUpdatedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Speaker updated', {
      'Speaker ID': data.speakerId,
      'Event Type': 'speaker.updated'
    }, '#2196F3')

    // Invalidate speaker detail and list queries
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.detail(data.speakerId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.updated event:', error)
  }
}

/**
 * Handle speaker.deleted event
 */
function handleSpeakerDeleted(data: SpeakerDeletedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Speaker deleted', {
      'Speaker ID': data.speakerId,
      'Event Type': 'speaker.deleted'
    }, '#FF9800')

    // Remove from cache and invalidate list
    queryClient.removeQueries({
      queryKey: queryKeys.speakers.detail(data.speakerId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.deleted event:', error)
  }
}

/**
 * Handle speaker.sample_added event
 */
function handleSpeakerSampleAdded(data: SpeakerSampleAddedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Speaker sample added', {
      'Speaker ID': data.speakerId,
      'Sample ID': data.sampleId,
      'Event Type': 'speaker.sample_added'
    }, '#4CAF50')

    // Invalidate speaker detail (includes samples array)
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.detail(data.speakerId)
    })

    // CRITICAL: Also invalidate speakers list (is_active may have changed when first sample added)
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.sample_added event:', error)
  }
}

/**
 * Handle speaker.sample_deleted event
 */
function handleSpeakerSampleDeleted(data: SpeakerSampleDeletedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Speaker sample deleted', {
      'Speaker ID': data.speakerId,
      'Sample ID': data.sampleId,
      'Event Type': 'speaker.sample_deleted'
    }, '#FF9800')

    // Invalidate speaker detail
    queryClient.invalidateQueries({
      queryKey: queryKeys.speakers.detail(data.speakerId)
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.sample_deleted event:', error)
  }
}

// ============================================================================
// Settings Event Handlers
// ============================================================================

/**
 * Handle settings.updated event
 */
function handleSettingsUpdated(data: SettingsUpdatedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Settings updated', {
      'Setting Key': data.key,
      'Event Type': 'settings.updated'
    }, '#2196F3')

    // Invalidate all settings queries
    queryClient.invalidateQueries({
      queryKey: queryKeys.settings.all()
    })

    // Also invalidate specific setting key if provided
    if (data.key) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.detail(data.key)
      })
    }
  } catch (error) {
    logger.error('[SSE] Failed to handle settings.updated event:', error)
  }
}

/**
 * Handle settings.reset event
 */
function handleSettingsReset(_data: SettingsResetData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Settings reset to defaults', {
      'Event Type': 'settings.reset'
    }, '#4CAF50')

    // Invalidate all settings queries
    queryClient.invalidateQueries({
      queryKey: queryKeys.settings.all()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle settings.reset event:', error)
  }
}

// ============================================================================
// Project Event Handlers
// ============================================================================

/**
 * Handle project.created event
 */
function handleProjectCreated(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Project created', {
      'Project ID': data.projectId,
      'Event Type': 'project.created'
    }, '#4CAF50')

    // Invalidate projects list query
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle project.created event:', error)
  }
}

/**
 * Handle project.updated event
 */
function handleProjectUpdated(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Project updated', {
      'Project ID': data.projectId,
      'Event Type': 'project.updated'
    }, '#2196F3')

    // Invalidate projects list and detail queries
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(data.projectId as string)
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle project.updated event:', error)
  }
}

/**
 * Handle project.deleted event
 */
function handleProjectDeleted(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Project deleted', {
      'Project ID': data.projectId,
      'Event Type': 'project.deleted'
    }, '#FF9800')

    // Invalidate projects list query
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle project.deleted event:', error)
  }
}

// ============================================================================
// Chapter CRUD Event Handlers
// ============================================================================

/**
 * Handle chapter.created event
 * BUG FIX: chapters.list() is not used - chapters are nested in projects
 */
function handleChapterCreated(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Chapter created', {
      'Chapter ID': data.chapterId,
      'Project ID': data.projectId,
      'Event Type': 'chapter.created'
    }, '#4CAF50')

    // Invalidate projects (chapters are nested)
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
    if (data.projectId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(data.projectId as string)
      })
    }
  } catch (error) {
    logger.error('[SSE] Failed to handle chapter.created event:', error)
  }
}

/**
 * Handle chapter.deleted event
 * BUG FIX: chapters.list() is not used - chapters are nested in projects
 * BUG FIX: Remove chapter query to prevent 404 refetches from stale session state
 */
function handleChapterDeleted(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Chapter deleted', {
      'Chapter ID': data.chapterId,
      'Project ID': data.projectId,
      'Event Type': 'chapter.deleted'
    }, '#FF9800')

    // Remove the deleted chapter's query to prevent 404 refetches
    if (data.chapterId) {
      queryClient.removeQueries({
        queryKey: queryKeys.chapters.detail(data.chapterId as string)
      })
    }

    // Invalidate projects (chapters are nested)
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
    if (data.projectId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(data.projectId as string)
      })
    }
  } catch (error) {
    logger.error('[SSE] Failed to handle chapter.deleted event:', error)
  }
}

/**
 * Handle chapter.reordered event
 * BUG FIX: chapters.list() is not used - chapters are nested in projects
 */
function handleChapterReordered(data: Record<string, unknown>, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Chapters reordered', {
      'Project ID': data.projectId,
      'Event Type': 'chapter.reordered'
    }, '#2196F3')

    // Invalidate projects (chapters are nested)
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
    if (data.projectId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(data.projectId as string)
      })
    }
  } catch (error) {
    logger.error('[SSE] Failed to handle chapter.reordered event:', error)
  }
}

/**
 * Handle project.reordered event
 */
function handleProjectReordered(data: ProjectReorderedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Projects reordered', {
      'Project Count': data.projectIds?.length ?? 0,
      'Event Type': 'project.reordered'
    }, '#FF9800')

    // Invalidate projects list
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists()
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle project.reordered event:', error)
  }
}

// ============================================================================
// Import Event Handlers
// ============================================================================

/**
 * Handle import.started event
 */
function handleImportStarted(data: ImportStartedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Import started', {
      'Import ID': data.importId,
      'Status': data.status,
      'Event Type': 'import.started'
    }, '#2196F3')
  } catch (error) {
    logger.error('[SSE] Failed to handle import.started event:', error)
  }
}

/**
 * Handle import.progress event
 */
function handleImportProgress(data: ImportProgressData, queryClient: QueryClient) {
  try {
    // Use debug for frequent progress events to reduce log noise
    logger.debug('[SSE] Import progress:', data.progress, '%')
  } catch (error) {
    logger.error('[SSE] Failed to handle import.progress event:', error)
  }
}

/**
 * Handle import.completed event
 */
function handleImportCompleted(data: ImportCompletedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Import completed', {
      'Project ID': data.projectId,
      'Chapters': data.chapterCount,
      'Segments': data.segmentCount,
      'Event Type': 'import.completed'
    }, '#4CAF50')

    // Invalidate projects list since new project was imported
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })
    if (data.projectId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(data.projectId) })
    }
  } catch (error) {
    logger.error('[SSE] Failed to handle import.completed event:', error)
  }
}

/**
 * Handle import.failed event
 */
function handleImportFailed(data: ImportFailedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Import failed', {
      'Error': data.error,
      'Message': data.message,
      'Event Type': 'import.failed'
    }, '#F44336')
  } catch (error) {
    logger.error('[SSE] Failed to handle import.failed event:', error)
  }
}

/**
 * Handle import.cancelled event
 */
function handleImportCancelled(data: ImportCancelledData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', 'Import cancelled', {
      'Import ID': data.importId,
      'Message': data.message ?? 'User cancelled',
      'Event Type': 'import.cancelled'
    }, '#FF9800')
  } catch (error) {
    logger.error('[SSE] Failed to handle import.cancelled event:', error)
  }
}

// ============================================================================
// Pronunciation Rules Event Handlers
// ============================================================================

/**
 * Handle pronunciation.rule.created event
 */
function handlePronunciationRuleCreated(data: PronunciationRuleCreatedData, queryClient: QueryClient) {
  try {
    queryClient.invalidateQueries({ queryKey: queryKeys.pronunciation.all })

    logger.group('📡 SSE Event', 'Pronunciation rule created', {
      'Pattern': data.rule?.pattern ?? 'unknown',
      'Replacement': data.rule?.replacement ?? 'unknown',
      'Event Type': 'pronunciation.rule.created'
    }, '#4CAF50')
  } catch (error) {
    logger.error('[SSE] Failed to handle pronunciation.rule.created event:', error)
  }
}

/**
 * Handle pronunciation.rule.updated event
 */
function handlePronunciationRuleUpdated(data: PronunciationRuleUpdatedData, queryClient: QueryClient) {
  try {
    queryClient.invalidateQueries({ queryKey: queryKeys.pronunciation.all })
    if (data.rule?.id) {
      try {
        // Update specific rule in cache if available
        queryClient.setQueryData(
          queryKeys.pronunciation.detail(data.rule.id),
          data.rule
        )
      } catch (cacheError) {
        logger.error('[SSE] Failed to update pronunciation rule in cache', {
          ruleId: data.rule.id,
          error: cacheError instanceof Error ? cacheError.message : String(cacheError)
        })
        // Recovery: invalidate detail query
        queryClient.invalidateQueries({
          queryKey: queryKeys.pronunciation.detail(data.rule.id)
        })
      }
    }

    logger.group('📡 SSE Event', 'Pronunciation rule updated', {
      'Rule ID': data.rule?.id ?? 'unknown',
      'Pattern': data.rule?.pattern ?? 'unknown',
      'Event Type': 'pronunciation.rule.updated'
    }, '#2196F3')
  } catch (error) {
    logger.error('[SSE] Failed to handle pronunciation.rule.updated event:', error)
  }
}

/**
 * Handle pronunciation.rule.deleted event
 */
function handlePronunciationRuleDeleted(data: PronunciationRuleDeletedData, queryClient: QueryClient) {
  try {
    queryClient.invalidateQueries({ queryKey: queryKeys.pronunciation.all })
    if (data.ruleId) {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: queryKeys.pronunciation.detail(data.ruleId)
      })
    }

    logger.group('📡 SSE Event', 'Pronunciation rule deleted', {
      'Rule ID': data.ruleId ?? 'unknown',
      'Event Type': 'pronunciation.rule.deleted'
    }, '#FF9800')
  } catch (error) {
    logger.error('[SSE] Failed to handle pronunciation.rule.deleted event:', error)
  }
}

/**
 * Handle pronunciation.rule.bulk_change event
 */
function handlePronunciationRuleBulkChange(data: PronunciationRuleBulkChangeData, queryClient: QueryClient) {
  try {
    queryClient.invalidateQueries({ queryKey: queryKeys.pronunciation.all })

    logger.group('📡 SSE Event', `Pronunciation bulk: ${data.action}`, {
      'Action': data.action,
      'Count': data.count,
      'Event Type': 'pronunciation.rule.bulk_change'
    }, '#9C27B0')
  } catch (error) {
    logger.error('[SSE] Failed to handle pronunciation.rule.bulk_change event:', error)
  }
}

/**
 * Handle pronunciation.rules.imported event
 * Action: Invalidate pronunciation rules cache to refresh imported rules
 */
function handlePronunciationRulesImported(data: PronunciationRuleBulkChangeData, queryClient: QueryClient) {
  try {
    queryClient.invalidateQueries({ queryKey: queryKeys.pronunciation.all })

    logger.group('📡 SSE Event', 'Pronunciation rules imported', {
      'Count': data.count,
      'Event Type': 'pronunciation.rules.imported'
    }, '#4CAF50')
  } catch (error) {
    logger.error('[SSE] Failed to handle pronunciation.rules.imported event:', error)
  }
}


// ============================================================================
// Exported Hook
// ============================================================================

/**
 * Custom hook that provides system-related SSE event handlers
 *
 * @returns Object containing handler functions for system events
 */
export function useSSESystemHandlers() {
  const queryClient = useQueryClient()

  return {
    // Health handlers
    handleHealthUpdate: useCallback(
      (data: HealthUpdateData, backendUrl: string) =>
        handleHealthUpdate(data, queryClient, backendUrl),
      [queryClient]
    ),

    // Speaker handlers
    handleSpeakerCreated: useCallback(
      (data: SpeakerCreatedData) => handleSpeakerCreated(data, queryClient),
      [queryClient]
    ),
    handleSpeakerUpdated: useCallback(
      (data: SpeakerUpdatedData) => handleSpeakerUpdated(data, queryClient),
      [queryClient]
    ),
    handleSpeakerDeleted: useCallback(
      (data: SpeakerDeletedData) => handleSpeakerDeleted(data, queryClient),
      [queryClient]
    ),
    handleSpeakerSampleAdded: useCallback(
      (data: SpeakerSampleAddedData) => handleSpeakerSampleAdded(data, queryClient),
      [queryClient]
    ),
    handleSpeakerSampleDeleted: useCallback(
      (data: SpeakerSampleDeletedData) => handleSpeakerSampleDeleted(data, queryClient),
      [queryClient]
    ),

    // Settings handlers
    handleSettingsUpdated: useCallback(
      (data: SettingsUpdatedData) => handleSettingsUpdated(data, queryClient),
      [queryClient]
    ),
    handleSettingsReset: useCallback(
      (data: SettingsResetData) => handleSettingsReset(data, queryClient),
      [queryClient]
    ),

    // Project handlers
    handleProjectCreated: useCallback(
      (data: Record<string, unknown>) => handleProjectCreated(data, queryClient),
      [queryClient]
    ),
    handleProjectUpdated: useCallback(
      (data: Record<string, unknown>) => handleProjectUpdated(data, queryClient),
      [queryClient]
    ),
    handleProjectDeleted: useCallback(
      (data: Record<string, unknown>) => handleProjectDeleted(data, queryClient),
      [queryClient]
    ),
    handleProjectReordered: useCallback(
      (data: ProjectReorderedData) => handleProjectReordered(data, queryClient),
      [queryClient]
    ),

    // Chapter CRUD handlers
    handleChapterCreated: useCallback(
      (data: Record<string, unknown>) => handleChapterCreated(data, queryClient),
      [queryClient]
    ),
    handleChapterDeleted: useCallback(
      (data: Record<string, unknown>) => handleChapterDeleted(data, queryClient),
      [queryClient]
    ),
    handleChapterReordered: useCallback(
      (data: Record<string, unknown>) => handleChapterReordered(data, queryClient),
      [queryClient]
    ),

    // Pronunciation Rules handlers
    handlePronunciationRuleCreated: useCallback(
      (data: PronunciationRuleCreatedData) => handlePronunciationRuleCreated(data, queryClient),
      [queryClient]
    ),
    handlePronunciationRuleUpdated: useCallback(
      (data: PronunciationRuleUpdatedData) => handlePronunciationRuleUpdated(data, queryClient),
      [queryClient]
    ),
    handlePronunciationRuleDeleted: useCallback(
      (data: PronunciationRuleDeletedData) => handlePronunciationRuleDeleted(data, queryClient),
      [queryClient]
    ),
    handlePronunciationRuleBulkChange: useCallback(
      (data: PronunciationRuleBulkChangeData) => handlePronunciationRuleBulkChange(data, queryClient),
      [queryClient]
    ),
    handlePronunciationRulesImported: useCallback(
      (data: PronunciationRuleBulkChangeData) => handlePronunciationRulesImported(data, queryClient),
      [queryClient]
    ),

    // Import handlers
    handleImportStarted: useCallback(
      (data: ImportStartedData) => handleImportStarted(data, queryClient),
      [queryClient]
    ),
    handleImportProgress: useCallback(
      (data: ImportProgressData) => handleImportProgress(data, queryClient),
      [queryClient]
    ),
    handleImportCompleted: useCallback(
      (data: ImportCompletedData) => handleImportCompleted(data, queryClient),
      [queryClient]
    ),
    handleImportFailed: useCallback(
      (data: ImportFailedData) => handleImportFailed(data, queryClient),
      [queryClient]
    ),
    handleImportCancelled: useCallback(
      (data: ImportCancelledData) => handleImportCancelled(data, queryClient),
      [queryClient]
    ),
  }
}
