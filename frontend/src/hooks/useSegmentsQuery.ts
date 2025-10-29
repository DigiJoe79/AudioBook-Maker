
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

const transformSegment = (apiSegment: ApiSegment): Segment => {
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
    id: apiSegment.id,
    chapterId: apiSegment.chapterId,
    text: apiSegment.text,
    audioPath: apiSegment.audioPath || undefined,
    orderIndex: apiSegment.orderIndex,
    startTime: apiSegment.startTime,
    endTime: apiSegment.endTime,
    engine: apiSegment.engine,
    modelName: apiSegment.modelName,
    speakerName: apiSegment.speakerName,
    language: apiSegment.language,
    segmentType: apiSegment.segmentType,
    pauseDuration: apiSegment.pauseDuration,
    status: mapStatus(apiSegment.status),
    createdAt: new Date(apiSegment.createdAt),
    updatedAt: new Date(apiSegment.updatedAt),
  }
}

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
    onSuccess: (updatedSegment, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })

      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })

      queryClient.setQueryData(
        queryKeys.segments.detail(variables.segmentId),
        updatedSegment
      )
    },
  })
}

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
      await queryClient.cancelQueries({
        queryKey: queryKeys.chapters.detail(chapterId),
      })

      const previousChapter = queryClient.getQueryData(
        queryKeys.chapters.detail(chapterId)
      )

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
      if (context?.previousChapter) {
        queryClient.setQueryData(
          queryKeys.chapters.detail(context.chapterId),
          context.previousChapter
        )
      }
    },
    onSuccess: (_, variables) => {
      queryClient.removeQueries({
        queryKey: queryKeys.segments.detail(variables.segmentId),
      })

      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
    },
  })
}
