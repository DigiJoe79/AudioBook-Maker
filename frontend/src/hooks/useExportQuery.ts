/**
 * React Query hooks for audio export functionality
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { exportApi, type ExportRequest, type ExportProgress } from '../services/api'
import { queryKeys } from '../services/queryKeys'
import { useSSEConnection } from '@/contexts/SSEContext'
import { logger } from '../utils/logger'

/**
 * Hook to start an export job
 */
export function useStartExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: exportApi.startExport,
    onSuccess: (data) => {
      // Store job ID for progress tracking
      queryClient.setQueryData(queryKeys.export.job(data.jobId), data)
    },
    onError: (error: Error) => {
      logger.error('[useStartExport] Export failed to start:', error)
    },
  })
}

/**
 * Hook to get export progress with automatic polling
 * Automatically polls while export is running and stops when completed/failed
 */
export function useExportProgress(jobId: string | null, enabled = false) {
  const [isPolling, setIsPolling] = useState(enabled)
  const queryClient = useQueryClient()
  const pollingIntervalRef = useRef<number | null>(null)

  // Check if SSE is active
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse'

  // Query for export progress
  const query = useQuery({
    queryKey: queryKeys.export.progress(jobId ?? ''),
    queryFn: () => {
      if (!jobId) throw new Error('No job ID')
      return exportApi.getExportProgress(jobId)
    },
    enabled: enabled && !!jobId,
    // Disable polling when SSE active, use 1s fallback otherwise
    refetchInterval: isSSEActive ? false : (isPolling ? 1000 : false),
    retry: false,
    // Increase staleTime when SSE active (events update cache)
    staleTime: isSSEActive ? Infinity : 0,
  })

  // Handle polling lifecycle
  useEffect(() => {
    if (!enabled || !jobId) {
      setIsPolling(false)
      return
    }

    // Check if job is complete
    const status = query.data?.status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setIsPolling(false)

      // Invalidate chapter to show updated segments
      if (status === 'completed') {
        // Could invalidate related queries here if needed
      }
    } else if (status === 'running' || status === 'pending') {
      setIsPolling(true)
    }
  }, [enabled, jobId, query.data?.status])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  // Manual start/stop polling controls
  const startPolling = () => {
    if (jobId && enabled) {
      setIsPolling(true)
    }
  }

  const stopPolling = () => {
    setIsPolling(false)
  }

  return {
    ...query,
    isPolling,
    startPolling,
    stopPolling,
  }
}

/**
 * Hook to cancel an export job
 */
export function useCancelExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: exportApi.cancelExport,
    onSuccess: (_, jobId) => {
      // Update the job status in cache
      queryClient.setQueryData(
        queryKeys.export.progress(jobId),
        (old: ExportProgress | undefined) => {
          if (!old) return old
          return {
            ...old,
            status: 'cancelled' as const,
            message: 'Export cancelled by user',
          }
        }
      )
    },
  })
}

/**
 * Hook to trigger file download
 */
export function useDownloadExport() {
  return {
    download: async (jobId: string, defaultFilename: string): Promise<string | null> => {
      return await exportApi.downloadExport(jobId, defaultFilename)
    },
  }
}

/**
 * Hook for quick segment merging (preview)
 */
export function useMergeSegments() {
  return useMutation({
    mutationFn: ({ chapterId, pauseMs }: { chapterId: string; pauseMs?: number }) =>
      exportApi.mergeSegments(chapterId, pauseMs),
  })
}

/**
 * Combined hook for complete export workflow
 */
export function useExportWorkflow(chapterId: string) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const startExport = useStartExport()
  const progress = useExportProgress(jobId, isExporting)
  const cancelExport = useCancelExport()
  const downloadExport = useDownloadExport()

  const handleStartExport = async (request: Omit<ExportRequest, 'chapterId'>) => {
    try {
      setIsExporting(true)
      const result = await startExport.mutateAsync({
        ...request,
        chapterId,
      })
      setJobId(result.jobId)
      return result
    } catch (error) {
      setIsExporting(false)
      throw error
    }
  }

  const handleCancelExport = async () => {
    if (!jobId) return
    await cancelExport.mutateAsync(jobId)
    setIsExporting(false)
  }

  const handleDownload = async (defaultFilename: string): Promise<string | null> => {
    if (!jobId) return null
    return await downloadExport.download(jobId, defaultFilename)
  }

  // Reset when export completes
  useEffect(() => {
    const status = progress.data?.status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setIsExporting(false)
    }
  }, [progress.data?.status])

  return {
    jobId,
    isExporting,
    progress: progress.data,
    isLoading: progress.isLoading,
    error: progress.error,
    startExport: handleStartExport,
    cancelExport: handleCancelExport,
    downloadExport: handleDownload,
    resetExport: () => {
      setJobId(null)
      setIsExporting(false)
    },
  }
}