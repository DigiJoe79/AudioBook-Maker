/**
 * React Query hooks for drag & drop operations (reorder, move)
 *
 * Performance Optimizations:
 * - Uses immer for O(1) cache updates instead of O(n×m) spread operations
 * - Optimistic updates for instant UI feedback with 400+ segments
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { projectApi, chapterApi, segmentApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type { Project, Chapter, Segment } from '@types'

// ============================================================================
// Project Drag & Drop Hooks
// ============================================================================

/**
 * Reorder projects
 */
export function useReorderProjects() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectIds: string[]) => projectApi.reorder(projectIds),
    onMutate: async (projectIds) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.lists())

      // Optimistically update with immer for O(1) performance
      if (previousProjects) {
        const updatedProjects = produce(previousProjects, draft => {
          projectIds.forEach((id, index) => {
            const project = draft.find(p => p.id === id)
            if (project) {
              project.orderIndex = index
            }
          })
        })

        queryClient.setQueryData(queryKeys.projects.lists(), updatedProjects)
      }

      return { previousProjects }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.lists(), context.previousProjects)
      }
    },
    // No onSettled refetch - optimistic update is already correct on success, rollback handles errors
  })
}

// ============================================================================
// Chapter Drag & Drop Hooks
// ============================================================================

/**
 * Reorder chapters within a project
 */
export function useReorderChapters() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, chapterIds }: { projectId: string; chapterIds: string[] }) =>
      chapterApi.reorder(projectId, chapterIds),
    onMutate: async ({ projectId, chapterIds }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      // Snapshot previous values
      const previousProject = queryClient.getQueryData<Project>(queryKeys.projects.detail(projectId))
      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.lists())

      // Optimistically update project detail with immer
      if (previousProject) {
        const updatedProject = produce(previousProject, draft => {
          chapterIds.forEach((id, index) => {
            const chapter = draft.chapters.find((c: Chapter) => c.id === id)
            if (chapter) {
              chapter.orderIndex = index
            }
          })
        })

        queryClient.setQueryData(queryKeys.projects.detail(projectId), updatedProject)
      }

      // Optimistically update projects list with immer (used by AppLayout)
      if (previousProjects) {
        const updatedProjects = produce(previousProjects, draft => {
          const project = draft.find(p => p.id === projectId)
          if (project) {
            chapterIds.forEach((id, index) => {
              const chapter = project.chapters.find((c: Chapter) => c.id === id)
              if (chapter) {
                chapter.orderIndex = index
              }
            })
          }
        })

        queryClient.setQueryData(queryKeys.projects.lists(), updatedProjects)
      }

      return { previousProject, previousProjects }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(queryKeys.projects.detail(variables.projectId), context.previousProject)
      }
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.lists(), context.previousProjects)
      }
    },
    // NOTE: No onSettled refetch - optimistic update is already correct on success, rollback handles errors
  })
}

/**
 * Move chapter to different project
 */
export function useMoveChapter() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      chapterId,
      newProjectId,
      newOrderIndex,
    }: {
      chapterId: string
      newProjectId: string
      newOrderIndex: number
    }) => chapterApi.move(chapterId, newProjectId, newOrderIndex),
    onSuccess: (updatedChapter) => {
      // Invalidate both source and target projects
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.chapters.detail(updatedChapter.id) })
    },
  })
}

// ============================================================================
// Segment Drag & Drop Hooks
// ============================================================================

/**
 * Reorder segments within a chapter
 *
 * CRITICAL: Uses immer for O(1) performance with deeply nested data
 * (projects → chapters → segments). Spread operators would be O(n×m) here.
 */
export function useReorderSegments() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ chapterId, segmentIds }: { chapterId: string; segmentIds: string[] }) =>
      segmentApi.reorder(chapterId, segmentIds),
    onMutate: async ({ chapterId, segmentIds }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      // Snapshot previous values
      const previousChapter = queryClient.getQueryData<Chapter>(queryKeys.chapters.detail(chapterId))
      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.lists())

      // Optimistically update chapter detail with immer
      if (previousChapter) {
        const updatedChapter = produce(previousChapter, draft => {
          segmentIds.forEach((id, index) => {
            const segment = draft.segments.find((s: Segment) => s.id === id)
            if (segment) {
              segment.orderIndex = index
            }
          })
        })

        queryClient.setQueryData(queryKeys.chapters.detail(chapterId), updatedChapter)
      }

      // Optimistically update projects list with immer (segments are nested: projects → chapters → segments)
      if (previousProjects) {
        const updatedProjects = produce(previousProjects, draft => {
          for (const project of draft) {
            const chapter = project.chapters.find((c: Chapter) => c.id === chapterId)
            if (chapter) {
              segmentIds.forEach((id, index) => {
                const segment = chapter.segments.find((s: Segment) => s.id === id)
                if (segment) {
                  segment.orderIndex = index
                }
              })
              break // Found the chapter, no need to continue
            }
          }
        })

        queryClient.setQueryData(queryKeys.projects.lists(), updatedProjects)
      }

      return { previousChapter, previousProjects }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousChapter) {
        queryClient.setQueryData(queryKeys.chapters.detail(variables.chapterId), context.previousChapter)
      }
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.lists(), context.previousProjects)
      }
    },
    // NOTE: No onSettled refetch - optimistic update is already correct on success, rollback handles errors
  })
}

// ============================================================================
// Segment Creation Hook (for Command Toolbar)
// ============================================================================

/**
 * Create new segment (standard or divider)
 */
export function useCreateSegment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      chapterId: string
      text: string
      orderIndex: number
      ttsEngine: string
      ttsModelName: string
      ttsSpeakerName?: string
      language: string
      segmentType?: 'standard' | 'divider'
      pauseDuration?: number
    }) => segmentApi.create(data),
    onSuccess: (newSegment) => {
      // Invalidate to refetch with correct orderIndices
      // When inserting a segment, backend adjusts orderIndices of all following segments
      // We only get the new segment back, not the updated others, so we must refetch
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(newSegment.chapterId)
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists()
      })
    },
  })
}
