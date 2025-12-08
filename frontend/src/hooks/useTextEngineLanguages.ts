/**
 * Hook to get available languages for the configured text engine
 *
 * Uses the generic engines status endpoint and i18n for display names.
 * No spaCy-specific code.
 */
import { useMemo } from 'react'
import { useAllEnginesStatus } from './useEnginesQuery'
import { useAppStore } from '@store/appStore'

export function useTextEngineLanguages() {
  const { data: enginesStatus, isLoading, error } = useAllEnginesStatus()
  const getDefaultTextEngine = useAppStore((state) => state.getDefaultTextEngine)

  const result = useMemo(() => {
    const defaultEngine = getDefaultTextEngine()

    if (!enginesStatus?.text || !defaultEngine) {
      return {
        languages: [] as string[],
        engineName: defaultEngine ?? '',
        engineFound: false
      }
    }

    const textEngine = enginesStatus.text.find(e => e.name === defaultEngine)

    if (!textEngine) {
      return {
        languages: [] as string[],
        engineName: defaultEngine,
        engineFound: false
      }
    }

    return {
      languages: textEngine.supportedLanguages || [],
      engineName: defaultEngine,
      engineFound: true
    }
  }, [enginesStatus, getDefaultTextEngine])

  return {
    ...result,
    isLoading,
    error
  }
}
