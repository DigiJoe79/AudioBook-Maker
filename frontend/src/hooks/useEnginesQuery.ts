/**
 * React Query hooks for Engine Management
 *
 * Hooks for fetching and managing engines across all types (TTS, Text, STT, Audio).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { engineApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type { AllEnginesStatus } from '@/types/engines'
import { logger } from '@utils/logger'

/**
 * Query: Get status of all engines grouped by type
 *
 * Returns engines grouped by type (TTS, Text, STT, Audio) with feature-gating summary.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useAllEnginesStatus()
 * if (data?.hasTextEngine) {
 *   // Text engine available
 * }
 * ```
 */
export function useAllEnginesStatus() {
  return useQuery<AllEnginesStatus>({
    queryKey: queryKeys.engines.all(),
    queryFn: engineApi.getAllStatus,
    staleTime: 10_000, // 10s cache (engines don't change often)
    refetchOnWindowFocus: true,
  })
}

/**
 * Mutation: Enable an engine
 *
 * @example
 * ```tsx
 * const enableMutation = useEnableEngine()
 * await enableMutation.mutateAsync({
 *   engineType: 'text',
 *   engineName: 'spacy'
 * })
 * ```
 */
export function useEnableEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType, engineName }: { engineType: string; engineName: string }) =>
      engineApi.enableEngine(engineType, engineName),
    onSuccess: () => {
      // Invalidate engines query to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      // Also invalidate health query (updates feature-gating)
      queryClient.invalidateQueries({ queryKey: queryKeys.health() })
    },
    onError: (error: Error) => {
      logger.error('[useEnableEngine] Failed to enable engine', { error: error.message })
    },
  })
}

/**
 * Mutation: Disable an engine
 *
 * @example
 * ```tsx
 * const disableMutation = useDisableEngine()
 * await disableMutation.mutateAsync({
 *   engineType: 'stt',
 *   engineName: 'whisper'
 * })
 * ```
 */
export function useDisableEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType, engineName }: { engineType: string; engineName: string }) =>
      engineApi.disableEngine(engineType, engineName),
    onSuccess: () => {
      // Invalidate engines query to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      // Also invalidate health query (updates feature-gating)
      queryClient.invalidateQueries({ queryKey: queryKeys.health() })
    },
    onError: (error: Error) => {
      logger.error('[useDisableEngine] Failed to disable engine', { error: error.message })
    },
  })
}

/**
 * Mutation: Start an engine
 *
 * @example
 * ```tsx
 * const startMutation = useStartEngine()
 * await startMutation.mutateAsync({
 *   engineType: 'tts',
 *   engineName: 'xtts',
 *   modelName: 'v2.0.2'
 * })
 * ```
 */
export function useStartEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType, engineName, modelName }: {
      engineType: string;
      engineName: string;
      modelName?: string
    }) => engineApi.startEngine(engineType, engineName, modelName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
    },
    onError: (error: Error) => {
      logger.error('[useStartEngine] Failed to start engine', { error: error.message })
    },
  })
}

/**
 * Mutation: Stop an engine
 *
 * @example
 * ```tsx
 * const stopMutation = useStopEngine()
 * await stopMutation.mutateAsync({
 *   engineType: 'tts',
 *   engineName: 'xtts'
 * })
 * ```
 */
export function useStopEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType, engineName }: {
      engineType: string;
      engineName: string
    }) => engineApi.stopEngine(engineType, engineName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
    },
    onError: (error: Error) => {
      logger.error('[useStopEngine] Failed to stop engine', { error: error.message })
    },
  })
}

/**
 * Mutation: Set default engine for a type
 *
 * @example
 * ```tsx
 * const setDefaultMutation = useSetDefaultEngine()
 * await setDefaultMutation.mutateAsync({
 *   engineType: 'tts',
 *   engineName: 'xtts'
 * })
 * ```
 */
export function useSetDefaultEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType, engineName }: {
      engineType: string;
      engineName: string
    }) => engineApi.setDefaultEngine(engineType, engineName),
    onSuccess: () => {
      // Invalidate engines query to refetch (isDefault flags change)
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      // Also invalidate settings as default engine changed
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
    },
    onError: (error: Error) => {
      logger.error('[useSetDefaultEngine] Failed to set default engine', { error: error.message })
    },
  })
}

/**
 * Mutation: Clear default engine for a type (set to none)
 *
 * Note: TTS must always have a default engine, so this will fail for TTS.
 *
 * @example
 * ```tsx
 * const clearDefaultMutation = useClearDefaultEngine()
 * await clearDefaultMutation.mutateAsync({ engineType: 'stt' })
 * ```
 */
export function useClearDefaultEngine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ engineType }: { engineType: string }) =>
      engineApi.clearDefaultEngine(engineType),
    onSuccess: () => {
      // Invalidate engines query to refetch (isDefault flags change)
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      // Also invalidate settings as default engine changed
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
    },
    onError: (error: Error) => {
      logger.error('[useClearDefaultEngine] Failed to clear default engine', { error: error.message })
    },
  })
}
