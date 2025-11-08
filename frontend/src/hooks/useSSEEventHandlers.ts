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
 * - Export Events: export.started, export.progress, export.completed, export.failed
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

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSSEConnection } from '../contexts/SSEContext'
import { useAppStore } from '../store/appStore'
import { queryKeys } from '../services/queryKeys'
import type { TTSJob, Segment, Chapter } from '../types'
import { logger } from '../utils/logger'

// ============================================================================
// Event Data Types
// ============================================================================

/**
 * Segment ID with job status (matches backend structure)
 */
interface SegmentJobStatus {
  id: string
  job_status: 'pending' | 'completed'
}

/**
 * Job progress event data
 */
interface JobProgressData {
  jobId: string
  chapterId: string
  status: 'running'
  progress: number
  processedSegments: number
  totalSegments: number
  currentSegmentId?: string
  segmentIds?: SegmentJobStatus[]
}

/**
 * Job completed event data
 */
interface JobCompletedData {
  jobId: string
  chapterId: string
  status: 'completed'
  processedSegments: number
  totalSegments: number
  progress: number
  segmentIds?: SegmentJobStatus[]
}

/**
 * Job failed event data
 */
interface JobFailedData {
  jobId: string
  chapterId: string
  status: 'failed'
  error: string
  segmentIds?: SegmentJobStatus[]
}

/**
 * Job cancelled event data
 */
interface JobCancelledData {
  jobId: string
  chapterId: string
  status: 'cancelled'
  segmentIds?: SegmentJobStatus[]
}

/**
 * Job resumed event data
 */
interface JobResumedData {
  jobId: string
  chapterId: string
  status: 'pending'
}

/**
 * Job created event data
 */
interface JobCreatedData {
  jobId: string
  chapterId: string
  status: 'pending'
  totalSegments: number
  processedSegments: number
  progress: number
  segmentIds?: SegmentJobStatus[]
}

/**
 * Job started event data
 */
interface JobStartedData {
  jobId: string
  chapterId: string
  status: 'running'
  totalSegments: number
  processedSegments: number
  progress: number
  segmentIds?: SegmentJobStatus[]
}

/**
 * Segment started event data
 */
interface SegmentStartedData {
  segmentId: string
  chapterId: string
  status: 'processing'
}

/**
 * Segment completed event data
 */
interface SegmentCompletedData {
  segmentId: string
  chapterId: string
  status: 'completed'
  audioPath: string
}

/**
 * Segment failed event data
 */
interface SegmentFailedData {
  segmentId: string
  chapterId: string
  status: 'failed'
  error: string
}

/**
 * Segment updated event data (general update)
 */
interface SegmentUpdatedData {
  segmentId: string
  chapterId: string
  [key: string]: any
}

/**
 * Chapter updated event data
 */
interface ChapterUpdatedData {
  chapterId: string
  [key: string]: any
}

/**
 * Export progress event data
 */
interface ExportProgressData {
  exportId: string
  status: 'running' | 'completed' | 'failed'
  progress?: number
  error?: string
  outputPath?: string
}

/**
 * Health update event data
 *
 * Matches HealthResponse from backend (camelCase keys via Pydantic).
 */
interface HealthUpdateData {
  status: 'ok' | 'error'
  version: string
  timestamp: string
  database: boolean
  ttsEngines: string[]
  busy: boolean
  activeJobs: number
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Helper: Update job in ALL job-related caches (optimistic only)
 *
 * IMPORTANT: Does NOT invalidate queries to avoid excessive refetches.
 * Only updates cache optimistically. Final invalidation happens at job.completed/failed.
 */
function updateJobInAllCaches(
  queryClient: any,
  jobId: string,
  updates: Partial<TTSJob>
) {
  // Helper function to update jobs array
  const updateJobsArray = (oldData: any) => {
    if (!oldData?.jobs) return oldData
    return {
      ...oldData,
      jobs: oldData.jobs.map((job: TTSJob) =>
        job.id === jobId ? { ...job, ...updates } : job
      )
    }
  }

  // 1. Update activeJobs cache (for badge)
  queryClient.setQueryData(
    queryKeys.tts.activeJobs(),
    updateJobsArray
  )

  // 2. Update ALL general jobs queries (with any filters)
  // This updates the JobsPanel dialog
  queryClient.setQueryData(
    ['tts', 'jobs', { limit: 50 }],
    updateJobsArray
  )

  // 3. Update specific job query if it exists
  queryClient.setQueryData(
    queryKeys.tts.job(jobId),
    (oldJob: TTSJob | undefined) => {
      if (!oldJob) return oldJob
      return { ...oldJob, ...updates }
    }
  )

  // NO invalidation here - that would cause refetch on every progress event!
  // Final authoritative refetch happens at job.completed/failed events only
}

/**
 * Invalidate queries for a specific chapter
 *
 * Invalidates:
 * - Chapter detail query (includes segments array)
 * - Segment queries for this chapter
 *
 * Note: Projects list is NOT invalidated here (done at job.completed/failed)
 * to avoid excessive refetches during segment-level updates.
 */
function invalidateChapterQueries(queryClient: any, chapterId: string) {
  // Invalidate chapter detail (includes segments with status badges)
  queryClient.invalidateQueries({
    queryKey: queryKeys.chapters.detail(chapterId),
    exact: false
  })

  // Invalidate segment queries for this chapter
  queryClient.invalidateQueries({
    queryKey: queryKeys.segments.lists(),
    predicate: (query: any) => {
      // Only invalidate segment queries for this specific chapter
      const queryKey = query.queryKey as string[]
      return queryKey.includes(chapterId)
    }
  })
}

/**
 * Handle job.created event
 * Action: Add new job to cache optimistically + set segments to 'queued' status
 *
 * This provides IMMEDIATE UI feedback when user creates a job,
 * before the worker picks it up (eliminates 1-second delay).
 *
 * NO INVALIDATION - We add the job optimistically to avoid flickering
 */
function handleJobCreated(data: JobCreatedData, queryClient: any) {
  try {
    logger.group(
      '📝 Job Created',
      'New TTS job created and queued',
      {
        'Job ID': data.jobId,
        'Chapter ID': data.chapterId,
        'Total Segments': data.totalSegments,
        'Queued Segments': data.segmentIds?.length || 0,
        'Initial Status': data.status
      },
      '#4CAF50' // Green for job creation
    )

    // 1. Add new job to cache optimistically (no refetch needed)
    // Try to get chapter/project titles from cache for better UX
    let chapterTitle = null
    let projectTitle = null

    if (data.chapterId) {
      const chapterData = queryClient.getQueryData(
        queryKeys.chapters.detail(data.chapterId)
      ) as any

      if (chapterData) {
        chapterTitle = chapterData.title

        // Try to get project title from projects list
        const projectsData = queryClient.getQueryData(
          queryKeys.projects.lists()
        ) as any

        if (projectsData && chapterData.projectId) {
          const project = projectsData.find((p: any) => p.id === chapterData.projectId)
          if (project) {
            projectTitle = project.title
          }
        }
      }
    }

    const newJob: Partial<TTSJob> = {
      id: data.jobId,
      chapterId: data.chapterId,
      chapterTitle: chapterTitle,
      projectTitle: projectTitle,
      ttsEngine: '',
      ttsModelName: '',
      ttsSpeakerName: '',
      language: '',
      forceRegenerate: false,
      status: 'pending',
      totalSegments: data.totalSegments || 0,
      processedSegments: data.processedSegments || 0,
      failedSegments: 0,
      currentSegmentId: null,
      errorMessage: null,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date().toISOString(),
    }

    // Add to ALL jobs cache queries
    const addJobToCache = (oldData: any) => {
      if (!oldData?.jobs) return oldData
      // Check if job already exists (avoid duplicates)
      const exists = oldData.jobs.some((job: any) => job.id === data.jobId)
      if (exists) return oldData
      return {
        ...oldData,
        jobs: [newJob, ...oldData.jobs],
        count: (oldData.count || 0) + 1
      }
    }

    // 1. Update activeJobs cache (for badge in AppLayout)
    queryClient.setQueryData(
      queryKeys.tts.activeJobs(),
      addJobToCache
    )

    // 2. Update general jobs cache (for JobsPanel dialog)
    queryClient.setQueryData(
      ['tts', 'jobs', { limit: 50 }],
      addJobToCache
    )

    // 2. Set segments to 'queued' status (database status, not optimistic)
    // This provides instant visual feedback when job is created
    if (data.segmentIds && data.chapterId) {
      queryClient.setQueryData(
        queryKeys.chapters.detail(data.chapterId),
        (oldChapter: Chapter | undefined) => {
          if (!oldChapter) {
            logger.warn('[SSE] Chapter not in cache, invalidating instead:', data.chapterId)
            // If chapter not in cache, invalidate to trigger refetch
            invalidateChapterQueries(queryClient, data.chapterId)
            return oldChapter
          }

          // Get segment IDs that are pending in this job
          const queuedSegmentIds = new Set(
            data.segmentIds!
              .filter(seg => seg.job_status === 'pending')
              .map(seg => seg.id)
          )

          return {
            ...oldChapter,
            segments: oldChapter.segments.map(segment =>
              queuedSegmentIds.has(segment.id)
                ? { ...segment, status: 'queued' as const, audioPath: null }
                : segment
            )
          }
        }
      )

      // NO invalidation here - optimistic update already updated cache
      // (Fallback invalidation at line 383 handles case when chapter not in cache)

      logger.group(
        '✅ Segments Queued',
        'Segments marked as queued for immediate UI feedback',
        {
          'Queued Count': data.segmentIds.filter(s => s.job_status === 'pending').length,
          'Chapter ID': data.chapterId,
          'Feedback Type': 'Optimistic (instant)'
        },
        '#2196F3' // Blue for status updates
      )
    } else {
      logger.group(
        '⚠️ Job Created (Incomplete)',
        'Missing data in job.created event',
        {
          'Has Segment IDs': !!data.segmentIds,
          'Has Chapter ID': !!data.chapterId,
          'Impact': 'Cannot set queued status'
        },
        '#FF9800' // Orange for warning
      )
    }
  } catch (error) {
    logger.group(
      '❌ Job Created Handler Failed',
      'Error handling job.created event',
      {
        'Error': error instanceof Error ? error.message : String(error),
        'Job ID': data.jobId
      },
      '#F44336' // Red for error
    )
  }
}

/**
 * Handle job.started event
 * Action: Update job status to 'running'
 *
 * Note: Segments are already set to 'queued' by job.created event.
 * This event just marks the job as running when worker picks it up.
 * Also updates titles if they weren't available at job.created time.
 */
function handleJobStarted(data: JobStartedData, queryClient: any) {
  try {
    logger.group(
      '▶️ Job Started',
      'Worker picked up job and started processing',
      {
        'Job ID': data.jobId,
        'Chapter ID': data.chapterId,
        'Total Segments': data.totalSegments,
        'Status': data.status
      },
      '#2196F3' // Blue for job progress
    )

    // Try to get chapter/project titles from cache (in case they weren't available at job.created)
    let chapterTitle = null
    let projectTitle = null

    if (data.chapterId) {
      const chapterData = queryClient.getQueryData(
        queryKeys.chapters.detail(data.chapterId)
      ) as any

      if (chapterData) {
        chapterTitle = chapterData.title

        const projectsData = queryClient.getQueryData(
          queryKeys.projects.lists()
        ) as any

        if (projectsData && chapterData.projectId) {
          const project = projectsData.find((p: any) => p.id === chapterData.projectId)
          if (project) {
            projectTitle = project.title
          }
        }
      }
    }

    // Update job status to 'running' in all caches
    const updates: Partial<TTSJob> = {
      status: 'running',
      startedAt: new Date().toISOString(),
      processedSegments: data.processedSegments ?? 0,
      totalSegments: data.totalSegments,
      chapterTitle: chapterTitle,
      projectTitle: projectTitle,
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)

    // Invalidate projects list (for ChapterList to show job started)
    // Note: Only once per job (not per segment like segment.started)
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists(),
      exact: false
    })
  } catch (error) {
    logger.group(
      '❌ Job Started Handler Failed',
      'Error handling job.started event',
      {
        'Error': error instanceof Error ? error.message : String(error),
        'Job ID': data.jobId
      },
      '#F44336' // Red for error
    )
  }
}

/**
 * Handle job.progress event
 * Action: Update job progress directly in cache (no refetch)
 */
function handleJobProgress(data: JobProgressData, queryClient: any) {
  try {
    const updates: Partial<TTSJob> = {
      status: 'running',
      processedSegments: data.processedSegments,
      totalSegments: data.totalSegments,
      currentSegmentId: data.currentSegmentId ?? null,
      updatedAt: new Date().toISOString(),
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)
  } catch (error) {
    logger.error('[SSE] Failed to handle job.progress event:', error)
  }
}

/**
 * Handle job.completed event
 * Action: Update job + invalidate chapter detail
 */
function handleJobCompleted(data: JobCompletedData, queryClient: any) {
  try {
    logger.group(
      '✅ Job Completed',
      'TTS job finished successfully',
      {
        'Job ID': data.jobId,
        'Chapter ID': data.chapterId,
        'Processed': `${data.processedSegments}/${data.totalSegments}`,
        'Progress': `${data.progress.toFixed(1)}%`
      },
      '#4CAF50' // Green for success
    )

    const updates: Partial<TTSJob> = {
      status: 'completed',
      processedSegments: data.processedSegments,
      totalSegments: data.totalSegments,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)

    // FINAL authoritative refetch: Invalidate ALL job queries
    // This is the ONLY place where we refetch during generation
    queryClient.invalidateQueries({
      queryKey: ['tts', 'jobs'],
      exact: false
    })

    // Invalidate chapter queries (more efficient than invalidating all projects)
    if (data.chapterId) {
      invalidateChapterQueries(queryClient, data.chapterId)
    }

    // Invalidate projects list (for ChapterList segment status updates)
    // Note: ChapterList shows segment status from project.chapters data
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists(),
      exact: false
    })
  } catch (error) {
    logger.group(
      '❌ Job Completed Handler Failed',
      'Error handling job.completed event',
      {
        'Error': error instanceof Error ? error.message : String(error),
        'Job ID': data.jobId
      },
      '#F44336' // Red for error
    )
  }
}

/**
 * Handle job.failed event
 * Action: Update job + invalidate chapter detail
 */
function handleJobFailed(data: JobFailedData, queryClient: any) {
  try {
    logger.group(
      '❌ Job Failed',
      'TTS job failed with error',
      {
        'Job ID': data.jobId,
        'Chapter ID': data.chapterId,
        'Error': data.error,
        'Status': data.status
      },
      '#F44336' // Red for failure
    )

    const updates: Partial<TTSJob> = {
      status: 'failed',
      errorMessage: data.error,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)

    // FINAL authoritative refetch: Invalidate ALL job queries
    // This ensures we have fresh data after job completion
    queryClient.invalidateQueries({
      queryKey: ['tts', 'jobs'],
      exact: false
    })

    // Invalidate chapter queries (more efficient than invalidating all projects)
    if (data.chapterId) {
      invalidateChapterQueries(queryClient, data.chapterId)
    }

    // Invalidate projects list (for ChapterList segment status updates)
    // Note: ChapterList shows segment status from project.chapters data
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.lists(),
      exact: false
    })
  } catch (error) {
    logger.group(
      '❌ Job Failed Handler Failed',
      'Error handling job.failed event',
      {
        'Error': error instanceof Error ? error.message : String(error),
        'Job ID': data.jobId
      },
      '#F44336' // Red for error
    )
  }
}

/**
 * Handle job.cancelled event
 * Action: Revert queued segments back to 'pending'
 *
 * NO INVALIDATION - Optimistic update only, final refetch at job.completed/failed
 */
function handleJobCancelled(data: JobCancelledData, queryClient: any) {
  try {
    // 1. Update job status in all caches (optimistic update only)
    const updates: Partial<TTSJob> = {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)

    // NO invalidation here - cancelled jobs stay in cache until user deletes or resumes them
    // This prevents flickering in JobsPanel

    // 2. Revert segments from 'queued' back to 'pending'
    // (Segments that were already 'completed' stay 'completed')
    if (data.segmentIds && data.chapterId) {
      queryClient.setQueryData(
        queryKeys.chapters.detail(data.chapterId),
        (oldChapter: Chapter | undefined) => {
          if (!oldChapter) return oldChapter

          // Get segment IDs that were pending (not completed) in this job
          const pendingSegmentIds = new Set(
            data.segmentIds!
              .filter(seg => seg.job_status === 'pending')
              .map(seg => seg.id)
          )

          return {
            ...oldChapter,
            segments: oldChapter.segments.map(segment => {
              // Only revert segments that were queued (never completed)
              if (pendingSegmentIds.has(segment.id) && segment.status === 'queued') {
                return { ...segment, status: 'pending' as const }
              }
              return segment
            })
          }
        }
      )

      // Invalidate chapter queries (more efficient than invalidating all projects)
      invalidateChapterQueries(queryClient, data.chapterId)

    }
  } catch (error) {
    logger.error('[SSE] Failed to handle job.cancelled event:', error)
  }
}

/**
 * Handle job.resumed event
 * Action: Update job status in cache to 'pending'
 */
function handleJobResumed(data: JobResumedData, queryClient: any) {
  try {
    const updates: Partial<TTSJob> = {
      status: 'pending',
      updatedAt: new Date().toISOString(),
    }

    updateJobInAllCaches(queryClient, data.jobId, updates)
  } catch (error) {
    logger.error('[SSE] Failed to handle job.resumed event:', error)
  }
}

/**
 * Handle segment.started event
 * Action: Update segment status to 'processing' in chapter cache AND projects cache
 */
function handleSegmentStarted(data: SegmentStartedData, queryClient: any) {
  try {
    // 1. Update chapter detail (contains segments array)
    queryClient.setQueryData(
      queryKeys.chapters.detail(data.chapterId),
      (oldChapter: Chapter | undefined) => {
        if (!oldChapter) return oldChapter
        return {
          ...oldChapter,
          segments: oldChapter.segments.map((segment) =>
            segment.id === data.segmentId
              ? { ...segment, status: 'processing' as const, audioPath: null }
              : segment
          ),
        }
      }
    )

    // 2. Update projects list (for ChapterList live updates)
    queryClient.setQueryData(
      queryKeys.projects.lists(),
      (oldData: any) => {
        if (!oldData) return oldData

        return oldData.map((project: any) => ({
          ...project,
          chapters: project.chapters.map((chapter: any) => {
            if (chapter.id !== data.chapterId) return chapter

            return {
              ...chapter,
              segments: chapter.segments.map((segment: any) =>
                segment.id === data.segmentId
                  ? { ...segment, status: 'processing' as const, audioPath: null }
                  : segment
              ),
            }
          }),
        }))
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle segment.started event:', error)
  }
}

/**
 * Handle segment.completed event
 * Action: Update segment status + audioPath in chapter cache AND projects cache (optimistic updates)
 *
 * Note: No invalidation here to avoid refetching entire projects list after each segment.
 * Instead we optimistically update both caches for instant UI feedback.
 * Final authoritative refetch happens once at job.completed event.
 */
function handleSegmentCompleted(data: SegmentCompletedData, queryClient: any) {
  try {
    // 1. Update chapter detail (contains segments array)
    queryClient.setQueryData(
      queryKeys.chapters.detail(data.chapterId),
      (oldChapter: Chapter | undefined) => {
        if (!oldChapter) return oldChapter
        return {
          ...oldChapter,
          segments: oldChapter.segments.map((segment) =>
            segment.id === data.segmentId
              ? {
                  ...segment,
                  status: 'completed' as const,
                  audioPath: data.audioPath,
                }
              : segment
          ),
        }
      }
    )

    // 2. Update projects list (for ChapterList live updates)
    // Optimistic update - no server request, instant UI feedback
    queryClient.setQueryData(
      queryKeys.projects.lists(),
      (oldData: any) => {
        if (!oldData) return oldData

        return oldData.map((project: any) => ({
          ...project,
          chapters: project.chapters.map((chapter: any) => {
            if (chapter.id !== data.chapterId) return chapter

            return {
              ...chapter,
              segments: chapter.segments.map((segment: any) =>
                segment.id === data.segmentId
                  ? {
                      ...segment,
                      status: 'completed' as const,
                      audioPath: data.audioPath,
                    }
                  : segment
              ),
            }
          }),
        }))
      }
    )

    // No invalidation - optimistic updates are sufficient for live feedback
    // Authoritative refetch happens at job.completed event
  } catch (error) {
    logger.error('[SSE] Failed to handle segment.completed event:', error)
  }
}

/**
 * Handle segment.failed event
 * Action: Update segment status to 'failed' in chapter cache AND projects cache
 *
 * Note: No invalidation - optimistic updates for instant feedback.
 * Final authoritative refetch happens once at job.completed/failed event.
 */
function handleSegmentFailed(data: SegmentFailedData, queryClient: any) {
  try {
    logger.group(
      '❌ Segment Failed',
      'TTS segment generation failed',
      {
        'Segment ID': data.segmentId,
        'Chapter ID': data.chapterId,
        'Error': data.error,
        'Status': data.status
      },
      '#F44336' // Red for failure
    )

    // 1. Update chapter detail (contains segments array)
    queryClient.setQueryData(
      queryKeys.chapters.detail(data.chapterId),
      (oldChapter: Chapter | undefined) => {
        if (!oldChapter) return oldChapter
        return {
          ...oldChapter,
          segments: oldChapter.segments.map((segment) =>
            segment.id === data.segmentId
              ? { ...segment, status: 'failed' as const }
              : segment
          ),
        }
      }
    )

    // 2. Update projects list (for ChapterList live updates)
    queryClient.setQueryData(
      queryKeys.projects.lists(),
      (oldData: any) => {
        if (!oldData) return oldData

        return oldData.map((project: any) => ({
          ...project,
          chapters: project.chapters.map((chapter: any) => {
            if (chapter.id !== data.chapterId) return chapter

            return {
              ...chapter,
              segments: chapter.segments.map((segment: any) =>
                segment.id === data.segmentId
                  ? { ...segment, status: 'failed' as const }
                  : segment
              ),
            }
          }),
        }))
      }
    )

    // No invalidation - optimistic updates are sufficient for live feedback
    // Authoritative refetch happens at job.completed/failed event
  } catch (error) {
    logger.error('[SSE] Failed to handle segment.failed event:', error)
  }
}

/**
 * Handle segment.updated event
 * Action: Invalidate chapter detail (general update)
 */
function handleSegmentUpdated(data: SegmentUpdatedData, queryClient: any) {
  try {
    // Invalidate chapter detail to refresh
    queryClient.invalidateQueries({
      queryKey: queryKeys.chapters.detail(data.chapterId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle segment.updated event:', error)
  }
}

/**
 * Handle chapter.updated event
 * Action: Invalidate chapter detail
 */
function handleChapterUpdated(data: ChapterUpdatedData, queryClient: any) {
  try {
    logger.group(
      '📝 Chapter Updated',
      'Chapter metadata changed',
      {
        'Chapter ID': data.chapterId,
        'Action': 'Invalidating chapter detail query'
      },
      '#2196F3' // Blue for updates
    )

    // Invalidate chapter detail
    queryClient.invalidateQueries({
      queryKey: queryKeys.chapters.detail(data.chapterId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle chapter.updated event:', error)
  }
}

/**
 * Handle export.started event
 * Action: Update export job in cache
 */
function handleExportStarted(data: ExportProgressData, queryClient: any) {
  try {
    // Update export job query
    queryClient.setQueryData(
      queryKeys.export.job(data.exportId),
      (oldJob: any) => {
        if (!oldJob) return oldJob
        return {
          ...oldJob,
          status: 'running',
          progress: data.progress ?? 0,
        }
      }
    )

    // Also invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(data.exportId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.started event:', error)
  }
}

/**
 * Handle export.progress event
 * Action: Update export job progress in cache
 */
function handleExportProgress(data: ExportProgressData, queryClient: any) {
  try {
    // Update export job query
    queryClient.setQueryData(
      queryKeys.export.job(data.exportId),
      (oldJob: any) => {
        if (!oldJob) return oldJob
        return {
          ...oldJob,
          status: data.status,
          progress: data.progress ?? oldJob.progress,
        }
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle export.progress event:', error)
  }
}

/**
 * Handle export.completed event
 * Action: Update export job status + invalidate
 */
function handleExportCompleted(data: ExportProgressData, queryClient: any) {
  try {
    // Update export job query
    queryClient.setQueryData(
      queryKeys.export.job(data.exportId),
      (oldJob: any) => {
        if (!oldJob) return oldJob
        return {
          ...oldJob,
          status: 'completed',
          progress: 100,
          outputPath: data.outputPath,
        }
      }
    )

    // Invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(data.exportId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.completed event:', error)
  }
}

/**
 * Handle export.failed event
 * Action: Update export job status with error
 */
function handleExportFailed(data: ExportProgressData, queryClient: any) {
  try {
    logger.group(
      '❌ Export Failed',
      'Audio export failed with error',
      {
        'Export ID': data.exportId,
        'Status': data.status,
        'Error': data.error || 'Unknown error'
      },
      '#F44336' // Red for failure
    )

    // Update export job query
    queryClient.setQueryData(
      queryKeys.export.job(data.exportId),
      (oldJob: any) => {
        if (!oldJob) return oldJob
        return {
          ...oldJob,
          status: 'failed',
          error: data.error,
        }
      }
    )

    // Invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(data.exportId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.failed event:', error)
  }
}

/**
 * Handle health.update event
 * Action: Update backend health cache with latest status
 *
 * This enables real-time health monitoring via SSE instead of polling.
 * The health data is cached in React Query and used by useConnectionMonitor.
 */
function handleHealthUpdate(
  data: HealthUpdateData,
  queryClient: any,
  backendUrl: string
) {
  try {
    // Update backend-health query cache
    // Note: Cache structure matches useBackendHealth return type
    queryClient.setQueryData(
      ['backend-health', backendUrl],
      {
        status: data.status,
        version: data.version,
        timestamp: data.timestamp,
        database: data.database,
        ttsEngines: data.ttsEngines,
        busy: data.busy,
        activeJobs: data.activeJobs
      }
    )

    // Log significant status changes or database issues
    if (data.status === 'error') {
      logger.error('[SSE] Health update - Backend error: status=error')
    } else if (!data.database) {
      logger.warn('[SSE] Health update - Database connectivity issue')
    } else {
      // Log at debug level for successful updates (don't spam console)
      //logger.debug(
      //  `[SSE] Health update: status=${data.status}, busy=${data.busy}, ` +
      //  `activeJobs=${data.activeJobs}`
      //)
    }
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
function handleSpeakerCreated(data: any, queryClient: any) {
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
function handleSpeakerUpdated(data: any, queryClient: any) {
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
function handleSpeakerDeleted(data: any, queryClient: any) {
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
function handleSpeakerSampleAdded(data: any, queryClient: any) {
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
  } catch (error) {
    logger.error('[SSE] Failed to handle speaker.sample_added event:', error)
  }
}

/**
 * Handle speaker.sample_deleted event
 */
function handleSpeakerSampleDeleted(data: any, queryClient: any) {
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
function handleSettingsUpdated(data: any, queryClient: any) {
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
function handleSettingsReset(data: any, queryClient: any) {
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
// Event Router
// ============================================================================

/**
 * Route incoming SSE event to appropriate handler
 */
function routeEvent(
  event: MessageEvent,
  queryClient: any,
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

    // Route to appropriate handler
    // Note: Event data is now flat (no nested data.data), event type is in data.event
    switch (eventType) {
      // Job events
      case 'job.created':
        handleJobCreated(data, queryClient)
        break
      case 'job.started':
        handleJobStarted(data, queryClient)
        break
      case 'job.progress':
        handleJobProgress(data, queryClient)
        break
      case 'job.completed':
        handleJobCompleted(data, queryClient)
        break
      case 'job.failed':
        handleJobFailed(data, queryClient)
        break
      case 'job.cancelled':
        handleJobCancelled(data, queryClient)
        break
      case 'job.resumed':
        handleJobResumed(data, queryClient)
        break

      // Segment events
      case 'segment.started':
        handleSegmentStarted(data, queryClient)
        break
      case 'segment.completed':
        handleSegmentCompleted(data, queryClient)
        break
      case 'segment.failed':
        handleSegmentFailed(data, queryClient)
        break
      case 'segment.updated':
        handleSegmentUpdated(data, queryClient)
        break

      // Chapter events
      case 'chapter.updated':
        handleChapterUpdated(data, queryClient)
        break

      // Export events
      case 'export.started':
        handleExportStarted(data, queryClient)
        break
      case 'export.progress':
        handleExportProgress(data, queryClient)
        break
      case 'export.completed':
        handleExportCompleted(data, queryClient)
        break
      case 'export.failed':
        handleExportFailed(data, queryClient)
        break

      // Health events
      case 'health.update':
        if (backendUrl) {
          handleHealthUpdate(data, queryClient, backendUrl)
        } else {
          logger.warn('[SSE] Health update received but no backend URL available')
        }
        break

      // Speaker events
      case 'speaker.created':
        handleSpeakerCreated(data, queryClient)
        break
      case 'speaker.updated':
        handleSpeakerUpdated(data, queryClient)
        break
      case 'speaker.deleted':
        handleSpeakerDeleted(data, queryClient)
        break
      case 'speaker.sample_added':
        handleSpeakerSampleAdded(data, queryClient)
        break
      case 'speaker.sample_deleted':
        handleSpeakerSampleDeleted(data, queryClient)
        break

      // Settings events
      case 'settings.updated':
        handleSettingsUpdated(data, queryClient)
        break
      case 'settings.reset':
        handleSettingsReset(data, queryClient)
        break

      // Unknown event type
      default:
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
  const { enabled = true } = options || {}
  const queryClient = useQueryClient()
  const { connection, subscribe } = useSSEConnection()
  const backendUrl = useAppStore((state) => state.connection.url)

  // Subscribe to SSE events
  useEffect(() => {
    if (!enabled) {
      return
    }

    // Subscribe to events
    const unsubscribe = subscribe((event: MessageEvent) => {
      // Route event to appropriate handler with backendUrl context
      routeEvent(event, queryClient, backendUrl)
    })

    logger.group(
      '📡 SSE Handlers Connected',
      'Event handlers subscribed to SSE connection',
      {
        'Enabled': enabled,
        'Connection Status': connection.status,
        'Connection Type': connection.connectionType
      },
      '#4CAF50' // Green for initialization
    )

    // Cleanup on unmount
    return () => {
      unsubscribe()

      logger.group(
        '📡 SSE Handlers Disconnected',
        'Event handlers unsubscribed',
        {
          'Reason': 'Component unmounted'
        },
        '#607D8B' // Gray for cleanup
      )
    }
  }, [enabled, subscribe, queryClient, backendUrl])

  // Log connection status changes
  useEffect(() => {
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
