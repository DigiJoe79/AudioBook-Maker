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

import AppLayout from '../components/layout/AppLayout'
import { ConnectionLostOverlay } from '../components/ConnectionLostOverlay'
import { SSEProvider } from '../contexts/SSEContext'

export default function MainApp() {
  return (
    <SSEProvider enabled={true}>
      <AppLayout />
      <ConnectionLostOverlay />
    </SSEProvider>
  )
}
