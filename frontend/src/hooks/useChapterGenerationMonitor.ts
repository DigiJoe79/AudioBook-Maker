import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { useAppStore } from '../store/appStore'
import { logger } from '../utils/logger'

export function useChapterGenerationMonitor() {
  const queryClient = useQueryClient()
  const intervalRef = useRef<number | null>(null)
  const activeGenerations = useAppStore((state) => state.activeGenerations)
  const stopGeneration = useAppStore((state) => state.stopGeneration)
  const lastProgressRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const hasActiveGeneration = activeGenerations.size > 0

    if (hasActiveGeneration) {
      if (!intervalRef.current) {
        logger.info('[GenerationMonitor] Starting fast polling for', activeGenerations.size, 'chapter(s)')

        queryClient.refetchQueries({
          queryKey: queryKeys.projects.lists(),
        })

        intervalRef.current = window.setInterval(async () => {
          try {
            const backendUrl = useAppStore.getState().connection.url
            if (!backendUrl) return

            const response = await fetch(`${backendUrl}/api/tts/generation-status`)
            if (!response.ok) return

            const statusData = await response.json() as {
              activeJobs: Record<string, {
                status: string
                progress: number
                total: number
                currentSegment?: string
                errors: number
                updatedAt: number
              }>
            }

            activeGenerations.forEach((chapterId) => {
              const jobStatus = statusData.activeJobs[chapterId]

              if (jobStatus) {
                const lastProgress = lastProgressRef.current.get(chapterId) || -1

                if (jobStatus.progress !== lastProgress) {
                  logger.debug(
                    `[GenerationMonitor] Progress update: ${chapterId} → ${jobStatus.progress}/${jobStatus.total}`
                  )
                  lastProgressRef.current.set(chapterId, jobStatus.progress)

                  queryClient.refetchQueries({
                    queryKey: queryKeys.projects.lists(),
                  })
                  queryClient.refetchQueries({
                    queryKey: queryKeys.chapters.detail(chapterId)
                  })
                }

                if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
                  logger.info(`[GenerationMonitor] Chapter ${chapterId} ${jobStatus.status}`)

                  queryClient.invalidateQueries({
                    queryKey: queryKeys.chapters.detail(chapterId)
                  })
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.projects.lists()
                  })

                  stopGeneration(chapterId)
                  lastProgressRef.current.delete(chapterId)
                }
              } else {
                const projectsData = queryClient.getQueryData(queryKeys.projects.lists()) as any[]
                if (projectsData) {
                  const chapter = projectsData
                    .flatMap(p => p.chapters || [])
                    .find(ch => ch.id === chapterId)

                  if (chapter) {
                    const audioSegments = chapter.segments?.filter((s: any) => s.segmentType !== 'divider') || []
                    const allDone = audioSegments.length > 0 && audioSegments.every(
                      (s: any) => s.status === 'completed' || s.status === 'failed'
                    )

                    if (allDone) {
                      logger.debug(`[GenerationMonitor] Chapter ${chapterId} verified completed`)
                      stopGeneration(chapterId)
                      lastProgressRef.current.delete(chapterId)
                    }
                  }
                }
              }
            })
          } catch (error) {
            logger.warn('[GenerationMonitor] Status poll error:', error)
          }
        }, 250)
      }
    } else {
      if (intervalRef.current) {
        logger.info('[GenerationMonitor] Stopping polling - all chapters completed')
        clearInterval(intervalRef.current)
        intervalRef.current = null
        lastProgressRef.current.clear()
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [activeGenerations, queryClient, stopGeneration])
}
