/**
 * SSE Quality Event Handlers
 *
 * Handles real-time quality analysis events from backend.
 * Updates React Query cache for optimistic UI updates.
 *
 * Architecture (mirrors TTS handlers):
 * - Direct cache updates via setQueryData for immediate UI response
 * - updateQualityJobInAllCaches updates all job caches (activeJobs, jobs list, specific job)
 * - NO invalidation during progress - only at job completion/failure
 * - Optimized with immer for O(1) updates
 */

import { useCallback } from 'react'
import { useQueryClient, QueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { queryKeys } from '@services/queryKeys'
import type { Chapter, QualityEngineResult, QualityJob } from '@types'
import type {
  QualityJobCreatedData,
  QualityJobStartedData,
  QualityJobProgressData,
  QualityJobCompletedData,
  QualityJobFailedData,
  QualityJobCancelledData,
  QualityJobResumedData,
  QualitySegmentAnalyzedData,
  QualitySegmentFailedData,
} from '@/types/sseEvents'
import { logger } from '@utils/logger'

// ==================== Helper Functions ====================

/**
 * Update a quality job in ALL caches (activeJobs, jobs list, specific job).
 *
 * This ensures the UI updates immediately without waiting for refetch.
 * Mirrors the TTS updateJobInAllCaches pattern.
 *
 * IMPORTANT: Does NOT invalidate queries to avoid excessive refetches.
 * Final authoritative refetch happens at job.completed/failed events only.
 */
function updateQualityJobInAllCaches(
  queryClient: QueryClient,
  jobId: string,
  updates: Partial<QualityJob>
) {
  try {
    // Helper function to update jobs array with immer
    const updateJobsArray = produce((draft: { jobs?: QualityJob[] } | undefined) => {
      if (!draft?.jobs) return
      const job = draft.jobs.find((j: QualityJob) => j.id === jobId)
      if (job) {
        Object.assign(job, updates)
      }
    })

    // 1. Update activeJobs cache
    queryClient.setQueryData(
      queryKeys.quality.activeJobs(),
      updateJobsArray
    )

    // 2. Update ALL general jobs queries (with any filters)
    // This updates the QualityJobsView
    queryClient.setQueryData(
      queryKeys.quality.jobs({ limit: 50 }),
      updateJobsArray
    )

    // 3. Update specific job query if it exists
    queryClient.setQueryData(
      queryKeys.quality.job(jobId),
      produce((draft: QualityJob | undefined) => {
        if (draft) {
          Object.assign(draft, updates)
        }
      })
    )

    // NO invalidation here - that would cause refetch on every progress event!
    // Final authoritative refetch happens at job.completed/failed events only
  } catch (error) {
    logger.error('[SSE] Failed to update quality job in all caches', {
      jobId,
      updates,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    queryClient.invalidateQueries({
      queryKey: queryKeys.quality.all,
      exact: false
    })
  }
}

/**
 * Add a new job to all caches.
 */
function addJobToAllCaches(
  queryClient: QueryClient,
  newJob: Partial<QualityJob>
) {
  try {
    const addJobToCache = produce((draft: { jobs?: QualityJob[]; count?: number } | undefined) => {
      if (!draft) return
      if (!draft.jobs) draft.jobs = []
      // Add at the beginning (newest first)
      draft.jobs.unshift(newJob as QualityJob)
      if (draft.count !== undefined) draft.count++
    })

    // Update activeJobs cache
    queryClient.setQueryData(
      queryKeys.quality.activeJobs(),
      addJobToCache
    )

    // Update general jobs cache
    queryClient.setQueryData(
      queryKeys.quality.jobs({ limit: 50 }),
      addJobToCache
    )
  } catch (error) {
    logger.error('[SSE] Failed to add job to all caches', {
      jobId: newJob.id,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    queryClient.invalidateQueries({
      queryKey: queryKeys.quality.all,
      exact: false
    })
  }
}

// ==================== Hook ====================

export function useSSEQualityHandlers() {
  const queryClient = useQueryClient()

  /**
   * Handle quality.job.created event.
   * Adds new job to cache and clears previous analysis data for segments.
   */
  const onJobCreated = useCallback(
    (data: QualityJobCreatedData) => {
      try {
        logger.group(
          '🔍 Quality Job Created',
          'New quality analysis job created',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A',
            'Segment IDs': data.segmentIds?.length || 0,
            'Total Segments': data.totalSegments,
            'Job Type': data.jobType
          },
          '#673AB7' // Deep Purple for Quality
        )

        // Add new job to caches (optimistic)
        const newJob: Partial<QualityJob> = {
          id: data.jobId,
          status: 'pending',
          type: data.jobType as 'segment' | 'chapter',
          chapterId: data.chapterId,
          totalSegments: data.totalSegments,
          processedSegments: 0,
          failedSegments: 0,
          createdAt: new Date(),
          // Display fields from SSE event
          chapterTitle: data.chapterTitle,
          projectTitle: data.projectTitle,
          sttEngine: data.sttEngine,
          audioEngine: data.audioEngine,
        }
        addJobToAllCaches(queryClient, newJob)

        if (data.chapterId && data.segmentIds && data.segmentIds.length > 0) {
          const segmentIdsSet = new Set(data.segmentIds)

          // Clear quality data for segments being analyzed (optimistic)
          queryClient.setQueryData(
            queryKeys.chapters.detail(data.chapterId),
            produce((draft: Chapter | undefined) => {
              if (!draft?.segments) return

              for (const segment of draft.segments) {
                if (segmentIdsSet.has(segment.id)) {
                  // Cast to include quality fields
                  const seg = segment as typeof segment & {
                    qualityAnalyzed?: boolean
                    qualityScore?: number
                    qualityStatus?: string
                    engineResults?: QualityEngineResult[]
                  }
                  // Clear old analysis data
                  seg.qualityAnalyzed = false
                  seg.qualityScore = undefined
                  seg.qualityStatus = undefined
                  seg.engineResults = undefined
                }
              }
            })
          )
        }
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.created event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.job.started event.
   */
  const onJobStarted = useCallback(
    (data: QualityJobStartedData) => {
      try {
        logger.group(
          '▶️ Quality Job Started',
          'Quality analysis job started processing',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A',
            'Total Segments': data.totalSegments
          },
          '#673AB7'
        )

        // Update job status to 'running'
        // Use processedSegments from event (for resumed jobs) or default to 0
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'running',
          totalSegments: data.totalSegments,
          processedSegments: data.processedSegments ?? 0,
          startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
        })
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.started event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.job.progress event.
   */
  const onJobProgress = useCallback(
    (data: QualityJobProgressData) => {
      try {
        // Update job progress in all caches
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'running',
          processedSegments: data.processedSegments,
          totalSegments: data.totalSegments,
          currentSegmentId: data.currentSegmentId,
        })
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.progress event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.segment.analyzed event.
   * Updates segment with new quality data.
   */
  const onSegmentAnalyzed = useCallback(
    (data: QualitySegmentAnalyzedData) => {
      try {
        queryClient.setQueryData(
          queryKeys.chapters.detail(data.chapterId),
          produce((draft: Chapter | undefined) => {
            if (!draft?.segments) return

            const segment = draft.segments.find((s) => s.id === data.segmentId)
            if (segment) {
              // Cast to include quality fields
              const seg = segment as typeof segment & {
                qualityAnalyzed?: boolean
                qualityScore?: number
                qualityStatus?: string
                engineResults?: QualityEngineResult[]
              }
              seg.qualityAnalyzed = true
              seg.qualityScore = data.qualityScore
              seg.qualityStatus = data.qualityStatus
              seg.engineResults = data.engineResults
            }
          })
        )

        logger.debug('[SSE] Quality segment analyzed', {
          segmentId: data.segmentId,
          qualityScore: data.qualityScore,
          qualityStatus: data.qualityStatus,
          engineCount: data.engineResults?.length || 0
        })
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.segment.analyzed event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.segment.failed event.
   */
  const onSegmentFailed = useCallback(
    (data: QualitySegmentFailedData) => {
      logger.group(
        '❌ Quality Segment Failed',
        'Segment quality analysis failed',
        {
          'Segment ID': data.segmentId,
          'Chapter ID': data.chapterId,
          'Error': data.error
        },
        '#F44336'
      )
    },
    []
  )

  /**
   * Handle quality.job.completed event.
   */
  const onJobCompleted = useCallback(
    (data: QualityJobCompletedData) => {
      try {
        logger.group(
          '✅ Quality Job Completed',
          'Quality analysis completed successfully',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A',
            'Segments Analyzed': data.totalSegments
          },
          '#4CAF50'
        )

        // Update job status to 'completed'
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'completed',
          processedSegments: data.totalSegments,
          totalSegments: data.totalSegments,
          completedAt: new Date(),
        })

        // FINAL authoritative refetch: Invalidate ALL job queries
        // This is the ONLY place where we refetch during quality analysis
        queryClient.invalidateQueries({
          queryKey: queryKeys.quality.all,
          exact: false
        })

        // Refresh chapter data to ensure we have latest
        if (data.chapterId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.chapters.detail(data.chapterId),
          })
        }
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.completed event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.job.failed event.
   */
  const onJobFailed = useCallback(
    (data: QualityJobFailedData) => {
      try {
        logger.group(
          '❌ Quality Job Failed',
          'Quality analysis job failed',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A',
            'Error': data.error,
            'Processed': `${data.processedSegments}/${data.totalSegments}`
          },
          '#F44336'
        )

        // Update job status to 'failed'
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'failed',
          errorMessage: data.error,
          processedSegments: data.processedSegments,
          totalSegments: data.totalSegments,
          completedAt: new Date(),
        })

        // FINAL authoritative refetch
        queryClient.invalidateQueries({
          queryKey: queryKeys.quality.all,
          exact: false
        })
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.failed event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.job.cancelled event.
   */
  const onJobCancelled = useCallback(
    (data: QualityJobCancelledData) => {
      try {
        logger.group(
          '🚫 Quality Job Cancelled',
          'Quality analysis cancelled by user',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A'
          },
          '#FF9800'
        )

        // Update job status to 'cancelled'
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'cancelled',
          completedAt: new Date(),
        })

        // FINAL authoritative refetch
        queryClient.invalidateQueries({
          queryKey: queryKeys.quality.all,
          exact: false
        })
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.cancelled event:', error)
      }
    },
    [queryClient]
  )

  /**
   * Handle quality.job.resumed event.
   */
  const onJobResumed = useCallback(
    (data: QualityJobResumedData) => {
      try {
        logger.group(
          '▶️ Quality Job Resumed',
          'Quality analysis job resumed',
          {
            'Job ID': data.jobId,
            'Chapter ID': data.chapterId || 'N/A'
          },
          '#4CAF50'
        )

        // Update job status to 'pending'
        // Use resumedAt as createdAt for display purposes (avoids flicker to old time)
        updateQualityJobInAllCaches(queryClient, data.jobId, {
          status: 'pending',
          completedAt: undefined,
          errorMessage: undefined,
          createdAt: data.resumedAt ? new Date(data.resumedAt) : undefined,
        })

        // NOTE: No invalidateQueries here - the cache update is sufficient
        // and refetch would overwrite createdAt with the old value from DB
      } catch (error) {
        logger.error('[SSE] Failed to handle quality.job.resumed event:', error)
      }
    },
    [queryClient]
  )

  return {
    'quality.job.created': onJobCreated,
    'quality.job.started': onJobStarted,
    'quality.job.progress': onJobProgress,
    'quality.job.completed': onJobCompleted,
    'quality.job.failed': onJobFailed,
    'quality.job.cancelled': onJobCancelled,
    'quality.job.resumed': onJobResumed,
    'quality.segment.analyzed': onSegmentAnalyzed,
    'quality.segment.failed': onSegmentFailed,
  }
}
