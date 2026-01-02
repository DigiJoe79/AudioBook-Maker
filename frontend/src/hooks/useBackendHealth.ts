/**
 * useBackendHealth Hook
 *
 * Checks the health status of a backend server.
 * Supports optional polling for real-time status updates.
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'
import type { BackendHealthResponse } from '@types'

interface BackendHealthResult {
  /** Whether the backend is online and responding */
  isOnline: boolean

  /** Backend version string */
  version: string | null

  /** List of available TTS engines */
  ttsEngines: string[]

  /** Whether backend is currently busy with long-running operations */
  busy: boolean

  /** Number of active generation/export jobs */
  activeJobs: number

  /** Engine availability (for feature-gating) */
  hasTtsEngine: boolean
  hasTextEngine: boolean
  hasSttEngine: boolean

  /** Error object if health check failed */
  error: Error | null

  /** Whether the health check is currently loading */
  isLoading: boolean

  /** Function to manually trigger a health check */
  refetch: () => void
}

interface UseBackendHealthOptions {
  /** Enable automatic polling (default: false) */
  polling?: boolean

  /** Polling interval in milliseconds (default: 5000) */
  interval?: number

  /** Enable the query (default: true) */
  enabled?: boolean
}

/**
 * Check backend health
 *
 * @param backendUrl - Base URL of the backend (e.g., "http://127.0.0.1:8765")
 * @param options - Hook options (polling, interval, enabled)
 * @returns Backend health result
 *
 * @example
 * ```tsx
 * const { isOnline, version, engines } = useBackendHealth(
 *   'http://127.0.0.1:8765',
 *   { polling: true, interval: 5000 }
 * )
 * ```
 */
export function useBackendHealth(
  backendUrl: string | null,
  options: UseBackendHealthOptions = {}
): BackendHealthResult {
  const { polling = false, interval = 5000, enabled = true } = options

  const {
    data,
    error,
    isLoading,
    refetch,
    isError,
  } = useQuery({
    queryKey: queryKeys.health(),
    queryFn: async () => {
      if (!backendUrl) {
        throw new Error('No backend URL provided')
      }

      const response = await fetch(`${backendUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        // Short timeout to quickly detect offline backends
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`)
      }

      const json: BackendHealthResponse = await response.json()
      return json
    },
    enabled: enabled && !!backendUrl,
    retry: 1, // Only retry once on failure
    refetchInterval: polling ? interval : false,
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
    // Don't show stale data - IMPORTANT: This prevents using cached data after errors
    staleTime: 0,
    gcTime: 0, // Don't cache at all - always fresh data
  })

  // Backend is only online if:
  // 1. We have data AND
  // 2. The status is 'ok' AND
  // 3. There is NO current error AND
  // 4. Not currently loading (to avoid showing stale data during refetch)
  const isOnline = !isLoading && !isError && !!data && data.status === 'ok'

  return {
    isOnline,
    // Only return data if we're actually online
    version: isOnline ? (data?.version || null) : null,
    ttsEngines: isOnline ? (data?.ttsEngines || []) : [],
    busy: isOnline ? (data?.busy || false) : false,
    activeJobs: isOnline ? (data?.activeJobs || 0) : 0,
    hasTtsEngine: isOnline ? (data?.hasTtsEngine || false) : false,
    hasTextEngine: isOnline ? (data?.hasTextEngine || false) : false,
    hasSttEngine: isOnline ? (data?.hasSttEngine || false) : false,
    error: error as Error | null,
    isLoading,
    refetch,
  }
}
