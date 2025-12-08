/**
 * ConnectionLostOverlay
 *
 * Modal overlay displayed when backend connection is lost during app usage.
 * Shows reconnection progress and allows manual retry or disconnect.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Modal,
  Box,
  Typography,
  Button,
  LinearProgress,
  Paper,
} from '@mui/material'
import { Warning as WarningIcon } from '@mui/icons-material'
import { useConnectionMonitor } from '@hooks/useConnectionMonitor'
import { useAppStore } from '@store/appStore'
import { getCurrentSessionState } from '@utils/sessionHelpers'
import { useTranslation } from 'react-i18next'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'

export function ConnectionLostOverlay() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const disconnectBackend = useAppStore((state) => state.disconnectBackend)

  const { isConnected, retryCount, maxRetries, retryNow } = useConnectionMonitor({
    onConnectionLost: () => {
      // Save current state when connection is lost
      const state = getCurrentSessionState()
      saveSessionState(state)
      logger.group(
        '🔌 Connection',
        'Connection lost, session state saved',
        { selectedProject: state.selectedProjectId, selectedChapter: state.selectedChapterId },
        '#F44336'
      )
    },
    onConnectionRestored: async () => {
      // Connection restored - refetch engines and models
      // (they only change on backend restart, so always fetch fresh on reconnect)
      logger.group(
        '🔌 Connection',
        'Connection restored, fetching fresh data',
        { action: 'refetch', targets: ['engines'] },
        '#4CAF50'
      )

      try {
        // Fetch engines fresh (ignore cache)
        await queryClient.refetchQueries({
          queryKey: queryKeys.engines.all(),
          type: 'active'
        })

        logger.group(
          '🔌 Connection',
          'Data refresh complete',
          { status: 'success' },
          '#4CAF50'
        )
      } catch (error) {
        logger.warn('[ConnectionLostOverlay] Failed to refresh data:', error)
      }

      // Overlay will automatically hide because isConnected becomes true
    },
  })

  // Navigate to start page after max retries
  useEffect(() => {
    if (!isConnected && retryCount >= maxRetries) {
      logger.group(
        '🔌 Connection',
        'Max retries reached, redirecting to start page',
        { retryCount, maxRetries, delay: '1000ms' },
        '#F44336'
      )

      // Small delay to allow user to see the "giving up" state
      const timeout = setTimeout(() => {
        disconnectBackend()
        navigate('/', { replace: true })
      }, 1000)

      return () => clearTimeout(timeout)
    }
  }, [retryCount, maxRetries, isConnected, navigate, disconnectBackend])

  // Don't show overlay if connected
  if (isConnected) return null

  const progress = (retryCount / maxRetries) * 100
  const hasGivenUp = retryCount >= maxRetries

  return (
    <Modal
      open={!isConnected}
      // Don't allow closing by clicking outside
      onClose={() => {}}
      // Keep overlay above everything
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
          {/* Header */}
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

          {/* Progress */}
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

          {/* Giving up message */}
          {hasGivenUp && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" color="text.secondary">
                {t('connection.sessionSaved')}
              </Typography>
            </Box>
          )}

          {/* Actions */}
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
