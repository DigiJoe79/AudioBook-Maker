/**
 * SSE Event Handlers for Engine Status Updates
 *
 * Handles real-time engine status events:
 * - engine.status: Periodic status update with countdown timers (every 15s)
 * - engine.started: Engine server started
 * - engine.stopped: Engine server stopped
 * - engine.enabled: Engine enabled in settings
 * - engine.disabled: Engine disabled in settings
 *
 * Performance: Uses immer for O(1) cache updates instead of O(n) spread operations
 */

import { useCallback } from 'react'
import { useQueryClient, QueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'
import { useAppStore } from '@store/appStore'
import type { AllEnginesStatus, EngineType, EngineStatusInfo } from '@/types/engines'
import type {
  EngineStartedData,
  EngineStoppedData,
  EngineEnabledData,
  EngineStatusData,
  EngineErrorData,
} from '@/types/sseEvents'

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Handle engine.status event (periodic, every 15s)
 * Action: Update all engines status including countdown timers and feature flags
 */
function handleEngineStatus(
  data: EngineStatusData,
  queryClient: QueryClient,
  updateEngineAvailability: (data: { hasTtsEngine: boolean; hasTextEngine: boolean; hasSttEngine: boolean; hasAudioEngine: boolean }) => void
) {
  try {
    // Note: engine.status is sent every 15s - no logging to reduce noise

    // Update engines query cache - MERGE SSE data with existing rich data
    // SSE only sends: name, isEnabled, isRunning, status, secondsUntilAutoStop, port
    // Existing data has: displayName, version, device, supportedLanguages, etc.
    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        // Helper to merge SSE status into existing engine data using immer
        const mergeEngineList = (
          existingList: EngineStatusInfo[] | undefined,
          sseList: Array<{ name: string; isEnabled: boolean; isRunning: boolean; status: string; secondsUntilAutoStop?: number; port?: number }>
        ): EngineStatusInfo[] => {
          if (!existingList || existingList.length === 0) {
            // No existing data - use SSE data as-is (partial)
            return sseList as unknown as EngineStatusInfo[]
          }

          // Merge with immer: update status fields while preserving rich metadata
          return produce(existingList, draft => {
            for (const sseEngine of sseList) {
              const existing = draft.find(e => e.name === sseEngine.name)
              if (existing) {
                existing.isEnabled = sseEngine.isEnabled
                existing.isRunning = sseEngine.isRunning
                existing.status = sseEngine.status as EngineStatusInfo['status']
                existing.secondsUntilAutoStop = sseEngine.secondsUntilAutoStop
                existing.port = sseEngine.port
              }
            }
          })
        }

        // If no old data, DON'T set partial SSE data - let the API call populate full data
        // The API call will include all fields (device, displayName, supportedLanguages, etc.)
        // SSE events only update status fields, not create new entries
        if (!oldData) {
          return undefined  // Don't update cache, wait for API response
        }

        // Merge SSE status data with existing rich data
        return {
          ...oldData,
          success: true,
          tts: mergeEngineList(oldData.tts, data.engines.tts),
          text: mergeEngineList(oldData.text, data.engines.text),
          stt: mergeEngineList(oldData.stt, data.engines.stt),
          audio: mergeEngineList(oldData.audio, data.engines.audio),
          hasTtsEngine: data.hasTtsEngine,
          hasTextEngine: data.hasTextEngine,
          hasSttEngine: data.hasSttEngine,
        }
      }
    )

    // Update app store with engine availability flags
    updateEngineAvailability({
      hasTtsEngine: data.hasTtsEngine,
      hasTextEngine: data.hasTextEngine,
      hasSttEngine: data.hasSttEngine,
      hasAudioEngine: data.hasAudioEngine,
    })
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.status event', {
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query to force refetch
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.started event
 * Action: Update engine status to 'running' and set port number
 */
function handleEngineStarted(data: EngineStartedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine started: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Port': data.port,
      'Version': data.version || 'N/A',
      'Event Type': 'engine.started'
    }, '#4CAF50')

    // Update engines query cache with immer
    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.isRunning = true
            engine.status = 'running'
            engine.port = data.port
            if (data.version) {
              engine.version = data.version
            }
          }
        })
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.started event', {
      engineType: data.engineType,
      engineName: data.engineName,
      port: data.port,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.starting event
 * Action: Update engine status to 'starting'
 */
function handleEngineStarting(data: { engineType: EngineType; engineName: string }, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine starting: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Event Type': 'engine.starting'
    }, '#FF9800')

    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.status = 'starting'
          }
        })
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.starting event', {
      engineType: data.engineType,
      engineName: data.engineName,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.stopping event
 * Action: Update engine status to 'stopping'
 */
function handleEngineStopping(data: { engineType: EngineType; engineName: string; reason?: string }, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine stopping: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Reason': data.reason || 'manual',
      'Event Type': 'engine.stopping'
    }, '#FF9800')

    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.status = 'stopping'
          }
        })
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.stopping event', {
      engineType: data.engineType,
      engineName: data.engineName,
      reason: data.reason,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.stopped event
 * Action: Update engine status to 'stopped' and clear port
 */
function handleEngineStopped(data: EngineStoppedData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine stopped: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Reason': data.reason,
      'Event Type': 'engine.stopped'
    }, '#FF9800')

    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.isRunning = false
            engine.status = 'stopped'
            engine.port = undefined
          }
        })
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.stopped event', {
      engineType: data.engineType,
      engineName: data.engineName,
      reason: data.reason,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.error event
 * Action: Update engine status to 'error' and log the error
 */
function handleEngineError(data: EngineErrorData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine error: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Error': data.error,
      'Details': data.details || 'N/A',
      'Event Type': 'engine.error'
    }, '#F44336') // Red for error

    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.isRunning = false
            engine.status = 'error'
            engine.errorMessage = data.error
          }
        })
      }
    )
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.error event', {
      engineType: data.engineType,
      engineName: data.engineName,
      engineError: data.error,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

/**
 * Handle engine.enabled/engine.disabled event
 * Action: Update engine enabled state and feature-gating flags
 */
function handleEngineEnabled(data: EngineEnabledData, queryClient: QueryClient) {
  try {
    logger.group('📡 SSE Event', `Engine ${data.isEnabled ? 'enabled' : 'disabled'}: ${data.engineName}`, {
      'Engine Type': data.engineType,
      'Engine Name': data.engineName,
      'Is Enabled': data.isEnabled,
      'Event Type': data.isEnabled ? 'engine.enabled' : 'engine.disabled'
    }, data.isEnabled ? '#4CAF50' : '#FF9800')

    queryClient.setQueryData<AllEnginesStatus>(
      queryKeys.engines.all(),
      (oldData) => {
        if (!oldData) return oldData

        return produce(oldData, draft => {
          const engine = (draft[data.engineType] as EngineStatusInfo[]).find(e => e.name === data.engineName)
          if (engine) {
            engine.isEnabled = data.isEnabled
            engine.status = data.isEnabled ? (engine.isRunning ? 'running' : 'stopped') : 'disabled'
          }

          // Update feature-gating flags
          draft.hasTtsEngine = (draft.tts as EngineStatusInfo[]).some(e => e.isEnabled)
          draft.hasTextEngine = (draft.text as EngineStatusInfo[]).some(e => e.isEnabled)
          draft.hasSttEngine = (draft.stt as EngineStatusInfo[]).some(e => e.isEnabled)
          draft.hasAudioEngine = (draft.audio as EngineStatusInfo[]).some(e => e.isEnabled)
        })
      }
    )

    // Also invalidate health query for feature-gating update
    queryClient.invalidateQueries({ queryKey: queryKeys.health() })
  } catch (error) {
    logger.error('[SSE] Failed to handle engine.enabled/disabled event', {
      engineType: data.engineType,
      engineName: data.engineName,
      isEnabled: data.isEnabled,
      error: error instanceof Error ? error.message : String(error)
    })
    // Recovery: invalidate engines query
    queryClient.invalidateQueries({
      queryKey: queryKeys.engines.all()
    })
  }
}

// ============================================================================
// Exported Hook
// ============================================================================

/**
 * Hook: SSE Engine Event Handlers
 *
 * Provides handlers for engine status SSE events. All handlers use
 * useCallback for stable references to prevent SSE re-subscription loops.
 *
 * @returns Object containing engine event handlers
 */
export function useSSEEngineHandlers() {
  const queryClient = useQueryClient()
  const updateEngineAvailability = useAppStore((state) => state.updateEngineAvailability)

  return {
    handleEngineStatus: useCallback(
      (data: EngineStatusData) => handleEngineStatus(data, queryClient, updateEngineAvailability),
      [queryClient, updateEngineAvailability]
    ),
    handleEngineStarting: useCallback(
      (data: { engineType: EngineType; engineName: string }) => handleEngineStarting(data, queryClient),
      [queryClient]
    ),
    handleEngineStarted: useCallback(
      (data: EngineStartedData) => handleEngineStarted(data, queryClient),
      [queryClient]
    ),
    handleEngineStopping: useCallback(
      (data: { engineType: EngineType; engineName: string; reason?: string }) => handleEngineStopping(data, queryClient),
      [queryClient]
    ),
    handleEngineStopped: useCallback(
      (data: EngineStoppedData) => handleEngineStopped(data, queryClient),
      [queryClient]
    ),
    handleEngineEnabled: useCallback(
      (data: EngineEnabledData) => handleEngineEnabled(data, queryClient),
      [queryClient]
    ),
    handleEngineDisabled: useCallback(
      (data: EngineEnabledData) => handleEngineEnabled(data, queryClient),
      [queryClient]
    ),
    handleEngineError: useCallback(
      (data: EngineErrorData) => handleEngineError(data, queryClient),
      [queryClient]
    ),
  }
}
