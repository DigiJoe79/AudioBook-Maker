
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { chapterApi, type ApiChapter } from '../services/api'
import { type Chapter, type Segment } from '../types'
import { queryKeys } from '../services/queryKeys'

const transformChapter = (apiChapter: ApiChapter): Chapter => {
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
    id: apiChapter.id,
    projectId: apiChapter.projectId,
    title: apiChapter.title,
    orderIndex: apiChapter.orderIndex,
    defaultEngine: apiChapter.defaultEngine,
    defaultModelName: apiChapter.defaultModelName,
    createdAt: new Date(apiChapter.createdAt),
    updatedAt: new Date(apiChapter.updatedAt),
    segments: (apiChapter.segments || []).map((segment: any) => ({
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
  }
}

export function useChapter(
  chapterId: string | null | undefined,
  options?: {
    forcePolling?: boolean
    pollingInterval?: number
    pollingTimeout?: number
  }
): UseQueryResult<Chapter, Error> {
  const { forcePolling = false, pollingInterval = 1000, pollingTimeout = 60000 } = options || {}

  const pollingStartTimeRef = { current: null as number | null }

  return useQuery({
    queryKey: queryKeys.chapters.detail(chapterId || ''),
    queryFn: async () => {
      if (!chapterId) throw new Error('Chapter ID is required')
      const data = await chapterApi.getById(chapterId)
      return transformChapter(data)
    },
    enabled: !!chapterId,
    refetchInterval: (query) => {
      const chapter = query.state.data

      if (forcePolling) {
        if (!pollingStartTimeRef.current) {
          pollingStartTimeRef.current = Date.now()
        }

        const elapsed = Date.now() - pollingStartTimeRef.current
        if (elapsed > pollingTimeout) {
          console.log('[useChapter] Force polling timeout reached, stopping')
          pollingStartTimeRef.current = null
          return false
        }

        return pollingInterval
      }

      pollingStartTimeRef.current = null

      if (!chapter?.segments) return false
      const hasProcessingSegments = chapter.segments.some((s) => s.status === 'processing')
      return hasProcessingSegments ? pollingInterval : false
    },
  })
}

export function useCreateChapter(): UseMutationResult<
  Chapter,
  Error,
  { projectId: string; title: string; orderIndex: number; defaultEngine: string; defaultModelName: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      projectId: string
      title: string
      orderIndex: number
      defaultEngine: string
      defaultModelName: string
    }) => {
      const created = await chapterApi.create(data)
      return transformChapter(created)
    },
    onSuccess: (newChapter, variables) => {
      queryClient.setQueryData(
        queryKeys.chapters.detail(newChapter.id),
        newChapter
      )

      queryClient.setQueryData(
        queryKeys.projects.lists(),
        (oldProjects: any) => {
          if (!oldProjects) return oldProjects
          return oldProjects.map((project: any) => {
            if (project.id === variables.projectId) {
              return {
                ...project,
                chapters: [...(project.chapters || []), newChapter]
              }
            }
            return project
          })
        }
      )

      queryClient.setQueryData(
        queryKeys.projects.detail(variables.projectId),
        (oldProject: any) => {
          if (!oldProject) return oldProject
          return {
            ...oldProject,
            chapters: [...(oldProject.chapters || []), newChapter]
          }
        }
      )

      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

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
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.chapters.detail(id),
      })

      const previousChapter = queryClient.getQueryData<Chapter>(
        queryKeys.chapters.detail(id)
      )

      queryClient.setQueryData<Chapter>(
        queryKeys.chapters.detail(id),
        (old) => {
          if (!old) return old
          return {
            ...old,
            ...data,
            updatedAt: new Date(),
          }
        }
      )

      return { previousChapter }
    },
    onError: (_err, variables, context) => {
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(variables.id),
          context.previousChapter
        )
      }
    },
    onSuccess: (updatedChapter) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(updatedChapter.projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

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

      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
  })
}

export function useSegmentText(): UseMutationResult<
  {
    success: boolean
    message: string
    segments: Segment[]
    preview?: Array<{ text: string; orderIndex: number }>
    segmentCount: number
    engine: string
    constraints: Record<string, number>
  },
  Error,
  {
    chapterId: string
    text: string
    options?: {
      method?: 'sentences' | 'paragraphs' | 'smart' | 'length'
      language?: string
      engine?: string
      modelName?: string
      speakerName?: string
      minLength?: number
      maxLength?: number
      autoCreate?: boolean
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
        method?: 'sentences' | 'paragraphs' | 'smart' | 'length'
        language?: string
        engine?: string
        modelName?: string
        speakerName?: string
        minLength?: number
        maxLength?: number
        autoCreate?: boolean
      }
    }) => {
      return await chapterApi.segmentText(chapterId, {
        text,
        ...options,
      })
    },
    onSuccess: (_, variables) => {
      if (variables.options?.autoCreate) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.chapters.detail(variables.chapterId),
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.lists(),
        })
      }
    },
  })
}
