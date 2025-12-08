/**
 * SSE Export Event Handlers
 *
 * Handles real-time SSE events for audio export operations.
 * Updates React Query cache for instant UI feedback without polling.
 *
 * Event Types Handled:
 * - export.started - Export job started processing
 * - export.progress - Export progress update
 * - export.completed - Export finished successfully
 * - export.failed - Export failed with error
 * - export.cancelled - Export cancelled by user
 */

import { useCallback } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'
import type {
  ExportJobStartedData,
  ExportJobProgressData,
  ExportJobCompletedData,
  ExportJobFailedData,
} from '@/types/sseEvents'
import { logger } from '@utils/logger'

// ============================================================================
// Additional Local Types (backwards compatible)
// ============================================================================

/**
 * Generic export progress data (backwards compatible with old event structure)
 * Supports all properties from Export SSE event types
 */
interface ExportProgressData {
  exportId: string
  jobId?: string
  status?: 'running' | 'completed' | 'failed'
  progress?: number
  error?: string
  outputPath?: string
  message?: string
  currentSegment?: number
  totalSegments?: number
  fileSize?: number
  duration?: number
}

/**
 * Export job data stored in React Query cache
 */
interface ExportJobCacheData {
  exportId?: string
  jobId?: string
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  error?: string
  outputPath?: string
  message?: string
  currentSegment?: number
  totalSegments?: number
  fileSize?: number
  duration?: number
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle export.started event
 * Action: Update export job in cache
 */
function handleExportStarted(data: ExportProgressData, queryClient: QueryClient) {
  try {
    const jobId = data.jobId || data.exportId

    logger.group('📡 SSE Event', 'Export started', {
      'Export ID': jobId,
      'Status': 'running',
      'Event Type': 'export.started'
    }, '#2196F3')

    // Update export job query
    queryClient.setQueryData(
      queryKeys.export.job(jobId),
      (oldJob: { status?: string; progress?: number } | undefined) => {
        if (!oldJob) return oldJob
        return {
          ...oldJob,
          status: 'running',
          progress: data.progress ?? 0,
        }
      }
    )

    // Also invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.started event', {
      exportId: data.jobId || data.exportId,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(data.jobId || data.exportId)
    })
  }
}

/**
 * Handle export.progress event
 * Action: Update export job progress in cache
 */
function handleExportProgress(data: ExportProgressData, queryClient: QueryClient) {
  try {
    const jobId = data.jobId || data.exportId

    // Use debug for frequent progress events to reduce log noise
    logger.debug('[SSE] Export progress:', jobId, data.progress ?? 0, '%')

    const updateData = (oldData: ExportJobCacheData | undefined): ExportJobCacheData | undefined => {
      if (!oldData) return oldData
      return {
        ...oldData,
        status: data.status,
        progress: data.progress ?? oldData.progress,
        message: data.message,
        currentSegment: data.currentSegment,
        totalSegments: data.totalSegments,
      }
    }

    // Update BOTH query keys (export.job AND export.progress)
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.job(jobId), updateData)
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.progress(jobId), updateData)
  } catch (error) {
    logger.error('[SSE] Failed to handle export.progress event', {
      exportId: data.jobId || data.exportId,
      progress: data.progress,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    const jobId = data.jobId || data.exportId
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId)
    })
  }
}

/**
 * Handle export.completed event
 * Action: Update export job status + invalidate
 */
function handleExportCompleted(data: ExportProgressData, queryClient: QueryClient) {
  try {
    const jobId = data.jobId || data.exportId

    logger.group('📡 SSE Event', 'Export completed', {
      'Export ID': jobId,
      'Output Path': data.outputPath ?? 'unknown',
      'File Size': data.fileSize ?? 'unknown',
      'Event Type': 'export.completed'
    }, '#4CAF50')

    const updateData = (oldData: ExportJobCacheData | undefined): ExportJobCacheData | undefined => {
      if (!oldData) return oldData
      return {
        ...oldData,
        status: 'completed',
        progress: 1.0,
        message: data.message || 'Export completed',
        outputPath: data.outputPath,
        fileSize: data.fileSize,
        duration: data.duration,
      }
    }

    // Update BOTH query keys
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.job(jobId), updateData)
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.progress(jobId), updateData)

    // Invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId),
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.completed event', {
      exportId: data.jobId || data.exportId,
      outputPath: data.outputPath,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    const jobId = data.jobId || data.exportId
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId)
    })
  }
}

/**
 * Handle export.failed event
 * Action: Update export job status with error
 */
function handleExportFailed(data: ExportProgressData, queryClient: QueryClient) {
  try {
    const jobId = data.jobId || data.exportId

    logger.group('📡 SSE Event', 'Export failed', {
      'Export ID': jobId,
      'Error': data.error ?? 'Unknown error',
      'Event Type': 'export.failed'
    }, '#F44336')

    const updateData = (oldData: ExportJobCacheData | undefined): ExportJobCacheData | undefined => {
      if (!oldData) return oldData
      return {
        ...oldData,
        status: 'failed',
        error: data.error,
        message: data.message || 'Export failed',
      }
    }

    // Update BOTH query keys
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.job(jobId), updateData)
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.progress(jobId), updateData)

    // Invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId),
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.failed event', {
      exportId: data.jobId || data.exportId,
      exportError: data.error,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    const jobId = data.jobId || data.exportId
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId)
    })
  }
}

/**
 * Handle export.cancelled event
 * Action: Update export job status to cancelled
 */
function handleExportCancelled(data: ExportProgressData, queryClient: QueryClient) {
  try {
    const jobId = data.jobId || data.exportId

    logger.group('📡 SSE Event', 'Export cancelled', {
      'Export ID': jobId,
      'Event Type': 'export.cancelled'
    }, '#FF9800')

    const updateData = (oldData: ExportJobCacheData | undefined): ExportJobCacheData | undefined => {
      if (!oldData) return oldData
      return {
        ...oldData,
        status: 'cancelled',
        progress: 0.0,
        message: data.message || 'Export cancelled by user',
      }
    }

    // Update BOTH query keys
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.job(jobId), updateData)
    queryClient.setQueryData<ExportJobCacheData>(queryKeys.export.progress(jobId), updateData)

    // Invalidate to ensure fresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId),
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId),
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle export.cancelled event', {
      exportId: data.jobId || data.exportId,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate to force refetch
    const jobId = data.jobId || data.exportId
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.job(jobId)
    })
    queryClient.invalidateQueries({
      queryKey: queryKeys.export.progress(jobId)
    })
  }
}

// ============================================================================
// Export Hook
// ============================================================================

/**
 * Hook: Export SSE Event Handlers
 *
 * Returns stable handler functions for Export-related SSE events.
 * These handlers update React Query cache for instant UI feedback.
 *
 * @returns Object with handler functions for each Export event type
 */
export function useSSEExportHandlers() {
  const queryClient = useQueryClient()

  // Stabilize handlers with useCallback to prevent unnecessary re-subscriptions
  const handlers = {
    handleExportStarted: useCallback(
      (data: ExportProgressData) => handleExportStarted(data, queryClient),
      [queryClient]
    ),

    handleExportProgress: useCallback(
      (data: ExportProgressData) => handleExportProgress(data, queryClient),
      [queryClient]
    ),

    handleExportCompleted: useCallback(
      (data: ExportProgressData) => handleExportCompleted(data, queryClient),
      [queryClient]
    ),

    handleExportFailed: useCallback(
      (data: ExportProgressData) => handleExportFailed(data, queryClient),
      [queryClient]
    ),

    handleExportCancelled: useCallback(
      (data: ExportProgressData) => handleExportCancelled(data, queryClient),
      [queryClient]
    ),
  }

  return handlers
}
