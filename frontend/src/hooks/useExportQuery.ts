/**
 * React Query hooks for audio export functionality
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { exportApi, type ExportRequest, type ExportProgress } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import { useSSEConnection } from '@contexts/SSEContext'
import { logger } from '@utils/logger'

/**
 * Hook to start an export job (internal helper for useExportWorkflow)
 */
function useStartExport() {
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
 * Hook to get export progress with automatic polling (internal helper for useExportWorkflow)
 * Automatically polls while export is running and stops when completed/failed
 */
function useExportProgress(jobId: string | null, enabled = false) {
  const [isPolling, setIsPolling] = useState(enabled)
  const queryClient = useQueryClient()
  const pollingIntervalRef = useRef<number | null>(null)

  // Check if SSE is active
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse'

  // Query for export progress
  const query = useQuery({
    queryKey: queryKeys.export.progress(jobId ?? ''),
    queryFn: async () => {
      if (!jobId) throw new Error('No job ID')
      return await exportApi.getExportProgress(jobId)
    },
    enabled: enabled && !!jobId,
    // FIX: Always poll when enabled, stop when completed/failed (handled by effect below)
    refetchInterval: (query) => {
      // Stop polling if job is done
      if (query.state.data?.status === 'completed' || query.state.data?.status === 'failed' || query.state.data?.status === 'cancelled') {
        return false
      }
      // Poll every 500ms while running
      return 500
    },
    retry: false,
    staleTime: 0,
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
 * Hook to cancel an export job (internal helper for useExportWorkflow)
 */
function useCancelExport() {
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
    onError: (error: Error) => {
      logger.error('[useCancelExport] Failed to cancel export', { error: error.message })
    },
  })
}

/**
 * Hook to trigger file download (internal helper for useExportWorkflow)
 */
function useDownloadExport() {
  return {
    download: async (jobId: string, defaultFilename: string): Promise<string | null> => {
      return await exportApi.downloadExport(jobId, defaultFilename)
    },
  }
}

/**
 * Combined hook for complete export workflow
 */
export function useExportWorkflow(chapterId: string) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)  // FIX BUG 1: Track reset state
  const queryClient = useQueryClient()

  const startExport = useStartExport()
  const progress = useExportProgress(jobId, isExporting)
  const cancelExport = useCancelExport()
  const downloadExport = useDownloadExport()

  const handleStartExport = async (request: Omit<ExportRequest, 'chapterId'>) => {
    try {
      // FIX BUG 1: Set resetting flag to prevent showing old data
      setIsResetting(true)

      // Step 1: Explicitly clear old data from cache
      if (jobId) {
        queryClient.setQueryData(queryKeys.export.progress(jobId), undefined)
        queryClient.setQueryData(queryKeys.export.job(jobId), undefined)
      }

      // Step 2: Reset state
      setJobId(null)
      setIsExporting(false)

      // Step 3: Force React to process state updates before continuing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Step 4: Start new export
      setIsExporting(true)
      const result = await startExport.mutateAsync({
        ...request,
        chapterId,
      })
      setJobId(result.jobId)

      // Clear resetting flag
      setIsResetting(false)

      return result
    } catch (error) {
      setIsExporting(false)
      setIsResetting(false)
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
    isResetting,  // FIX BUG 1: Export resetting state
    progress: progress.data,
    isLoading: progress.isLoading,
    error: progress.error,
    startExport: handleStartExport,
    cancelExport: handleCancelExport,
    downloadExport: handleDownload,
    resetExport: () => {
      // FIX BUG 1: Clear cache when resetting
      if (jobId) {
        queryClient.setQueryData(queryKeys.export.progress(jobId), undefined)
        queryClient.setQueryData(queryKeys.export.job(jobId), undefined)
      }
      setJobId(null)
      setIsExporting(false)
    },
  }
}