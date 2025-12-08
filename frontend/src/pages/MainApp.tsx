/**
 * MainApp - Protected main application wrapper
 *
 * This component wraps the existing AppLayout and is only accessible
 * when a backend connection is established.
 *
 * Also includes the ConnectionLostOverlay for monitoring and handling
 * connection loss during app usage.
 *
 * IMPORTANT: SSEProvider is initialized here to ensure only ONE EventSource
 * connection is created for the entire app, preventing connection leaks.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import AppLayout from '@components/layout/AppLayout'
import { ConnectionLostOverlay } from '@components/overlays/ConnectionLostOverlay'
import { SSEProvider } from '@contexts/SSEContext'
import { AudioPlayerProvider } from '@contexts/AudioPlayerContext'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'

export default function MainApp() {
  const queryClient = useQueryClient()

  // Refetch engines on mount (initial connection or reconnection via StartPage)
  // This ensures engines list is always fresh after backend restart/reconnection
  useEffect(() => {
    logger.group(
      '🔌 MainApp Mount',
      'Fetching fresh engines data after connection',
      { action: 'refetch', target: 'engines' },
      '#2196F3'
    )

    // Refetch engines (ignore stale cache)
    queryClient.refetchQueries({
      queryKey: queryKeys.engines.all(),
      type: 'active'
    })
  }, [queryClient])

  return (
    <SSEProvider enabled={true}>
      <AudioPlayerProvider>
        <AppLayout />
        <ConnectionLostOverlay />
      </AudioPlayerProvider>
    </SSEProvider>
  )
}
