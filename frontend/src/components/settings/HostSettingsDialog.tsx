/**
 * HostSettingsDialog - Configure Docker host settings
 *
 * Shows volume configuration for Docker hosts and SSH public key for remote hosts.
 */

import React, { useState, useCallback, memo, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
  Stack,
  Paper,
  Divider,
} from '@mui/material'
import {
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Save as SaveIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { engineHostsApi, type EngineHost, type HostPublicKeyResponse } from '@services/api'
import { translateBackendError } from '@utils/translateBackendError'
import { useSnackbar } from '@hooks/useSnackbar'
import { logger } from '@utils/logger'

// ============================================================================
// Types
// ============================================================================

interface HostSettingsDialogProps {
  open: boolean
  onClose: () => void
  host: EngineHost
}

interface VolumeConfig {
  samplesPath: string
  modelsPath: string
}

// ============================================================================
// HostSettingsDialog Component
// ============================================================================

const HostSettingsDialog = memo(({ open, onClose, host }: HostSettingsDialogProps) => {
  const { t } = useTranslation()
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  // Volume config state
  const [volumeConfig, setVolumeConfig] = useState<VolumeConfig>({ samplesPath: '', modelsPath: '' })
  const [volumeLoading, setVolumeLoading] = useState(false)
  const [volumeSaving, setVolumeSaving] = useState(false)

  // Public key state (for remote hosts)
  const [publicKeyData, setPublicKeyData] = useState<HostPublicKeyResponse | null>(null)
  const [publicKeyLoading, setPublicKeyLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const isRemote = host.hostType === 'docker:remote'

  // Load data when dialog opens
  useEffect(() => {
    if (!open) return

    const loadData = async () => {
      // Load volume config
      setVolumeLoading(true)
      try {
        const result = await engineHostsApi.getDockerVolumes(host.hostId)
        setVolumeConfig({
          samplesPath: result.samplesPath || '',
          modelsPath: result.modelsPath || '',
        })
      } catch (err) {
        logger.error('[HostSettingsDialog] Failed to load volume config:', err)
      } finally {
        setVolumeLoading(false)
      }

      // Load public key for remote hosts
      if (isRemote) {
        setPublicKeyLoading(true)
        try {
          const result = await engineHostsApi.getPublicKey(host.hostId)
          setPublicKeyData(result)
        } catch (err) {
          logger.error('[HostSettingsDialog] Failed to load public key:', err)
        } finally {
          setPublicKeyLoading(false)
        }
      }
    }

    loadData()
  }, [open, host.hostId, isRemote])

  // Handle save volume config
  const handleSave = useCallback(async () => {
    setVolumeSaving(true)
    try {
      const result = await engineHostsApi.setDockerVolumes(
        host.hostId,
        volumeConfig.samplesPath || null,
        volumeConfig.modelsPath || null
      )

      if (result.validationError) {
        showSnackbar(result.validationError, { severity: 'warning' })
      } else {
        showSnackbar(t('settings.dockerHosts.volumeConfig.saved', 'Volume configuration saved'), { severity: 'success' })
      }
      onClose()
    } catch (err) {
      logger.error('[HostSettingsDialog] Failed to save volume config:', err)
      showSnackbar(translateBackendError(err instanceof Error ? err.message : 'Failed to save', t), { severity: 'error' })
    } finally {
      setVolumeSaving(false)
    }
  }, [host.hostId, volumeConfig, showSnackbar, t, onClose])

  // Handle copy install command
  const handleCopy = useCallback(async () => {
    if (!publicKeyData?.installCommand) return

    try {
      await navigator.clipboard.writeText(publicKeyData.installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logger.error('[HostSettingsDialog] Copy failed:', err)
    }
  }, [publicKeyData])

  const isLoading = volumeLoading || publicKeyLoading

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('settings.hostSettings.title', 'Host Settings')} - {host.displayName}
        </DialogTitle>

        <DialogContent>
          {isLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <Stack spacing={3} sx={{ mt: 1 }}>
              {/* Volume Configuration Section */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  {t('settings.dockerHosts.volumeConfig.title', 'Volume Configuration')}
                </Typography>
                <Stack spacing={2}>
                  <TextField
                    label={t('settings.dockerHosts.volumeConfig.samplesPath', 'Samples Path')}
                    value={volumeConfig.samplesPath}
                    onChange={(e) => setVolumeConfig(prev => ({ ...prev, samplesPath: e.target.value }))}
                    size="small"
                    fullWidth
                    placeholder="C:\audiobook-data\samples  or  /data/samples"
                    helperText={t('settings.dockerHosts.volumeConfig.samplesPathHelp', 'Host path for speaker samples. Leave empty to use upload mechanism.')}
                  />
                  <TextField
                    label={t('settings.dockerHosts.volumeConfig.modelsPath', 'Models Path')}
                    value={volumeConfig.modelsPath}
                    onChange={(e) => setVolumeConfig(prev => ({ ...prev, modelsPath: e.target.value }))}
                    size="small"
                    fullWidth
                    placeholder="C:\audiobook-data\models  or  /data/models"
                    helperText={t('settings.dockerHosts.volumeConfig.modelsPathHelp', 'Host path for external models. Leave empty for none.')}
                  />
                </Stack>
              </Box>

              {/* SSH Public Key Section (remote hosts only) */}
              {isRemote && publicKeyData?.success && publicKeyData.publicKey && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t('settings.hostSettings.sshKey', 'SSH Public Key')}
                    </Typography>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      {t('settings.hostSettings.sshKeyInfo', 'This key must be in the authorized_keys file on the remote host.')}
                    </Alert>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        bgcolor: 'grey.900',
                        position: 'relative',
                        fontFamily: 'monospace',
                      }}
                    >
                      <Typography
                        component="pre"
                        sx={{
                          fontSize: '0.7rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          color: 'grey.100',
                          m: 0,
                          pr: 5,
                        }}
                      >
                        {publicKeyData.installCommand}
                      </Typography>
                      <Tooltip title={copied ? t('common.copied', 'Copied!') : t('common.copy', 'Copy')}>
                        <IconButton
                          onClick={handleCopy}
                          size="small"
                          sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            color: 'grey.400',
                            '&:hover': { color: 'grey.100' },
                          }}
                        >
                          {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Paper>
                  </Box>
                </>
              )}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={volumeSaving || isLoading}
            startIcon={volumeSaving ? <CircularProgress size={16} /> : <SaveIcon />}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
      <SnackbarComponent />
    </>
  )
})

HostSettingsDialog.displayName = 'HostSettingsDialog'

export default HostSettingsDialog
