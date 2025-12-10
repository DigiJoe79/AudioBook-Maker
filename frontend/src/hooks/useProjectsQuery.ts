/**
 * React Query Hooks for Projects
 *
 * These hooks replace the old useProjects hook with granular, optimized queries and mutations.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { projectApi } from '@services/api'
import { type Project, transformProjectWithChapters, type ApiProjectWithChapters } from '@types'
import { queryKeys } from '@services/queryKeys'

/**
 * Fetch all projects with their chapters and segments
 *
 * @example
 * ```tsx
 * const { data: projects, isLoading, error } = useProjectsList()
 * ```
 */
export function useProjectsList(): UseQueryResult<Project[], Error> {
  return useQuery({
    queryKey: queryKeys.projects.lists(),
    queryFn: async () => {
      const data = await projectApi.getAll() as ApiProjectWithChapters[]
      return data.map(transformProjectWithChapters)
    },
  })
}

/**
 * Fetch a single project by ID
 *
 * @example
 * ```tsx
 * const { data: project, isLoading } = useProject(projectId)
 * ```
 */
export function useProject(
  projectId: string | null
): UseQueryResult<Project, Error> {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId || ''),
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      const data = await projectApi.getById(projectId) as ApiProjectWithChapters
      return transformProjectWithChapters(data)
    },
    enabled: !!projectId,
  })
}

/**
 * Create a new project
 *
 * @example
 * ```tsx
 * const createProject = useCreateProject()
 *
 * await createProject.mutateAsync({
 *   title: 'My Audiobook',
 *   description: 'A great story'
 * })
 * ```
 */
export function useCreateProject(): UseMutationResult<
  Project,
  Error,
  { title: string; description?: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { title: string; description?: string }) => {
      const created = await projectApi.create(data) as ApiProjectWithChapters
      return transformProjectWithChapters(created)
    },
    onSuccess: (newProject) => {
      // Invalidate to refetch projects list with the new project
      // Backend is source of truth - may have set additional fields (timestamps, defaults, etc.)
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

/**
 * Update an existing project
 *
 * @example
 * ```tsx
 * const updateProject = useUpdateProject()
 *
 * await updateProject.mutateAsync({
 *   id: 'project-123',
 *   data: { title: 'Updated Title' }
 * })
 * ```
 */
export function useUpdateProject(): UseMutationResult<
  Project,
  Error,
  { id: string; data: { title?: string; description?: string } }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: { title?: string; description?: string }
    }) => {
      const updated = await projectApi.update(id, data) as ApiProjectWithChapters
      return transformProjectWithChapters(updated)
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData<Project[]>(
        queryKeys.projects.lists()
      )

      // Optimistically update
      queryClient.setQueryData<Project[]>(
        queryKeys.projects.lists(),
        (old) => {
          if (!old) return []
          return old.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...data,
                  updatedAt: new Date(),
                }
              : p
          )
        }
      )

      return { previousProjects }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(
          queryKeys.projects.lists(),
          context.previousProjects
        )
      }
    },
    // NOTE: No onSettled refetch - optimistic update is already correct on success, rollback handles errors
  })
}

/**
 * Delete a project
 *
 * @example
 * ```tsx
 * const deleteProject = useDeleteProject()
 *
 * await deleteProject.mutateAsync('project-123')
 * ```
 */
export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      await projectApi.delete(projectId)
    },
    onMutate: async (projectId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData<Project[]>(
        queryKeys.projects.lists()
      )

      // Optimistically remove
      queryClient.setQueryData<Project[]>(
        queryKeys.projects.lists(),
        (old) => {
          if (!old) return []
          return old.filter((p) => p.id !== projectId)
        }
      )

      return { previousProjects }
    },
    onError: (_err, _projectId, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(
          queryKeys.projects.lists(),
          context.previousProjects
        )
      }
    },
    // NOTE: No onSettled refetch - optimistic update is already correct on success, rollback handles errors
  })
}
