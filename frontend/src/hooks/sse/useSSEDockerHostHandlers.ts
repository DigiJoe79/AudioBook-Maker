/**
 * SSE Event Handlers for Docker Host Status Updates
 *
 * Handles real-time Docker host connection events:
 * - docker.host.connected: Host connection established
 * - docker.host.disconnected: Host connection lost
 * - docker.host.connecting: Reconnection in progress
 *
 * Performance: Uses immer for O(1) cache updates
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'
import type { EngineHostsListResponse } from '@services/api'
import type {
  DockerHostConnectedData,
  DockerHostDisconnectedData,
  DockerHostConnectingData,
} from '@/types/sseEvents'

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Handle docker.host.connected event
 * Action: Update host isAvailable to true
 */
function handleDockerHostConnected(
  data: DockerHostConnectedData,
  queryClient: ReturnType<typeof useQueryClient>
) {
  logger.group('📡 SSE Event', `Docker host connected: ${data.hostId}`, {
    'Host ID': data.hostId,
    'Docker Version': data.dockerVersion,
    'OS': data.os,
    'GPU': data.hasGpu ? 'Yes' : 'No',
    'Event Type': 'docker.host.connected'
  }, '#4CAF50') // Green

  queryClient.setQueryData<EngineHostsListResponse>(
    queryKeys.engineHosts.all(),
    (oldData) => {
      if (!oldData) return oldData

      return produce(oldData, draft => {
        const host = draft.hosts.find(h => h.hostId === data.hostId)
        if (host) {
          host.isAvailable = true
          host.hasGpu = data.hasGpu
          host.lastCheckedAt = new Date().toISOString()
        }
      })
    }
  )
}

/**
 * Handle docker.host.disconnected event
 * Action: Update host isAvailable to false
 */
function handleDockerHostDisconnected(
  data: DockerHostDisconnectedData,
  queryClient: ReturnType<typeof useQueryClient>
) {
  logger.group('📡 SSE Event', `Docker host disconnected: ${data.hostId}`, {
    'Host ID': data.hostId,
    'Reason': data.reason,
    'Event Type': 'docker.host.disconnected'
  }, '#FF9800') // Orange

  queryClient.setQueryData<EngineHostsListResponse>(
    queryKeys.engineHosts.all(),
    (oldData) => {
      if (!oldData) return oldData

      return produce(oldData, draft => {
        const host = draft.hosts.find(h => h.hostId === data.hostId)
        if (host) {
          host.isAvailable = false
          host.lastCheckedAt = new Date().toISOString()
        }
      })
    }
  )
}

/**
 * Handle docker.host.connecting event
 * Action: Log the reconnection attempt (no cache update needed)
 */
function handleDockerHostConnecting(data: DockerHostConnectingData) {
  logger.debug('[SSE] Docker host reconnecting', {
    hostId: data.hostId,
    attempt: data.attempt
  })
  // No cache update - connecting state is transient
  // UI can show this based on consecutive disconnect/connect events
}

// ============================================================================
// Exported Hook
// ============================================================================

/**
 * Hook: SSE Docker Host Event Handlers
 *
 * Provides handlers for Docker host connection status SSE events.
 * All handlers use useCallback for stable references to prevent SSE re-subscription loops.
 *
 * @returns Object containing Docker host event handlers
 */
export function useSSEDockerHostHandlers() {
  const queryClient = useQueryClient()

  return {
    handleDockerHostConnected: useCallback(
      (data: DockerHostConnectedData) => handleDockerHostConnected(data, queryClient),
      [queryClient]
    ),
    handleDockerHostDisconnected: useCallback(
      (data: DockerHostDisconnectedData) => handleDockerHostDisconnected(data, queryClient),
      [queryClient]
    ),
    handleDockerHostConnecting: useCallback(
      (data: DockerHostConnectingData) => handleDockerHostConnecting(data),
      []
    ),
  }
}
