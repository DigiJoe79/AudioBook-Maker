/**
 * SSE Handlers Index - Aggregates all domain-specific SSE event handlers
 *
 * This module exports individual domain hooks and a combined useSSEHandlers()
 * hook that provides a unified interface for all SSE event handlers.
 *
 * Domain Hooks:
 * - useSSETTSHandlers - TTS job and segment handlers
 * - useSSESegmentHandlers - Segment and chapter handlers
 * - useSSEExportHandlers - Export job handlers
 * - useSSESystemHandlers - Health, speaker, settings, pronunciation handlers
 * - useSSEEngineHandlers - Engine status handlers (started, stopped, enabled, disabled)
 * - useSSEQualityHandlers - Quality analysis job and segment handlers
 *
 * Combined Hook:
 * - useSSEHandlers - Aggregates all handlers from domain hooks
 *
 * @example
 * ```tsx
 * // Use combined hook (recommended)
 * const handlers = useSSEHandlers()
 *
 * // Or use individual domain hooks if needed
 * const ttsHandlers = useSSETTSHandlers(queryClient)
 * ```
 */

import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSSETTSHandlers } from './useSSETTSHandlers'
import { useSSESegmentHandlers } from './useSSESegmentHandlers'
import { useSSEExportHandlers } from './useSSEExportHandlers'
import { useSSESystemHandlers } from './useSSESystemHandlers'
import { useSSEEngineHandlers } from './useSSEEngineHandlers'
import { useSSEQualityHandlers } from './useSSEQualityHandlers'
import { useSSEDockerHostHandlers } from './useSSEDockerHostHandlers'

/**
 * Handler function type - accepts event data only (backendUrl handled separately)
 * Using unknown to allow handlers to accept their specific data types
 */
type EventHandler = (data: unknown) => void

/**
 * Combined SSE Handlers Hook
 *
 * This hook aggregates all domain-specific SSE event handlers into a single
 * object, making it easy to use in the main SSE event router.
 *
 * The handlers are organized by event type and can be accessed using the
 * event name as the key (e.g., handlers['job.created']).
 *
 * Note: Health handler is special - it requires backendUrl as second param,
 * so it's returned separately with a different signature.
 *
 * @returns Object containing all SSE event handlers from all domains
 *
 * @example
 * ```tsx
 * const handlers = useSSEHandlers()
 *
 * // Route event to appropriate handler
 * const handler = handlers[eventType]
 * if (handler) {
 *   handler(eventData)
 * }
 * ```
 */
interface UseSSEHandlersOptions {
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

export function useSSEHandlers(options?: UseSSEHandlersOptions) {
  const queryClient = useQueryClient()

  // Get handlers from each domain
  const ttsHandlers = useSSETTSHandlers(queryClient, options) // Pass callbacks for segment.completed and job status changes
  const segmentHandlers = useSSESegmentHandlers(options) // Pass audio update callback for segment.updated/chapter.updated
  const exportHandlers = useSSEExportHandlers()
  const systemHandlers = useSSESystemHandlers()
  const engineHandlers = useSSEEngineHandlers() // Engine status handlers
  const qualityHandlers = useSSEQualityHandlers() // Quality analysis handlers
  const dockerHostHandlers = useSSEDockerHostHandlers() // Docker host connection handlers

  // Combine all handlers into a single STABLE object using useMemo
  // This prevents stale closure issues in useSSEEventHandlers where handleEvent
  // callback would otherwise capture an outdated handlers reference.
  // The memo dependencies are the handler objects from each domain - these are
  // stable because their individual handler functions are wrapped with useCallback.
  return useMemo(() => ({
    // TTS Job handlers
    'job.created': ttsHandlers.handleJobCreated as EventHandler,
    'job.started': ttsHandlers.handleJobStarted as EventHandler,
    'job.progress': ttsHandlers.handleJobProgress as EventHandler,
    'job.completed': ttsHandlers.handleJobCompleted as EventHandler,
    'job.failed': ttsHandlers.handleJobFailed as EventHandler,
    'job.cancelling': ttsHandlers.handleJobCancelling as EventHandler,
    'job.cancelled': ttsHandlers.handleJobCancelled as EventHandler,
    'job.resumed': ttsHandlers.handleJobResumed as EventHandler,

    // Segment handlers (from TTS domain)
    'segment.started': ttsHandlers.handleSegmentStarted as EventHandler,
    'segment.completed': ttsHandlers.handleSegmentCompleted as EventHandler,
    'segment.failed': ttsHandlers.handleSegmentFailed as EventHandler,

    // Segment & Chapter handlers (from Segment domain)
    'segment.updated': segmentHandlers.handleSegmentUpdated as EventHandler,
    'segment.frozen': segmentHandlers.handleSegmentFrozen as EventHandler,
    'segment.unfrozen': segmentHandlers.handleSegmentFrozen as EventHandler,
    'segment.created': segmentHandlers.handleSegmentCreated as EventHandler,
    'segment.deleted': segmentHandlers.handleSegmentDeleted as EventHandler,
    'segment.reordered': segmentHandlers.handleSegmentReordered as EventHandler,
    'chapter.updated': segmentHandlers.handleChapterUpdated as EventHandler,

    // Export handlers
    'export.started': exportHandlers.handleExportStarted as EventHandler,
    'export.progress': exportHandlers.handleExportProgress as EventHandler,
    'export.completed': exportHandlers.handleExportCompleted as EventHandler,
    'export.failed': exportHandlers.handleExportFailed as EventHandler,
    'export.cancelled': exportHandlers.handleExportCancelled as EventHandler,

    // System handlers (health has different signature - handled separately in routeEvent)
    'health.update': systemHandlers.handleHealthUpdate,
    'speaker.created': systemHandlers.handleSpeakerCreated as EventHandler,
    'speaker.updated': systemHandlers.handleSpeakerUpdated as EventHandler,
    'speaker.deleted': systemHandlers.handleSpeakerDeleted as EventHandler,
    'speaker.sample_added': systemHandlers.handleSpeakerSampleAdded as EventHandler,
    'speaker.sample_deleted': systemHandlers.handleSpeakerSampleDeleted as EventHandler,
    'settings.updated': systemHandlers.handleSettingsUpdated as EventHandler,
    'settings.reset': systemHandlers.handleSettingsReset as EventHandler,

    // Project events
    'project.created': systemHandlers.handleProjectCreated as EventHandler,
    'project.updated': systemHandlers.handleProjectUpdated as EventHandler,
    'project.deleted': systemHandlers.handleProjectDeleted as EventHandler,
    'project.reordered': systemHandlers.handleProjectReordered as EventHandler,

    // Chapter CRUD events
    'chapter.created': systemHandlers.handleChapterCreated as EventHandler,
    'chapter.deleted': systemHandlers.handleChapterDeleted as EventHandler,
    'chapter.reordered': systemHandlers.handleChapterReordered as EventHandler,

    'pronunciation.rule.created': systemHandlers.handlePronunciationRuleCreated as EventHandler,
    'pronunciation.rule.updated': systemHandlers.handlePronunciationRuleUpdated as EventHandler,
    'pronunciation.rule.deleted': systemHandlers.handlePronunciationRuleDeleted as EventHandler,
    'pronunciation.rule.bulk_change': systemHandlers.handlePronunciationRuleBulkChange as EventHandler,
    'pronunciation.rules.imported': systemHandlers.handlePronunciationRulesImported as EventHandler,

    // Import handlers
    'import.started': systemHandlers.handleImportStarted as EventHandler,
    'import.progress': systemHandlers.handleImportProgress as EventHandler,
    'import.completed': systemHandlers.handleImportCompleted as EventHandler,
    'import.failed': systemHandlers.handleImportFailed as EventHandler,
    'import.cancelled': systemHandlers.handleImportCancelled as EventHandler,

    // Engine handlers
    'engine.status': engineHandlers.handleEngineStatus as EventHandler,
    'engine.starting': engineHandlers.handleEngineStarting as EventHandler,
    'engine.started': engineHandlers.handleEngineStarted as EventHandler,
    'engine.model_loaded': engineHandlers.handleEngineModelLoaded as EventHandler,
    'engine.stopping': engineHandlers.handleEngineStopping as EventHandler,
    'engine.stopped': engineHandlers.handleEngineStopped as EventHandler,
    'engine.enabled': engineHandlers.handleEngineEnabled as EventHandler,
    'engine.disabled': engineHandlers.handleEngineDisabled as EventHandler,
    'engine.error': engineHandlers.handleEngineError as EventHandler,

    // Docker image handlers
    'docker.image.installing': engineHandlers.handleDockerImageInstalling as EventHandler,
    'docker.image.progress': engineHandlers.handleDockerImageProgress as EventHandler,
    'docker.image.installed': engineHandlers.handleDockerImageInstalled as EventHandler,
    'docker.image.uninstalled': engineHandlers.handleDockerImageUninstalled as EventHandler,
    'docker.image.cancelled': engineHandlers.handleDockerImageCancelled as EventHandler,
    'docker.image.error': engineHandlers.handleDockerImageError as EventHandler,

    // Docker host handlers
    'docker.host.connected': dockerHostHandlers.handleDockerHostConnected as EventHandler,
    'docker.host.disconnected': dockerHostHandlers.handleDockerHostDisconnected as EventHandler,
    'docker.host.connecting': dockerHostHandlers.handleDockerHostConnecting as EventHandler,

    // Quality handlers
    'quality.job.created': qualityHandlers['quality.job.created'] as EventHandler,
    'quality.job.started': qualityHandlers['quality.job.started'] as EventHandler,
    'quality.job.progress': qualityHandlers['quality.job.progress'] as EventHandler,
    'quality.job.completed': qualityHandlers['quality.job.completed'] as EventHandler,
    'quality.job.failed': qualityHandlers['quality.job.failed'] as EventHandler,
    'quality.job.cancelled': qualityHandlers['quality.job.cancelled'] as EventHandler,
    'quality.job.resumed': qualityHandlers['quality.job.resumed'] as EventHandler,
    'quality.segment.analyzed': qualityHandlers['quality.segment.analyzed'] as EventHandler,
    'quality.segment.failed': qualityHandlers['quality.segment.failed'] as EventHandler,
  }), [
    ttsHandlers,
    segmentHandlers,
    exportHandlers,
    systemHandlers,
    engineHandlers,
    qualityHandlers,
    dockerHostHandlers,
  ])
}
