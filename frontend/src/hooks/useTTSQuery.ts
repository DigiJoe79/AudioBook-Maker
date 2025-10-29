
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
    staleTime: 30 * 60 * 1000,
  })
}

export function useTTSEngines(): UseQueryResult<TTSEngine[], Error> {
  return useQuery({
    queryKey: queryKeys.tts.engines(),
    queryFn: async () => {
      const result = await ttsApi.getEngines()
      return result.engines
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useTTSModels(engineType: string | null | undefined): UseQueryResult<TTSModel[], Error> {
  return useQuery({
    queryKey: queryKeys.tts.models(engineType || ''),
    queryFn: async () => {
      if (!engineType) throw new Error('Engine type is required')
      const result = await ttsApi.getEngineModels(engineType)
      return result.models
    },
    enabled: !!engineType,
    staleTime: 5 * 60 * 1000,
  })
}

export function useInitializeTTS(): UseMutationResult<
  {
    success: boolean
    message: string
    modelVersion: string
    device: string
  },
  Error,
  void
> {
  return useMutation({
    mutationFn: async () => {
      return await ttsApi.initialize()
    },
  })
}

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
      queryClient.setQueryData<any>(
        queryKeys.chapters.detail(chapterId),
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            segments: old.segments.map((s: any) =>
              s.id === segmentId ? { ...s, status: 'processing' } : s
            ),
          }
        }
      )
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      })
    },
    onError: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
    },
  })
}

export function useGenerateChapter(): UseMutationResult<
  {
    status: string
    chapterId: string
    message?: string
  },
  Error,
  {
    chapterId: string
    speaker: string
    language: string
    engine: string
    modelName: string
    forceRegenerate?: boolean
    options?: TTSOptions
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      chapterId: string
      speaker: string
      language: string
      engine: string
      modelName: string
      forceRegenerate?: boolean
      options?: TTSOptions
    }) => {
      return await ttsApi.generateChapter(data)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(variables.chapterId),
      })
    },
  })
}

export function useCancelChapterGeneration(): UseMutationResult<
  {
    status: string
    chapterId: string
  },
  Error,
  string
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (chapterId: string) => {
      return await ttsApi.cancelChapterGeneration(chapterId)
    },
    onSuccess: (_, chapterId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tts.progress(chapterId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(chapterId),
      })
    },
  })
}

export function useIsChapterGenerating(chapter: any | null | undefined): boolean {
  if (!chapter?.segments) return false
  return chapter.segments.some(
    (s: any) => s.status === 'processing'
  )
}
