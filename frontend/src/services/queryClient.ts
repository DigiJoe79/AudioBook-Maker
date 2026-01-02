/**
 * Global QueryClient Instance
 *
 * Exported for use in Zustand stores and other non-React contexts
 * where hooks (useQueryClient) are not available.
 */

import { QueryClient, QueryCache } from '@tanstack/react-query'
import { logger } from '@utils/logger'

// Create QueryClient with sensible defaults
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Global error handler to ensure no query errors are completely silent
    onError: (error: Error) => {
      logger.error('[QueryClient] Query error:', { error: error.message })
    },
  }),
  defaultOptions: {
    queries: {
      // Stale time: How long data is considered fresh (default: 0 = always stale)
      staleTime: 0,
      // Cache time: How long unused data stays in cache (10 minutes)
      gcTime: 10 * 60 * 1000,
      // Retry failed requests 1 time
      retry: 1,
      // Refetch on window focus - disabled since SSE provides real-time updates
      refetchOnWindowFocus: false,
      // Refetch on mount if data is stale
      refetchOnMount: true,
    },
    mutations: {
      // Retry failed mutations 0 times by default
      retry: 0,
    },
  },
})
