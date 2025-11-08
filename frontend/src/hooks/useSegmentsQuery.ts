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
import { segmentApi, type ApiSegment } from '../services/api'
import { type Segment } from '../types'
import { queryKeys } from '../services/queryKeys'

// Transform API segment to app segment
// Backend now returns camelCase via Pydantic Response Models
const transformSegment = (apiSegment: ApiSegment): Segment => {
  return {
    ...apiSegment,
    audioPath: apiSegment.audioPath || undefined,
    createdAt: new Date(apiSegment.createdAt),
    updatedAt: new Date(apiSegment.updatedAt),
  }
}

/**
 * Fetch a single segment by ID (rarely needed)
 *
 * @example
 * ```tsx
 * const { data: segment } = useSegment(segmentId)
 * ```
 */
export function useSegment(
  segmentId: string | null | undefined
): UseQueryResult<Segment, Error> {
  return useQuery({
    queryKey: queryKeys.segments.detail(segmentId || ''),
    queryFn: async () => {
      if (!segmentId) throw new Error('Segment ID is required')
      const data = await segmentApi.getById(segmentId)
      return transformSegment(data)
    },
    enabled: !!segmentId,
  })
}

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
      const updated = await segmentApi.update(segmentId, data)
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
      queryClient.setQueryData<any>(queryKeys.chapters.detail(chapterId), (old: any) => {
        if (!old) return old
        return {
          ...old,
          segments: old.segments.map((s: any) =>
            s.id === segmentId ? { ...s, ...data } : s
          ),
        }
      })

      // Optimistically update segment detail query
      queryClient.setQueryData<any>(queryKeys.segments.detail(segmentId), (old: any) => {
        if (!old) return old
        return { ...old, ...data }
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
      queryClient.setQueryData<any>(
        queryKeys.chapters.detail(variables.chapterId),
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.map((s: any) =>
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
      queryClient.setQueryData<any>(
        queryKeys.chapters.detail(chapterId),
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.filter((s: any) => s.id !== segmentId),
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
