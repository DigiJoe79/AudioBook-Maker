/**
 * React Query Hooks for Chapters
 *
 * These hooks provide granular chapter management with optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { chapterApi, type ApiChapter } from '@services/api'
import { type Chapter, type Segment, type ApiSegment, type ApiProject, type Project } from '@types'
import { queryKeys } from '@services/queryKeys'
import { useSSEConnection } from '@contexts/SSEContext'

// Transform API chapter to app chapter
const transformChapter = (apiChapter: ApiChapter): Chapter => {
  return {
    ...apiChapter,
    createdAt: new Date(apiChapter.createdAt),
    updatedAt: new Date(apiChapter.updatedAt),
    segments: (apiChapter.segments || []).map((segment: ApiSegment) => ({
      ...segment,
      audioPath: segment.audioPath || undefined,
      createdAt: new Date(segment.createdAt),
      updatedAt: new Date(segment.updatedAt),
    })),
  }
}

/**
 * Fetch a single chapter by ID (SSE-driven updates, no polling)
 *
 * This hook relies on SSE events from the backend to trigger cache invalidation
 * automatically. When SSE is unavailable, it falls back to infrequent polling.
 *
 * SSE Events that invalidate chapter cache:
 * - segment.completed → invalidates chapters.detail(chapterId)
 * - segment.failed → invalidates chapters.detail(chapterId)
 * - segment.updated → invalidates chapters.detail(chapterId)
 * - job.completed → invalidates chapters.detail(chapterId)
 * - job.failed → invalidates chapters.detail(chapterId)
 * - chapter.updated → invalidates chapters.detail(chapterId)
 *
 * @param chapterId - The chapter ID to fetch
 *
 * @example
 * ```tsx
 * const { data: chapter } = useChapter(chapterId)
 * // Updates automatically via SSE events (no polling needed)
 * ```
 */
export function useChapter(
  chapterId: string | null | undefined
): UseQueryResult<Chapter, Error> {
  // Check if SSE is active (uses shared context connection)
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse'

  return useQuery({
    queryKey: queryKeys.chapters.detail(chapterId || ''),
    queryFn: async () => {
      if (!chapterId) throw new Error('Chapter ID is required')
      const data = await chapterApi.getById(chapterId)
      return transformChapter(data)
    },
    enabled: !!chapterId,
    // SSE-aware polling: Only poll as fallback when SSE is unavailable
    // When SSE is active, cache invalidation is event-driven (no polling)
    refetchInterval: isSSEActive ? false : 10000, // 10s fallback polling
  })
}

/**
 * Create a new chapter
 *
 * @example
 * ```tsx
 * const createChapter = useCreateChapter()
 *
 * await createChapter.mutateAsync({
 *   projectId: 'project-123',
 *   title: 'Chapter 1',
 *   orderIndex: 0
 * })
 * ```
 */
export function useCreateChapter(): UseMutationResult<
  Chapter,
  Error,
  { projectId: string; title: string; orderIndex: number }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      projectId: string
      title: string
      orderIndex: number
    }) => {
      const created = await chapterApi.create(data)
      return transformChapter(created)
    },
    onSuccess: (newChapter, variables) => {
      // Invalidate to refetch project with the new chapter
      // Backend is source of truth - may have set additional fields (timestamps, defaults, etc.)
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

/**
 * Update an existing chapter
 *
 * @example
 * ```tsx
 * const updateChapter = useUpdateChapter()
 *
 * await updateChapter.mutateAsync({
 *   id: 'chapter-123',
 *   data: { title: 'Updated Title' }
 * })
 * ```
 */
export function useUpdateChapter(): UseMutationResult<
  Chapter,
  Error,
  { id: string; data: { title?: string; orderIndex?: number } }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: { title?: string; orderIndex?: number }
    }) => {
      const updated = await chapterApi.update(id, data)
      return transformChapter(updated)
    },
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({
        queryKey: queryKeys.chapters.detail(id),
      })

      // Snapshot previous value for rollback on error
      const previousChapter = queryClient.getQueryData<Chapter>(
        queryKeys.chapters.detail(id)
      )

      // No optimistic update here since we use backend response in onSuccess
      // This prevents controlled input fields from being overwritten while user types

      return { previousChapter }
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(variables.id),
          context.previousChapter
        )
      }
    },
    onSuccess: (updatedChapter, variables) => {
      // Write backend response directly to chapter cache (no refetch needed)
      queryClient.setQueryData(
        queryKeys.chapters.detail(variables.id),
        updatedChapter
      )

      // Update projects caches with the updated chapter
      // This ensures nested chapter data stays in sync without full refetch
      queryClient.setQueryData(
        queryKeys.projects.detail(updatedChapter.projectId),
        (oldProject: Project | undefined) => {
          if (!oldProject) return oldProject
          return {
            ...oldProject,
            chapters: oldProject.chapters.map((ch: Chapter) =>
              ch.id === variables.id ? updatedChapter : ch
            ),
          }
        }
      )

      queryClient.setQueryData(
        queryKeys.projects.lists(),
        (oldProjects: Project[] | undefined) => {
          if (!oldProjects) return oldProjects
          return oldProjects.map((project: Project) => {
            if (project.id !== updatedChapter.projectId) return project
            return {
              ...project,
              chapters: project.chapters.map((ch: Chapter) =>
                ch.id === variables.id ? updatedChapter : ch
              ),
            }
          })
        }
      )
    },
  })
}

/**
 * Delete a chapter (cascades to segments)
 *
 * @example
 * ```tsx
 * const deleteChapter = useDeleteChapter()
 *
 * await deleteChapter.mutateAsync({
 *   chapterId: 'chapter-123',
 *   projectId: 'project-123'
 * })
 * ```
 */
export function useDeleteChapter(): UseMutationResult<
  void,
  Error,
  { chapterId: string; projectId: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ chapterId }: { chapterId: string; projectId: string }) => {
      await chapterApi.delete(chapterId)
    },
    onSuccess: (_, variables) => {
      // DON'T remove the query here! If we do, the invalidateQueries below will
      // trigger a re-render where AppLayout still has selectedChapterId set,
      // causing React Query to mount a new observer and fetch (404).
      // Instead, just invalidate projects and let the stale chapter query sit in cache.
      // It will be garbage collected eventually.

      // Invalidate parent project
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

/**
 * Segment text into natural segments (always uses sentence-based segmentation)
 *
 * @example
 * ```tsx
 * const segmentText = useSegmentText()
 *
 * await segmentText.mutateAsync({
 *   chapterId: 'chapter-123',
 *   text: 'Long text to segment...',
 *   options: {
 *     language: 'de',
 *     ttsEngine: 'xtts',
 *     ttsModelName: 'v2.0.2'
 *   }
 * })
 * ```
 */
export function useSegmentText(): UseMutationResult<
  {
    success: boolean
    message: string
    segments: Segment[]
    segmentCount: number
    ttsEngine: string
    constraints: Record<string, number>
  },
  Error,
  {
    chapterId: string
    text: string
    options?: {
      language?: string  // Text language for segmentation
      ttsEngine?: string
      ttsModelName?: string
      ttsLanguage?: string  // TTS language (optional)
      ttsSpeakerName?: string
      minLength?: number
      maxLength?: number
    }
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      chapterId,
      text,
      options,
    }: {
      chapterId: string
      text: string
      options?: {
        language?: string
        engine?: string
        modelName?: string
        speakerName?: string
        minLength?: number
        maxLength?: number
      }
    }) => {
      return await chapterApi.segmentText(chapterId, {
        text,
        ...options,
      })
    },
    onSuccess: (response, variables) => {
      // Write segments directly to cache (no refetch needed)
      if (response.segments) {
        // Update chapter cache by appending new segments to existing ones
        queryClient.setQueryData(
          queryKeys.chapters.detail(variables.chapterId),
          (oldChapter: Chapter | undefined) => {
            if (!oldChapter) return oldChapter
            return {
              ...oldChapter,
              // Append new segments to end of existing segments
              segments: [...(oldChapter.segments || []), ...response.segments],
            }
          }
        )

        // Update projects list cache with new segments
        queryClient.setQueryData(
          queryKeys.projects.lists(),
          (oldProjects: Project[] | undefined) => {
            if (!oldProjects) return oldProjects
            return oldProjects.map((project: Project) => ({
              ...project,
              chapters: project.chapters.map((chapter: Chapter) => {
                if (chapter.id !== variables.chapterId) return chapter
                return {
                  ...chapter,
                  segments: response.segments,
                }
              }),
            }))
          }
        )
      }
    },
  })
}
