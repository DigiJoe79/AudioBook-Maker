
import { useQuery } from '@tanstack/react-query'
import type { BackendHealthResponse } from '../types/backend'

export interface BackendHealthResult {
  isOnline: boolean

  version: string | null

  ttsEngines: string[]

  busy: boolean

  activeJobs: number

  error: Error | null

  isLoading: boolean

  refetch: () => void
}

interface UseBackendHealthOptions {
  polling?: boolean

  interval?: number

  enabled?: boolean
}

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
    queryKey: ['backend-health', backendUrl],
    queryFn: async () => {
      if (!backendUrl) {
        throw new Error('No backend URL provided')
      }

      const response = await fetch(`${backendUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`)
      }

      const json: BackendHealthResponse = await response.json()
      return json
    },
    enabled: enabled && !!backendUrl,
    retry: 1,
    refetchInterval: polling ? interval : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
  })

  const isOnline = !isLoading && !isError && !!data && data.status === 'ok'

  return {
    isOnline,
    version: isOnline ? (data?.version || null) : null,
    ttsEngines: isOnline ? (data?.ttsEngines || []) : [],
    busy: isOnline ? (data?.busy || false) : false,
    activeJobs: isOnline ? (data?.activeJobs || 0) : 0,
    error: error as Error | null,
    isLoading,
    refetch,
  }
}
