/**
 * DisconnectButton - Backend disconnect button
 *
 * Shows a button that allows the user to manually disconnect from the current
 * backend and return to the start page to select a different backend.
 *
 * Saves the current session state before disconnecting so it can be restored
 * when the user reconnects.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconButton, Tooltip } from '@mui/material'
import { ExitToApp as DisconnectIcon } from '@mui/icons-material'
import { useAppStore } from '../store/appStore'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { getCurrentSessionState } from '../utils/sessionHelpers'
import { useTranslation } from 'react-i18next'
import { logger } from '../utils/logger'

export function DisconnectButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const disconnectBackend = useAppStore((state) => state.disconnectBackend)
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const currentProfile = useAppStore((state) => state.connection.profile)

  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDisconnect = () => {
    logger.group(
      '🔌 Backend Connection',
      'User Initiated Disconnect',
      {
        'Profile': currentProfile?.name || 'Unknown',
        'Action': 'Disconnecting and returning to start page'
      },
      '#2196F3'  // Blue
    )

    // Save current session state for later restore
    const sessionState = getCurrentSessionState()
    saveSessionState(sessionState)

    // Disconnect from backend
    disconnectBackend()

    // Navigate back to start page
    navigate('/', { replace: true })
  }

  return (
    <>
      <Tooltip title={t('disconnect.tooltip')}>
        <IconButton
          onClick={() => setConfirmOpen(true)}
          color="inherit"
          size="small"
          sx={{
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <DisconnectIcon />
        </IconButton>
      </Tooltip>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        title={t('disconnect.confirmTitle')}
        message={t('disconnect.confirmMessage', {
          name: currentProfile?.name || t('disconnect.unknownBackend')
        })}
        confirmText={t('disconnect.disconnect')}
        confirmColor="warning"
      />
    </>
  )
}
