/**
 * React Query Hooks for TTS Generation
 *
 * These hooks handle TTS generation with automatic progress polling and
 * seamless integration with chapter/segment queries.
 */

import { useEffect } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { ttsApi, type TTSOptions, type ApiSegment } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type { Chapter, TTSJob, TTSJobsListResponse, Speaker } from '@types'
import type { ApiTTSJob, ApiTTSJobsListResponse, ApiSpeaker } from '@/types/api'
import { useSSEConnection } from '@contexts/SSEContext'
import { logger } from '@utils/logger'

// ============================================================================
// Transform Functions (API → App Types)
// ============================================================================

/**
 * Transform API TTS Job response to app type with Date objects
 */
const transformTTSJob = (apiJob: ApiTTSJob): TTSJob => ({
  ...apiJob,
  createdAt: new Date(apiJob.createdAt),
  startedAt: apiJob.startedAt ? new Date(apiJob.startedAt) : null,
  completedAt: apiJob.completedAt ? new Date(apiJob.completedAt) : null,
  updatedAt: new Date(apiJob.updatedAt),
})

/**
 * Transform API Speaker response to app type with Date objects
 */
const transformSpeaker = (apiSpeaker: ApiSpeaker): Speaker => ({
  ...apiSpeaker,
  createdAt: new Date(apiSpeaker.createdAt),
  updatedAt: new Date(apiSpeaker.updatedAt),
  samples: apiSpeaker.samples.map(sample => ({
    ...sample,
    createdAt: new Date(sample.createdAt),
  })),
})

/**
 * Fetch list of available speakers from database
 *
 * Returns speakers with their voice samples. Speakers are engine-independent
 * and managed in the database via the /api/speakers/ endpoint.
 *
 * @example
 * ```tsx
 * const { data: speakers } = useSpeakers()
 * ```
 */
export function useSpeakers(): UseQueryResult<Speaker[], Error> {
  return useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: async () => {
      const apiSpeakers = await ttsApi.getSpeakers()
      return apiSpeakers.map(transformSpeaker)
    },
    // Speakers don't change often, cache for longer
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}

// Note: useTTSEngines() and useTTSModels() have been removed.
// All components now use useAllEnginesStatus() from @hooks/useEnginesQuery instead.
// Models are now part of EngineStatusInfo.availableModels: string[]

/**
 * Generate audio for a single segment (regenerate)
 *
 * All parameters (speaker, language, engine, model, TTS options) are loaded
 * from the segment's stored values and database settings. No parameters needed.
 *
 * @example
 * ```tsx
 * const generateSegment = useGenerateSegment()
 *
 * await generateSegment.mutateAsync({
 *   segmentId: 'segment-123',
 *   chapterId: 'chapter-123'  // For cache invalidation
 * })
 * ```
 */
export function useGenerateSegment(): UseMutationResult<
  {
    success: boolean
    segment: ApiSegment // Use ApiSegment (string dates) instead of Segment (Date objects)
    message: string
  },
  Error,
  {
    segmentId: string
    chapterId: string
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ segmentId }: { segmentId: string; chapterId: string }) => {
      return await ttsApi.generateSegmentById(segmentId)
    },
    onMutate: async ({ segmentId, chapterId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chapters.detail(chapterId) })

      // Snapshot the previous chapter state
      const previousChapter = queryClient.getQueryData(queryKeys.chapters.detail(chapterId))

      // Optimistically set segment status to processing
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId),
        (old) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.map((s) =>
              s.id === segmentId ? { ...s, status: 'processing' as const, audioPath: null } : s
            ),
          }
        }
      )

      return { previousChapter, chapterId }
    },
    onSuccess: (_, variables) => {
      // Invalidate chapter to show updated segment with audio
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
      // NOTE: NO activeJobs invalidation - SSE job.created event handles this automatically
    },
    onError: (_, __, context) => {
      // Rollback: Restore previous chapter state
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(context.chapterId),
          context.previousChapter
        )
      }
    },
  })
}

/**
 * Generate audio for entire chapter (batch operation)
 *
 * Returns immediately, generation happens in background.
 * Progress monitoring is handled by SSE events (useSSEEventHandlers).
 *
 * **Two modes:**
 * 1. **Default** (overrideSegmentSettings=false): Segments keep their individual TTS parameters
 * 2. **Override** (overrideSegmentSettings=true): All segments updated with provided parameters
 *
 * @example
 * ```tsx
 * const generateChapter = useGenerateChapter()
 *
 * // Default mode - use segment parameters
 * await generateChapter.mutateAsync({
 *   chapterId: 'chapter-123',
 *   forceRegenerate: false,
 *   overrideSegmentSettings: false
 * })
 *
 * // Override mode - set parameters for all segments
 * await generateChapter.mutateAsync({
 *   chapterId: 'chapter-123',
 *   overrideSegmentSettings: true,
 *   ttsSpeakerName: 'speaker-name',
 *   language: 'de',
 *   ttsEngine: 'xtts',
 *   ttsModelName: 'v2.0.2',
 *   forceRegenerate: false
 * })
 * ```
 */
export function useGenerateChapter(): UseMutationResult<
  {
    status: string
    chapterId: string
    message?: string
  },
  Error,
  {
    chapterId: string
    forceRegenerate?: boolean
    overrideSegmentSettings?: boolean
    // TTS parameters (only used when overrideSegmentSettings=true)
    ttsSpeakerName?: string
    language?: string
    ttsEngine?: string
    ttsModelName?: string
    options?: TTSOptions
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      chapterId: string
      forceRegenerate?: boolean
      overrideSegmentSettings?: boolean
      ttsSpeakerName?: string
      language?: string
      ttsEngine?: string
      ttsModelName?: string
      options?: TTSOptions
    }) => {
      return await ttsApi.generateChapter(data)
    },
    onSuccess: (_, variables) => {
      // Invalidate chapter immediately to show status changes
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
      // NOTE: NO activeJobs invalidation - SSE job.created event handles this automatically
    },
  })
}

/**
 * Cancel a specific TTS job by job ID
 *
 * @example
 * ```tsx
 * const cancelJob = useCancelJob()
 * await cancelJob.mutateAsync(jobId)
 * ```
 */
export function useCancelJob(): UseMutationResult<
  {
    success: boolean
    jobId: string
    status: string
  },
  Error,
  string
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: string) => {
      return await ttsApi.cancelJob(jobId)
    },
    onSuccess: () => {
      // NO invalidation here - SSE will handle the update optimistically
      // This prevents the job from disappearing and reappearing
      // The job.cancelled SSE event will update the cache immediately
    },
  })
}

// ============================================================================
// TTS Job Management Hooks (Database-Backed)
// ============================================================================

/**
 * Query TTS jobs with optional filters
 *
 * @example
 * ```tsx
 * // All jobs for a chapter
 * const { data } = useTTSJobs({ chapterId: 'ch-123' })
 *
 * // All completed jobs
 * const { data } = useTTSJobs({ status: 'completed' })
 *
 * // All active jobs (pending + running)
 * const { data } = useTTSJobs({ status: ['pending', 'running'] })
 * ```
 */
export function useTTSJobs(
  filters?: {
    status?: string
    chapterId?: string
    limit?: number
    offset?: number
  },
  options?: {
    enabled?: boolean
    refetchInterval?: number | false
  }
) {
  // Get SSE connection status from shared context
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse' && sseConnection.status === 'connected'

  return useQuery({
    queryKey: queryKeys.tts.jobs(filters),
    queryFn: async () => {
      const response = await ttsApi.listJobs(filters) as unknown as ApiTTSJobsListResponse
      return {
        ...response,
        jobs: response.jobs.map(transformTTSJob)
      } as TTSJobsListResponse
    },
    enabled: options?.enabled ?? true,
    // When SSE active: Never refetch (infinite stale time)
    // When SSE unavailable: Allow refetch after 5s
    staleTime: isSSEActive ? Infinity : 5000,
    // CRITICAL: Direct control of refetchInterval based on SSE status
    refetchInterval: isSSEActive
      ? false  // Disabled - SSE handles all updates
      : options?.refetchInterval !== undefined
      ? options.refetchInterval  // Use custom interval if provided
      : (query) => {
          // Smart polling when SSE unavailable
          const data = query.state.data
          const hasActiveJobs = data?.jobs && data.jobs.some((job) =>
            job.status === 'pending' || job.status === 'running'
          )
          // Poll every 10s if jobs exist, otherwise don't poll
          return hasActiveJobs ? 10000 : false
        },
  })
}

/**
 * Query all active TTS jobs (pending + running) with SSE-aware polling
 *
 * When SSE is active: No polling - SSE events update cache in real-time
 * When SSE unavailable: Falls back to 10s polling if active jobs exist
 * When no active jobs: No polling at all
 *
 * This eliminates 99% of polling requests when SSE is working.
 *
 * @example
 * ```tsx
 * const { data: activeJobs } = useActiveTTSJobs()
 * const hasActiveJobs = (activeJobs?.jobs.length ?? 0) > 0
 * ```
 */
export function useActiveTTSJobs(options?: {
  enabled?: boolean
}) {
  const { enabled = true } = options || {}

  // Get SSE connection status from shared context
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse' && sseConnection.status === 'connected'

  // CRITICAL: Disable polling completely when SSE is active
  // React Query's refetchInterval is NOT reactive, so we control it via config
  return useQuery({
    queryKey: queryKeys.tts.activeJobs(),
    queryFn: async () => {
      const response = await ttsApi.listActiveJobs() as unknown as ApiTTSJobsListResponse
      return {
        ...response,
        jobs: response.jobs.map(transformTTSJob)
      } as TTSJobsListResponse
    },
    enabled,
    // When SSE active: Never refetch (infinite stale time)
    // When SSE unavailable: Allow refetch after 5s
    staleTime: isSSEActive ? Infinity : 5000,
    // When SSE active: NO polling interval at all
    // When SSE unavailable: Use function for smart polling
    refetchInterval: isSSEActive
      ? false  // Disabled - SSE handles all updates
      : (query) => {
          // Only when SSE is NOT active
          const data = query.state.data
          const hasActiveJobs = data?.jobs && data.jobs.length > 0
          // Poll every 10s if jobs exist, otherwise don't poll
          return hasActiveJobs ? 10000 : false
        },
    // IMPORTANT: Refetch on mount to get fresh data after reconnect
    refetchOnMount: 'always',
  })
}

/**
 * Delete a specific job by ID
 *
 * Primarily used for deleting individual cancelled jobs that won't be resumed.
 *
 * @example
 * ```tsx
 * const deleteJob = useDeleteJob()
 * await deleteJob.mutateAsync(jobId)
 * ```
 */
export function useDeleteJob(): UseMutationResult<
  { success: boolean; deleted: boolean; jobId: string },
  Error,
  string
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: string) => {
      return await ttsApi.deleteJob(jobId)
    },
    onMutate: async (jobId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.tts.all })

      // Snapshot all job queries for rollback
      const snapshots = new Map<string, TTSJobsListResponse | TTSJob[]>()
      queryClient.getQueriesData<TTSJobsListResponse | TTSJob[]>({ queryKey: queryKeys.tts.all }).forEach(([key, data]) => {
        if (data) {
          snapshots.set(JSON.stringify(key), data)
        }
      })

      // Optimistically remove job from ALL job queries
      queryClient.setQueriesData<TTSJobsListResponse | TTSJob[]>({ queryKey: queryKeys.tts.all }, (old) => {
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
      // Rollback: Restore all snapshots
      if (context?.snapshots) {
        context.snapshots.forEach((data, key) => {
          queryClient.setQueryData(JSON.parse(key), data)
        })
      }
    },
    onSuccess: () => {
      // No refetch needed - optimistic update is already applied
    },
  })
}

/**
 * Clear all completed and failed jobs (bulk cleanup)
 *
 * Deletes jobs with status 'completed' or 'failed'.
 * Cancelled jobs are NOT deleted (user might want to resume them).
 *
 * @example
 * ```tsx
 * const clearHistory = useClearJobHistory()
 * await clearHistory.mutateAsync()
 * ```
 */
export function useClearJobHistory(): UseMutationResult<
  { success: boolean; deleted: number },
  Error,
  void
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return await ttsApi.clearJobHistory()
    },
    onMutate: async () => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.tts.all })

      // Snapshot all job queries for rollback
      const snapshots = new Map<string, TTSJobsListResponse | TTSJob[]>()
      queryClient.getQueriesData<TTSJobsListResponse | TTSJob[]>({ queryKey: queryKeys.tts.all }).forEach(([key, data]) => {
        if (data) {
          snapshots.set(JSON.stringify(key), data)
        }
      })

      // Optimistically remove completed/failed jobs from ALL job queries
      queryClient.setQueriesData<TTSJobsListResponse | TTSJob[]>({ queryKey: queryKeys.tts.all }, (old) => {
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
      // Rollback: Restore all snapshots
      if (context?.snapshots) {
        context.snapshots.forEach((data, key) => {
          queryClient.setQueryData(JSON.parse(key), data)
        })
      }
    },
    onSuccess: (data) => {
      // No refetch needed - optimistic update is already applied
      logger.group(
        '📋 Job Cleanup',
        'Cleared finished jobs from history',
        { deletedCount: data.deleted },
        '#4CAF50'
      )
    },
  })
}

/**
 * Resume a cancelled job
 *
 * Creates a new job for remaining unprocessed segments.
 * Uses the same parameters (engine, model, speaker, language) as the original job.
 *
 * @example
 * ```tsx
 * const resumeJob = useResumeJob()
 * await resumeJob.mutateAsync(cancelledJobId)
 * ```
 */
export function useResumeJob(): UseMutationResult<
  TTSJob,
  Error,
  string
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: string) => {
      const apiJob = await ttsApi.resumeJob(jobId) as unknown as ApiTTSJob
      return transformTTSJob(apiJob)
    },
    onSuccess: (newJob) => {
      // NO invalidation here - SSE will handle the update optimistically
      // This prevents the progress bar from jumping to 0 during resume
      // The job.created and job.started SSE events will update the cache
      logger.group(
        '📋 Job Resume',
        'Resumed job with new job ID',
        { newJobId: newJob.id, totalSegments: newJob.totalSegments },
        '#4CAF50'
      )
    },
  })
}

/**
 * Enable or disable a TTS engine
 *
 * Updates engine enabled status in settings. Disabled engines are not
 * shown in engine selection dropdowns and cannot be used for generation.
 *
 * @example
 * ```tsx
 * const setEngineEnabled = useSetEngineEnabled()
 *
 * // Enable engine
 * await setEngineEnabled.mutateAsync({
 *   engineType: 'tts',
 *   engineName: 'xtts',
 *   enabled: true
 * })
 *
 * // Disable engine
 * await setEngineEnabled.mutateAsync({
 *   engineType: 'tts',
 *   engineName: 'chatterbox',
 *   enabled: false
 * })
 * ```
 */
export function useSetEngineEnabled(): UseMutationResult<
  {
    success: boolean
    message: string
  },
  Error,
  {
    engineType: string
    engineName: string
    enabled: boolean
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ engineType, engineName, enabled }) => {
      return await ttsApi.setEngineEnabled(engineType, engineName, enabled)
    },
    onSuccess: () => {
      // Invalidate engines list to refresh enabled status
      queryClient.invalidateQueries({
        queryKey: queryKeys.engines.all(),
      })
      logger.group(
        '🔧 Engine Management',
        'Engine enabled status updated',
        {},
        '#4CAF50'
      )
    },
  })
}
