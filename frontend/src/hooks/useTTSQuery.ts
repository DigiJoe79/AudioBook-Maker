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
import { ttsApi, type TTSOptions } from '../services/api'
import { queryKeys } from '../services/queryKeys'
import type { TTSEngine, TTSModel } from '../types'
import { useSSEConnection } from '../contexts/SSEContext'
import { logger } from '../utils/logger'

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
export function useSpeakers(): UseQueryResult<
  Array<{
    id: string
    name: string
    description?: string
    gender?: string
    languages: string[]
    tags: string[]
    isDefault: boolean
    isActive: boolean
    sampleCount: number
    createdAt: string
    updatedAt: string
    samples: Array<{
      id: string
      filePath: string
      fileName: string
      fileSize: number
      duration?: number
      sampleRate?: number
      transcript?: string
      createdAt: string
    }>
  }>,
  Error
> {
  return useQuery({
    queryKey: queryKeys.tts.speakers(),
    queryFn: async () => {
      return await ttsApi.getSpeakers()
    },
    // Speakers don't change often, cache for longer
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}

/**
 * Fetch list of available TTS engines
 *
 * Returns metadata for all registered engines including their capabilities,
 * supported languages, and generation constraints.
 *
 * @example
 * ```tsx
 * const { data: engines, isLoading } = useTTSEngines()
 *
 * // Show engine dropdown
 * {engines?.map(engine => (
 *   <MenuItem key={engine.name} value={engine.name}>
 *     {engine.displayName}
 *   </MenuItem>
 * ))}
 * ```
 */
export function useTTSEngines(): UseQueryResult<TTSEngine[], Error> {
  return useQuery({
    queryKey: queryKeys.tts.engines(),
    queryFn: async () => {
      const result = await ttsApi.getEngines()
      return result.engines
    },
    // Engines don't change at runtime, cache for longer
    staleTime: 30 * 60 * 1000, // 30 minutes
  })
}

/**
 * Fetch list of available models for a specific TTS engine
 *
 * Returns metadata for all available models including version, size, and path.
 *
 * @param engineType - Engine identifier 
 *
 * @example
 * ```tsx
 * const { data: models, isLoading } = useTTSModels('engine')
 *
 * // Show model dropdown
 * {models?.map(model => (
 *   <MenuItem key={model.modelName} value={model.modelName}>
 *     {model.displayName}
 *     {model.sizeMb && ` (${model.sizeMb.toFixed(0)} MB)`}
 *   </MenuItem>
 * ))}
 * ```
 */
export function useTTSModels(engineType: string | null | undefined): UseQueryResult<TTSModel[], Error> {
  // Validate that engine exists before querying models
  const { data: engines = [], isLoading: enginesLoading } = useTTSEngines()

  // Only enable query if:
  // 1. engineType is provided
  // 2. engines list has loaded (not loading)
  // 3. engineType exists in available engines list
  const engineExists = !enginesLoading && engines.some(e => e.name === engineType)
  const shouldFetch = !!engineType && engineExists

  return useQuery({
    queryKey: queryKeys.tts.models(engineType || ''),
    queryFn: async () => {
      if (!engineType) throw new Error('Engine type is required')
      const result = await ttsApi.getEngineModels(engineType)
      // Map API response (ttsModelName) to frontend interface (modelName)
      return result.models.map(model => ({
        ...model,
        modelName: model.ttsModelName
      }))
    },
    enabled: shouldFetch,
    // Models don't change often, cache for longer
    staleTime: 30 * 60 * 1000, // 30 minutes
  })
}

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
    segment: any
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
      queryClient.setQueryData<any>(
        queryKeys.chapters.detail(chapterId),
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.map((s: any) =>
              s.id === segmentId ? { ...s, status: 'processing', audioPath: null } : s
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
 * @example
 * ```tsx
 * const generateChapter = useGenerateChapter()
 *
 * await generateChapter.mutateAsync({
 *   chapterId: 'chapter-123',
 *   ttsSpeakerName: 'default_speaker',  
 *   language: 'de',
 *   ttsEngine: 'engineName',  // Required
 *   ttsModelName: 'modelName',  // Required
 *   forceRegenerate: false  // Optional, if true, regenerates completed segments
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
    ttsSpeakerName: string  
    language: string
    ttsEngine: string
    ttsModelName: string
    forceRegenerate?: boolean
    options?: TTSOptions
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      chapterId: string
      ttsSpeakerName: string  
      language: string
      ttsEngine: string
      ttsModelName: string
      forceRegenerate?: boolean
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
 * Cancel chapter generation
 *
 * @example
 * ```tsx
 * const cancelGeneration = useCancelChapterGeneration()
 * await cancelGeneration.mutateAsync('chapter-123')
 * ```
 */
export function useCancelChapterGeneration(): UseMutationResult<
  {
    status: string
    chapterId: string
  },
  Error,
  string
> {
  return useMutation({
    mutationFn: async (chapterId: string) => {
      return await ttsApi.cancelChapterGeneration(chapterId)
    },
    // NO invalidation needed - SSE job.cancelled event handles updates automatically
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

/**
 * Helper hook to check if any segment in a chapter is generating
 *
 * @example
 * ```tsx
 * const isGenerating = useIsChapterGenerating(chapter)
 * ```
 */
export function useIsChapterGenerating(chapter: any | null | undefined): boolean {
  if (!chapter?.segments) return false
  return chapter.segments.some(
    (s: any) => s.status === 'processing'
  )
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
    queryFn: () => ttsApi.listJobs(filters),
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
          const hasActiveJobs = data?.jobs && data.jobs.some((job: any) =>
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
    queryFn: () => ttsApi.listActiveJobs(),
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
 * Query single TTS job by ID with auto-polling
 *
 * Automatically polls while job is active (pending, running, cancelling)
 * and stops when job completes or fails.
 *
 * @example
 * ```tsx
 * const { data: job } = useTTSJob(jobId)
 * const progress = job ? (job.processedSegments / job.totalSegments) * 100 : 0
 *
 * // With custom polling
 * const { data: job } = useTTSJob(jobId, { pollingInterval: 1000 })
 * ```
 */
export function useTTSJob(
  jobId: string | null | undefined,
  options?: {
    pollingInterval?: number
    enabled?: boolean
  }
) {
  const { pollingInterval = 500, enabled = true } = options || {}

  // Check if SSE is active
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse'

  return useQuery({
    queryKey: queryKeys.tts.job(jobId ?? ''),
    queryFn: () => {
      if (!jobId) throw new Error('Job ID is required')
      return ttsApi.getJob(jobId)
    },
    enabled: enabled && !!jobId,
    refetchInterval: isSSEActive
      ? false // No polling when SSE active
      : (query) => {
          // Auto-stop polling when job completes
          const data = query.state.data
          if (!data) return false
          const isActive = ['pending', 'running', 'cancelling'].includes(data.status)
          return isActive ? pollingInterval : false
        },
    // Increase staleTime when SSE active
    staleTime: isSSEActive ? Infinity : 0,
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
      await queryClient.cancelQueries({ queryKey: ['tts', 'jobs'] })

      // Snapshot all job queries for rollback
      const snapshots = new Map<string, any>()
      queryClient.getQueriesData<any>({ queryKey: ['tts', 'jobs'] }).forEach(([key, data]) => {
        if (data) {
          snapshots.set(JSON.stringify(key), data)
        }
      })

      // Optimistically remove job from ALL job queries
      queryClient.setQueriesData<any>({ queryKey: ['tts', 'jobs'] }, (old: any) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.filter((job: any) => job.id !== jobId)
        }
        if (old.jobs && Array.isArray(old.jobs)) {
          return { ...old, jobs: old.jobs.filter((job: any) => job.id !== jobId) }
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
      await queryClient.cancelQueries({ queryKey: ['tts', 'jobs'] })

      // Snapshot all job queries for rollback
      const snapshots = new Map<string, any>()
      queryClient.getQueriesData<any>({ queryKey: ['tts', 'jobs'] }).forEach(([key, data]) => {
        if (data) {
          snapshots.set(JSON.stringify(key), data)
        }
      })

      // Optimistically remove completed/failed jobs from ALL job queries
      queryClient.setQueriesData<any>({ queryKey: ['tts', 'jobs'] }, (old: any) => {
        if (!old) return old
        if (Array.isArray(old)) {
          return old.filter((job: any) => job.status !== 'completed' && job.status !== 'failed')
        }
        if (old.jobs && Array.isArray(old.jobs)) {
          return {
            ...old,
            jobs: old.jobs.filter((job: any) => job.status !== 'completed' && job.status !== 'failed')
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
  import('../types').TTSJob,
  Error,
  string
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: string) => {
      return await ttsApi.resumeJob(jobId)
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
