
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { projectApi, type ApiProject } from '../services/api'
import { type Project } from '../types'
import { queryKeys } from '../services/queryKeys'

const transformProject = (apiProject: ApiProject): Project => {
  const mapStatus = (
    apiStatus: string
  ): 'pending' | 'processing' | 'completed' | 'failed' => {
    switch (apiStatus) {
      case 'processing':
        return 'processing'
      case 'failed':
        return 'failed'
      case 'completed':
        return 'completed'
      case 'pending':
      default:
        return 'pending'
    }
  }

  return {
    id: apiProject.id,
    title: apiProject.title,
    description: apiProject.description,
    orderIndex: apiProject.orderIndex,
    createdAt: new Date(apiProject.createdAt),
    updatedAt: new Date(apiProject.updatedAt),
    chapters: (apiProject.chapters || []).map((chapter: any) => ({
      id: chapter.id,
      projectId: chapter.projectId,
      title: chapter.title,
      orderIndex: chapter.orderIndex,
      defaultEngine: chapter.defaultEngine,
      defaultModelName: chapter.defaultModelName,
      createdAt: new Date(chapter.createdAt),
      updatedAt: new Date(chapter.updatedAt),
      segments: (chapter.segments || []).map((segment: any) => ({
        id: segment.id,
        chapterId: segment.chapterId,
        text: segment.text,
        audioPath: segment.audioPath || undefined,
        orderIndex: segment.orderIndex,
        startTime: segment.startTime,
        endTime: segment.endTime,
        engine: segment.engine,
        modelName: segment.modelName,
        speakerName: segment.speakerName,
        language: segment.language,
        segmentType: segment.segmentType,
        pauseDuration: segment.pauseDuration,
        status: mapStatus(segment.status),
        createdAt: new Date(segment.createdAt),
        updatedAt: new Date(segment.updatedAt),
      })),
    })),
  }
}

export function useProjectsList(): UseQueryResult<Project[], Error> {
  return useQuery({
    queryKey: queryKeys.projects.lists(),
    queryFn: async () => {
      const data = await projectApi.getAll()
      return data.map(transformProject)
    },
  })
}

export function useProject(
  projectId: string | null
): UseQueryResult<Project, Error> {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId || ''),
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      const data = await projectApi.getById(projectId)
      return transformProject(data)
    },
    enabled: !!projectId,
  })
}

export function useCreateProject(): UseMutationResult<
  Project,
  Error,
  { title: string; description?: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { title: string; description?: string }) => {
      const created = await projectApi.create(data)
      return transformProject(created)
    },
    onSuccess: (newProject) => {
      queryClient.setQueryData<Project[]>(
        queryKeys.projects.lists(),
        (old) => {
          if (!old) return [newProject]
          return [...old, newProject]
        }
      )

      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

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
      const updated = await projectApi.update(id, data)
      return transformProject(updated)
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      const previousProjects = queryClient.getQueryData<Project[]>(
        queryKeys.projects.lists()
      )

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
      if (context?.previousProjects) {
        queryClient.setQueryData(
          queryKeys.projects.lists(),
          context.previousProjects
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      await projectApi.delete(projectId)
    },
    onMutate: async (projectId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all })

      const previousProjects = queryClient.getQueryData<Project[]>(
        queryKeys.projects.lists()
      )

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
      if (context?.previousProjects) {
        queryClient.setQueryData(
          queryKeys.projects.lists(),
          context.previousProjects
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}
