/**
 * React Query Hooks for Segments
 *
 * Segments are usually accessed via useChapter, but these hooks provide
 * granular mutation operations for segment updates and deletions.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { produce } from 'immer'
import { segmentApi } from '@services/api'
import { type Segment, type Chapter, transformSegment, type ApiSegment } from '@types'
import { queryKeys } from '@services/queryKeys'

/**
 * Update a segment
 *
 * @example
 * ```tsx
 * const updateSegment = useUpdateSegment()
 *
 * await updateSegment.mutateAsync({
 *   segmentId: 'segment-123',
 *   chapterId: 'chapter-123',
 *   data: { text: 'Updated text' }
 * })
 * ```
 */
export function useUpdateSegment(): UseMutationResult<
  Segment,
  Error,
  {
    segmentId: string
    chapterId: string
    data: {
      text?: string
      audioPath?: string
      startTime?: number
      endTime?: number
      status?: string
      pauseDuration?: number
      engine?: string
      modelName?: string
      language?: string
      speakerName?: string | null
    }
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      segmentId,
      data,
    }: {
      segmentId: string
      chapterId: string
      data: {
        text?: string
        audioPath?: string
        startTime?: number
        endTime?: number
        status?: string
        pauseDuration?: number
        engine?: string
        modelName?: string
        language?: string
        speakerName?: string | null
      }
    }) => {
      const updated = await segmentApi.update(segmentId, data) as ApiSegment
      return transformSegment(updated)
    },
    onMutate: async (variables) => {
      const { segmentId, chapterId, data } = variables

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chapters.detail(chapterId) })
      await queryClient.cancelQueries({ queryKey: queryKeys.segments.detail(segmentId) })

      // Snapshot the previous values
      const previousChapter = queryClient.getQueryData(queryKeys.chapters.detail(chapterId))
      const previousSegment = queryClient.getQueryData(queryKeys.segments.detail(segmentId))

      // Optimistically update segment in chapter query
      queryClient.setQueryData<Chapter>(queryKeys.chapters.detail(chapterId), (old: Chapter | undefined) => {
        if (!old) return old
        return {
          ...old,
          segments: old.segments.map((s: Segment) =>
            s.id === segmentId ? { ...s, ...data } as Segment : s
          ),
        }
      })

      // Optimistically update segment detail query
      queryClient.setQueryData<Segment>(queryKeys.segments.detail(segmentId), (old: Segment | undefined) => {
        if (!old) return old
        return { ...old, ...data } as Segment
      })

      return { previousChapter, previousSegment, chapterId, segmentId }
    },
    onError: (_, __, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(queryKeys.chapters.detail(context.chapterId), context.previousChapter)
      }
      if (context?.previousSegment) {
        queryClient.setQueryData(queryKeys.segments.detail(context.segmentId), context.previousSegment)
      }
    },
    onSuccess: (updatedSegment, variables) => {
      // Update with backend response (for any computed fields)
      queryClient.setQueryData(
        queryKeys.segments.detail(variables.segmentId),
        updatedSegment
      )

      // Also update segment in chapter query with backend response
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(variables.chapterId),
        (old: Chapter | undefined) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.map((s: Segment) =>
              s.id === variables.segmentId ? updatedSegment : s
            ),
          }
        }
      )
    },
  })
}

/**
 * Delete a segment
 *
 * @example
 * ```tsx
 * const deleteSegment = useDeleteSegment()
 *
 * await deleteSegment.mutateAsync({
 *   segmentId: 'segment-123',
 *   chapterId: 'chapter-123'
 * })
 * ```
 */
export function useDeleteSegment(): UseMutationResult<
  void,
  Error,
  { segmentId: string; chapterId: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ segmentId }: { segmentId: string; chapterId: string }) => {
      await segmentApi.delete(segmentId)
    },
    onMutate: async ({ segmentId, chapterId }) => {
      // Cancel outgoing refetches for this chapter
      await queryClient.cancelQueries({
        queryKey: queryKeys.chapters.detail(chapterId),
      })

      // Snapshot previous chapter
      const previousChapter = queryClient.getQueryData(
        queryKeys.chapters.detail(chapterId)
      )

      // Optimistically remove segment from chapter
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId),
        (old: Chapter | undefined) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.filter((s: Segment) => s.id !== segmentId),
          }
        }
      )

      return { previousChapter, chapterId }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(context.chapterId),
          context.previousChapter
        )
      }
    },
    onSuccess: (_, variables) => {
      // Remove segment from cache
      queryClient.removeQueries({
        queryKey: queryKeys.segments.detail(variables.segmentId),
      })

      // Invalidate chapter to ensure consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
    },
  })
}

/**
 * Freeze a segment (protect from regeneration and STT analysis)
 *
 * @example
 * ```tsx
 * const freezeMutation = useFreezeSegment()
 * await freezeMutation.mutateAsync({ segmentId: 'seg-123', chapterId: 'ch-456' })
 * ```
 */
export function useFreezeSegment(): UseMutationResult<
  Segment,
  Error,
  { segmentId: string; chapterId: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ segmentId, chapterId }: { segmentId: string; chapterId: string }) => {
      const response = await segmentApi.freeze(segmentId, true) as ApiSegment
      return transformSegment(response)
    },
    onMutate: async ({ segmentId, chapterId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chapters.detail(chapterId) })

      // Snapshot previous chapter
      const previousChapter = queryClient.getQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId)
      )

      // Optimistically freeze segment using immer (O(1) performance)
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId),
        produce((draft: Chapter | undefined) => {
          if (!draft) return
          const segment = draft.segments.find(s => s.id === segmentId)
          if (segment) {
            segment.isFrozen = true
          }
        })
      )

      return { previousChapter, chapterId }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(context.chapterId),
          context.previousChapter
        )
      }
    },
    onSuccess: (updatedSegment, variables) => {
      // Update chapter cache with backend response (ensure consistency)
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(variables.chapterId),
        produce((draft: Chapter | undefined) => {
          if (!draft) return
          const segment = draft.segments.find(s => s.id === variables.segmentId)
          if (segment) {
            segment.isFrozen = true
          }
        })
      )
    },
  })
}

/**
 * Unfreeze a segment (allow regeneration and STT analysis)
 *
 * @example
 * ```tsx
 * const unfreezeMutation = useUnfreezeSegment()
 * await unfreezeMutation.mutateAsync({ segmentId: 'seg-123', chapterId: 'ch-456' })
 * ```
 */
export function useUnfreezeSegment(): UseMutationResult<
  Segment,
  Error,
  { segmentId: string; chapterId: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ segmentId, chapterId }: { segmentId: string; chapterId: string }) => {
      const response = await segmentApi.freeze(segmentId, false) as ApiSegment
      return transformSegment(response)
    },
    onMutate: async ({ segmentId, chapterId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chapters.detail(chapterId) })

      // Snapshot previous chapter
      const previousChapter = queryClient.getQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId)
      )

      // Optimistically unfreeze segment using immer (O(1) performance)
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(chapterId),
        produce((draft: Chapter | undefined) => {
          if (!draft) return
          const segment = draft.segments.find(s => s.id === segmentId)
          if (segment) {
            segment.isFrozen = false
          }
        })
      )

      return { previousChapter, chapterId }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(context.chapterId),
          context.previousChapter
        )
      }
    },
    onSuccess: (updatedSegment, variables) => {
      // Update chapter cache with backend response (ensure consistency)
      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(variables.chapterId),
        produce((draft: Chapter | undefined) => {
          if (!draft) return
          const segment = draft.segments.find(s => s.id === variables.segmentId)
          if (segment) {
            segment.isFrozen = false
          }
        })
      )
    },
  })
}
