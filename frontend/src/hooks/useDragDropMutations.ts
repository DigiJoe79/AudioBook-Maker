/**
 * React Query hooks for drag & drop operations (reorder, move)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectApi, chapterApi, segmentApi } from '../services/api'
import { queryKeys } from '../services/queryKeys'
import type { Project, Chapter, Segment } from '../services/api'

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

      // Optimistically update
      if (previousProjects) {
        const reorderedProjects = projectIds
          .map(id => previousProjects.find(p => p.id === id))
          .filter((p): p is Project => p !== undefined)
          .map((p, index) => ({ ...p, orderIndex: index }))

        queryClient.setQueryData(queryKeys.projects.lists(), reorderedProjects)
      }

      return { previousProjects }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.lists(), context.previousProjects)
      }
    },
    // NOTE: No onSettled refetch - optimistic update is already correct on success, rollback handles errors
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

      // Optimistically update project detail
      if (previousProject) {
        const reorderedChapters = chapterIds
          .map(id => previousProject.chapters.find((c: any) => c.id === id))
          .filter((c): c is Chapter => c !== undefined)
          .map((c, index) => ({ ...c, orderIndex: index }))

        queryClient.setQueryData(queryKeys.projects.detail(projectId), {
          ...previousProject,
          chapters: reorderedChapters,
        })
      }

      // Optimistically update projects list (used by AppLayout)
      if (previousProjects) {
        const reorderedChapters = chapterIds
          .map(id => previousProjects.find(p => p.id === projectId)?.chapters.find((c: any) => c.id === id))
          .filter((c): c is Chapter => c !== undefined)
          .map((c, index) => ({ ...c, orderIndex: index }))

        const updatedProjects = previousProjects.map(p =>
          p.id === projectId
            ? { ...p, chapters: reorderedChapters }
            : p
        )

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

      // Optimistically update chapter detail
      if (previousChapter) {
        const reorderedSegments = segmentIds
          .map(id => previousChapter.segments.find((s: any) => s.id === id))
          .filter((s): s is Segment => s !== undefined)
          .map((s, index) => ({ ...s, orderIndex: index }))

        queryClient.setQueryData(queryKeys.chapters.detail(chapterId), {
          ...previousChapter,
          segments: reorderedSegments,
        })
      }

      // Optimistically update projects list (segments are nested: projects → chapters → segments)
      if (previousProjects) {
        const updatedProjects = previousProjects.map(project => {
          const chapter = project.chapters.find((c: any) => c.id === chapterId)
          if (!chapter) return project

          const reorderedSegments = segmentIds
            .map(id => chapter.segments.find((s: any) => s.id === id))
            .filter((s): s is Segment => s !== undefined)
            .map((s, index) => ({ ...s, orderIndex: index }))

          return {
            ...project,
            chapters: project.chapters.map((c: any) =>
              c.id === chapterId
                ? { ...c, segments: reorderedSegments }
                : c
            ),
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

/**
 * Move segment to different chapter
 */
export function useMoveSegment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      segmentId,
      newChapterId,
      newOrderIndex,
    }: {
      segmentId: string
      newChapterId: string
      newOrderIndex: number
    }) => segmentApi.move(segmentId, newChapterId, newOrderIndex),
    onSuccess: (updatedSegment, variables) => {
      // Invalidate both source and target chapters
      queryClient.invalidateQueries({ queryKey: queryKeys.chapters.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.segments.detail(variables.segmentId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.chapters.detail(updatedSegment.chapterId) })
    },
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
