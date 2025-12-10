/**
 * Quality Analysis React Query Hooks
 *
 * Hooks for managing quality analysis jobs and data.
 * Replaces useSTTQuery.ts for the unified quality system.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { qualityApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type { QualityJob, QualityJobsListResponse } from '@types'
import {
  transformQualityJob,
  type ApiQualityJob,
  type ApiQualityJobsListResponse,
} from '@types'

// ==================== Query Hooks ====================

/**
 * Get all quality jobs with optional filters.
 */
export function useQualityJobs(filters?: {
  status?: string
  chapterId?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: queryKeys.quality.jobs(filters),
    queryFn: async () => {
      const response = await qualityApi.getJobs(filters) as unknown as ApiQualityJobsListResponse
      return {
        ...response,
        jobs: (response.jobs ?? []).map(transformQualityJob)
      } as QualityJobsListResponse
    },
    staleTime: 5000,
  })
}

/**
 * Get active quality jobs (pending + running).
 * Auto-refreshes every 2 seconds while there are active jobs.
 */
export function useActiveQualityJobs() {
  return useQuery({
    queryKey: queryKeys.quality.activeJobs(),
    queryFn: async () => {
      const response = await qualityApi.getActiveJobs() as unknown as ApiQualityJobsListResponse
      return {
        ...response,
        jobs: (response.jobs ?? []).map(transformQualityJob)
      } as QualityJobsListResponse
    },
    refetchInterval: (query) => {
      // Poll every 2s if there are active jobs
      const data = query.state.data as { jobs: QualityJob[] } | undefined
      return data?.jobs && data.jobs.length > 0 ? 2000 : false
    },
    staleTime: 1000,
  })
}

// ==================== Mutation Hooks ====================

/**
 * Analyze a single segment with quality engines.
 */
export function useAnalyzeSegmentQuality() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      segmentId,
      sttEngine,
      sttModelName,
      audioEngine,
    }: {
      segmentId: string
      sttEngine?: string
      sttModelName?: string
      audioEngine?: string
    }) => qualityApi.analyzeSegment(segmentId, sttEngine, sttModelName, audioEngine),

    onSuccess: () => {
      // Invalidate active jobs to show new job
      queryClient.invalidateQueries({ queryKey: queryKeys.quality.activeJobs() })
    },
  })
}

/**
 * Analyze all segments in a chapter with quality engines.
 */
export function useAnalyzeChapterQuality() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      chapterId,
      sttEngine,
      sttModelName,
      audioEngine,
    }: {
      chapterId: string
      sttEngine?: string
      sttModelName?: string
      audioEngine?: string
    }) => qualityApi.analyzeChapter(chapterId, sttEngine, sttModelName, audioEngine),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.quality.activeJobs() })
    },
  })
}

// ==================== Types for Optimistic Updates ====================

type QualityJobsData = QualityJobsListResponse | QualityJob[]

// Helper to create snapshot of all job queries
function createJobsSnapshot(queryClient: ReturnType<typeof useQueryClient>) {
  const snapshots = new Map<string, QualityJobsData>()
  queryClient.getQueriesData<QualityJobsData>({ queryKey: queryKeys.quality.all }).forEach(([key, data]) => {
    if (data) {
      snapshots.set(JSON.stringify(key), data)
    }
  })
  return snapshots
}

// Helper to restore snapshots on error
function restoreSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: Map<string, QualityJobsData> | undefined
) {
  if (snapshots) {
    snapshots.forEach((data, key) => {
      queryClient.setQueryData(JSON.parse(key), data)
    })
  }
}

// ==================== Mutation Hooks with Optimistic Updates ====================

/**
 * Cancel a running quality job.
 * Optimistically updates job status to 'cancelling'.
 */
export function useCancelQualityJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: string) => qualityApi.cancelJob(jobId),

    onMutate: async (jobId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.quality.all })

      // Snapshot for rollback
      const snapshots = createJobsSnapshot(queryClient)

      // Optimistically update job status to 'cancelling'
      queryClient.setQueriesData<QualityJobsData>({ queryKey: queryKeys.quality.all }, (old) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.map((job) => job.id === jobId ? { ...job, status: 'cancelling' } : job)
        }
        if ('jobs' in old && Array.isArray(old.jobs)) {
          return { ...old, jobs: old.jobs.map((job) => job.id === jobId ? { ...job, status: 'cancelling' } : job) }
        }
        return old
      })

      return { snapshots }
    },

    onError: (_, __, context) => {
      restoreSnapshots(queryClient, context?.snapshots)
    },

    onSuccess: () => {
      // Optimistic update already applied
    },
  })
}

/**
 * Delete a quality job.
 * Optimistically removes job from list.
 */
export function useDeleteQualityJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: string) => qualityApi.deleteJob(jobId),

    onMutate: async (jobId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.quality.all })

      // Snapshot for rollback
      const snapshots = createJobsSnapshot(queryClient)

      // Optimistically remove job from ALL job queries
      queryClient.setQueriesData<QualityJobsData>({ queryKey: queryKeys.quality.all }, (old) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.filter((job) => job.id !== jobId)
        }
        if ('jobs' in old && Array.isArray(old.jobs)) {
          return { ...old, jobs: old.jobs.filter((job) => job.id !== jobId) }
        }
        return old
      })

      return { snapshots }
    },

    onError: (_, __, context) => {
      restoreSnapshots(queryClient, context?.snapshots)
    },

    onSuccess: () => {
      // Optimistic update already applied
    },
  })
}

/**
 * Clear quality job history (completed + failed jobs).
 * Optimistically removes all completed/failed jobs from list.
 */
export function useClearQualityJobHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => qualityApi.clearJobHistory(),

    onMutate: async () => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.quality.all })

      // Snapshot for rollback
      const snapshots = createJobsSnapshot(queryClient)

      // Optimistically remove completed/failed jobs from ALL job queries
      queryClient.setQueriesData<QualityJobsData>({ queryKey: queryKeys.quality.all }, (old) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.filter((job) => job.status !== 'completed' && job.status !== 'failed')
        }
        if ('jobs' in old && Array.isArray(old.jobs)) {
          return {
            ...old,
            jobs: old.jobs.filter((job) => job.status !== 'completed' && job.status !== 'failed')
          }
        }
        return old
      })

      return { snapshots }
    },

    onError: (_, __, context) => {
      restoreSnapshots(queryClient, context?.snapshots)
    },

    onSuccess: () => {
      // Optimistic update already applied
    },
  })
}

/**
 * Resume a cancelled quality job.
 * Optimistically updates job status to 'pending'.
 */
export function useResumeQualityJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: string) => qualityApi.resumeJob(jobId),

    onMutate: async (jobId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.quality.all })

      // Snapshot for rollback
      const snapshots = createJobsSnapshot(queryClient)

      // Optimistically update job status to 'pending'
      queryClient.setQueriesData<QualityJobsData>({ queryKey: queryKeys.quality.all }, (old) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.map((job) => job.id === jobId ? { ...job, status: 'pending' } : job)
        }
        if ('jobs' in old && Array.isArray(old.jobs)) {
          return { ...old, jobs: old.jobs.map((job) => job.id === jobId ? { ...job, status: 'pending' } : job) }
        }
        return old
      })

      return { snapshots }
    },

    onError: (_, __, context) => {
      restoreSnapshots(queryClient, context?.snapshots)
    },

    onSuccess: () => {
      // Optimistic update already applied
    },
  })
}
