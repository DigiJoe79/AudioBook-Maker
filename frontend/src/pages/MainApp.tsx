
import AppLayout from '../components/layout/AppLayout'
import { ConnectionLostOverlay } from '../components/ConnectionLostOverlay'

export default function MainApp() {
  return (
    <>
      <AppLayout />
      <ConnectionLostOverlay />
    </>
  )
}
