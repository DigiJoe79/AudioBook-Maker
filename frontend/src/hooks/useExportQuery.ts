
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { exportApi, type ExportRequest, type ExportProgress } from '../services/api'
import { queryKeys } from '../services/queryKeys'

export function useStartExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: exportApi.startExport,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.export.job(data.jobId), data)
    },
    onError: (error: Error) => {
      console.error('Export failed to start:', error)
    },
  })
}

export function useExportProgress(jobId: string | null, enabled = false) {
  const [isPolling, setIsPolling] = useState(enabled)
  const queryClient = useQueryClient()
  const pollingIntervalRef = useRef<number | null>(null)

  const query = useQuery({
    queryKey: queryKeys.export.progress(jobId ?? ''),
    queryFn: () => {
      if (!jobId) throw new Error('No job ID')
      return exportApi.getExportProgress(jobId)
    },
    enabled: enabled && !!jobId,
    refetchInterval: isPolling ? 1000 : false,
    retry: false,
  })

  useEffect(() => {
    if (!enabled || !jobId) {
      setIsPolling(false)
      return
    }

    const status = query.data?.status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setIsPolling(false)

      if (status === 'completed') {
      }
    } else if (status === 'running' || status === 'pending') {
      setIsPolling(true)
    }
  }, [enabled, jobId, query.data?.status])

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

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

export function useCancelExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: exportApi.cancelExport,
    onSuccess: (_, jobId) => {
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

export function useDownloadExport() {
  return {
    download: async (jobId: string, defaultFilename: string): Promise<string | null> => {
      return await exportApi.downloadExport(jobId, defaultFilename)
    },
  }
}

export function useMergeSegments() {
  return useMutation({
    mutationFn: ({ chapterId, pauseMs }: { chapterId: string; pauseMs?: number }) =>
      exportApi.mergeSegments(chapterId, pauseMs),
  })
}

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