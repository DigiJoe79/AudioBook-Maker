/**
 * Speaker Query Hooks
 *
 * React Query hooks for speaker data fetching and management.
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'
import { getDefaultSpeaker } from '@services/settingsApi'

/**
 * Hook to fetch the default speaker from the speakers table.
 * The speakers table (is_default flag) is the single source of truth for the default speaker.
 */
export function useDefaultSpeaker() {
  return useQuery({
    queryKey: queryKeys.speakers.default(),
    queryFn: getDefaultSpeaker,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}