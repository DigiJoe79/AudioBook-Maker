
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Modal,
  Box,
  Typography,
  Button,
  LinearProgress,
  Paper,
} from '@mui/material'
import { Warning as WarningIcon } from '@mui/icons-material'
import { useConnectionMonitor } from '../hooks/useConnectionMonitor'
import { useAppStore } from '../store/appStore'
import { getCurrentSessionState } from '../utils/sessionHelpers'
import { useTranslation } from 'react-i18next'

export function ConnectionLostOverlay() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const disconnectBackend = useAppStore((state) => state.disconnectBackend)

  const { isConnected, retryCount, maxRetries, retryNow } = useConnectionMonitor({
    onConnectionLost: () => {
      const state = getCurrentSessionState()
      saveSessionState(state)
      console.log('[ConnectionLostOverlay] Connection lost, session state saved')
    },
    onConnectionRestored: () => {
      console.log('[ConnectionLostOverlay] Connection restored')
    },
  })

  useEffect(() => {
    if (!isConnected && retryCount >= maxRetries) {
      console.log('[ConnectionLostOverlay] Max retries reached, redirecting to start page')

      const timeout = setTimeout(() => {
        disconnectBackend()
        navigate('/', { replace: true })
      }, 1000)

      return () => clearTimeout(timeout)
    }
  }, [retryCount, maxRetries, isConnected, navigate, disconnectBackend])

  if (isConnected) return null

  const progress = (retryCount / maxRetries) * 100
  const hasGivenUp = retryCount >= maxRetries

  return (
    <Modal
      open={!isConnected}
      onClose={() => {}}
      sx={{ zIndex: 9999 }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 450,
        }}
      >
        <Paper
          elevation={24}
          sx={{
            p: 4,
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <WarningIcon
              color="warning"
              sx={{ fontSize: 48 }}
            />
            <Box>
              <Typography variant="h6" gutterBottom>
                {t('connection.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {hasGivenUp
                  ? t('connection.unableToReconnect')
                  : t('connection.tryingToReconnect')}
              </Typography>
            </Box>
          </Box>

          {!hasGivenUp && (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('connection.reconnectionAttempt')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {retryCount}/{maxRetries}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 8,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {t('connection.returnToStartPage')}
              </Typography>
            </Box>
          )}

          {hasGivenUp && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" color="text.secondary">
                {t('connection.sessionSaved')}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => {
                disconnectBackend()
                navigate('/', { replace: true })
              }}
              fullWidth
            >
              {t('connection.disconnectNow')}
            </Button>
            <Button
              variant="contained"
              onClick={retryNow}
              fullWidth
              disabled={hasGivenUp}
            >
              {hasGivenUp ? t('connection.redirecting') : t('connection.retryNow')}
            </Button>
          </Box>
        </Paper>
      </Box>
    </Modal>
  )
}
