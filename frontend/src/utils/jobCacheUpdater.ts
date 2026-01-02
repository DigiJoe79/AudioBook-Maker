/**
 * Generic Job Cache Updater
 *
 * Consolidates duplicated SSE cache update patterns from TTS and Quality handlers.
 * Provides type-safe, reusable utilities for updating job data across multiple query caches.
 *
 * Architecture:
 * - createJobCacheUpdater() factory creates a configured updater for a specific job type
 * - Exported pre-configured updaters for TTS and Quality jobs
 * - Uses immer for O(1) immutable cache updates
 * - Updates all job-related caches: activeJobs, jobs list, specific job
 */

import { produce } from 'immer'
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'

/**
 * Configuration for job cache updater
 */
interface JobCacheUpdaterConfig<TJob> {
  /**
   * Query key for active jobs cache (e.g., ['tts', 'jobs', 'active'])
   */
  activeJobsKey: readonly unknown[]

  /**
   * Query key for general jobs list (e.g., ['tts', 'jobs', { limit: 50 }])
   */
  jobsListKey: readonly unknown[]

  /**
   * Factory function to create query key for specific job
   * (e.g., (jobId) => ['tts', 'jobs', jobId])
   */
  jobKey: (jobId: string) => readonly unknown[]

  /**
   * Query key prefix for invalidation on error recovery
   * (e.g., ['tts'])
   */
  allJobsKey: readonly unknown[]

  /**
   * Optional logger instance for error tracking
   */
  logger?: {
    error: (message: string, context?: Record<string, unknown>) => void
  }
}

/**
 * Response type for jobs list queries
 * Matches backend API response structure
 */
interface JobsListResponse<TJob> {
  jobs?: TJob[]
  count?: number
}

/**
 * Creates a job cache updater function for a specific job type.
 *
 * This factory function generates a reusable updater that updates job data
 * across all relevant query caches (activeJobs, jobs list, specific job).
 *
 * @param config - Configuration for the job cache updater
 * @returns Function that updates a job in all caches
 *
 * @example
 * ```ts
 * const updateTTSJob = createJobCacheUpdater({
 *   activeJobsKey: queryKeys.tts.activeJobs(),
 *   jobsListKey: queryKeys.tts.jobs({ limit: 50 }),
 *   jobKey: (id) => queryKeys.tts.job(id),
 *   allJobsKey: queryKeys.tts.all,
 * })
 *
 * // Use in SSE handler
 * updateTTSJob(queryClient, jobId, { status: 'completed' })
 * ```
 */
export function createJobCacheUpdater<TJob extends { id: string }>(
  config: JobCacheUpdaterConfig<TJob>
) {
  return function updateJobInAllCaches(
    queryClient: QueryClient,
    jobId: string,
    updates: Partial<TJob>
  ): void {
    try {
      // Terminal statuses that should remove job from activeJobs cache
      // These jobs are no longer "active" and should not be counted in badge
      const terminalStatuses = ['completed', 'failed', 'cancelled']
      const status = (updates as { status?: string }).status
      const isTerminalStatus = status && terminalStatuses.includes(status)

      // Helper function to update jobs array with immer
      // Optimized: O(1) find + update instead of O(n) map
      const updateJobsArray = produce((draft: JobsListResponse<TJob> | undefined) => {
        if (!draft?.jobs) return
        const job = draft.jobs.find((j: TJob) => j.id === jobId)
        if (job) {
          Object.assign(job, updates)
        }
      })

      // Helper function to remove job from activeJobs array
      // Used when job reaches terminal status (completed/failed)
      // Pattern from useTTSQuery.ts - ensures badge count decrements immediately
      const removeJobFromArray = produce((draft: JobsListResponse<TJob> | undefined) => {
        if (!draft?.jobs) return
        const index = draft.jobs.findIndex((j: TJob) => j.id === jobId)
        if (index !== -1) {
          draft.jobs.splice(index, 1)
          if (draft.count !== undefined) {
            draft.count = Math.max(0, draft.count - 1)
          }
        }
      })

      // 1. Update activeJobs cache (for badge in AppLayout)
      // For terminal statuses: REMOVE the job instead of updating
      // This ensures the badge count decrements immediately without waiting for refetch
      queryClient.setQueryData(
        config.activeJobsKey,
        isTerminalStatus ? removeJobFromArray : updateJobsArray
      )

      // 2. Update general jobs list cache (for JobsPanel dialog)
      queryClient.setQueryData(
        config.jobsListKey,
        updateJobsArray
      )

      // 3. Update specific job query if it exists
      queryClient.setQueryData(
        config.jobKey(jobId),
        produce((draft: TJob | undefined) => {
          if (draft) {
            Object.assign(draft, updates)
          }
        })
      )

      // NO invalidation here - that would cause refetch on every progress event!
      // Final authoritative refetch happens at job.completed/failed events only
    } catch (error) {
      // Recovery: invalidate all job queries to force refetch
      if (config.logger) {
        config.logger.error('[JobCacheUpdater] Failed to update job in all caches', {
          jobId,
          updates,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      queryClient.invalidateQueries({
        queryKey: config.allJobsKey,
        exact: false
      })
    }
  }
}

/**
 * Pre-configured cache updater for TTS jobs.
 *
 * Updates TTS job data across all caches:
 * - activeJobs cache (for badge count)
 * - jobs list cache (for JobsPanel)
 * - specific job cache (for job detail view)
 *
 * @param queryClient - React Query client instance
 * @param jobId - ID of the job to update
 * @param updates - Partial job data to merge into existing job
 *
 * @example
 * ```ts
 * // In SSE handler
 * updateTTSJobInCaches(queryClient, data.jobId, {
 *   status: 'running',
 *   processedSegments: data.processedSegments,
 * })
 * ```
 */
export function updateTTSJobInCaches(
  queryClient: QueryClient,
  jobId: string,
  updates: Partial<any>
): void {
  const updater = createJobCacheUpdater({
    activeJobsKey: queryKeys.tts.activeJobs(),
    jobsListKey: queryKeys.tts.jobs({ limit: 50 }),
    jobKey: (id: string) => queryKeys.tts.job(id),
    allJobsKey: queryKeys.tts.all,
  })

  updater(queryClient, jobId, updates)
}

/**
 * Pre-configured cache updater for Quality jobs.
 *
 * Updates Quality job data across all caches:
 * - activeJobs cache (for badge count)
 * - jobs list cache (for QualityJobsView)
 * - specific job cache (for job detail view)
 *
 * @param queryClient - React Query client instance
 * @param jobId - ID of the job to update
 * @param updates - Partial job data to merge into existing job
 *
 * @example
 * ```ts
 * // In SSE handler
 * updateQualityJobInCaches(queryClient, data.jobId, {
 *   status: 'completed',
 *   completedAt: new Date(),
 * })
 * ```
 */
export function updateQualityJobInCaches(
  queryClient: QueryClient,
  jobId: string,
  updates: Partial<any>
): void {
  const updater = createJobCacheUpdater({
    activeJobsKey: queryKeys.quality.activeJobs(),
    jobsListKey: queryKeys.quality.jobs({ limit: 50 }),
    jobKey: (id: string) => queryKeys.quality.job(id),
    allJobsKey: queryKeys.quality.all,
  })

  updater(queryClient, jobId, updates)
}
