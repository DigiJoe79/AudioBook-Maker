/**
 * AddHostDialog - Two-step dialog for adding remote Docker hosts
 *
 * Step 1: Enter host name and SSH URL, generate SSH key
 * Step 2: Copy install command, test connection, save host
 */

import React, { useState, useCallback, memo } from 'react'
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
  Stepper,
  Step,
  StepLabel,
  Paper,
} from '@mui/material'
import {
  ContentCopy as CopyIcon,
  Check as CheckIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { engineHostsApi, type PrepareHostResponse, type TestHostResponse } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import { translateBackendError } from '@utils/translateBackendError'
import { logger } from '@utils/logger'

// ============================================================================
// Types
// ============================================================================

interface AddHostDialogProps {
  open: boolean
  onClose: () => void
}

interface HostForm {
  name: string
  sshUrl: string
}

type SaveStatus = 'idle' | 'testing' | 'saving'

// ============================================================================
// AddHostDialog Component
// ============================================================================

const AddHostDialog = memo(({ open, onClose }: AddHostDialogProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // Form state
  const [hostForm, setHostForm] = useState<HostForm>({ name: '', sshUrl: '' })
  const [activeStep, setActiveStep] = useState(0)
  const [prepareResult, setPrepareResult] = useState<PrepareHostResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Prepare mutation (generate SSH key)
  const prepareMutation = useMutation({
    mutationFn: engineHostsApi.prepare,
    onSuccess: (result) => {
      setPrepareResult(result)
      setActiveStep(1)
      logger.info('[AddHostDialog] SSH key generated for host', result.hostId)
    },
    onError: (err: Error) => {
      logger.error('[AddHostDialog] Prepare failed:', err)
    },
  })

  // Create mutation (save host)
  const createMutation = useMutation({
    mutationFn: engineHostsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engineHosts.all() })
      handleClose()
      logger.info('[AddHostDialog] Host created successfully')
    },
    onError: (err: Error) => {
      logger.error('[AddHostDialog] Create failed:', err)
    },
  })

  // Reset state and close (with cleanup if needed)
  const handleClose = useCallback(async () => {
    // Clean up prepared host if we generated keys but didn't save
    if (prepareResult && saveStatus !== 'saving') {
      try {
        await engineHostsApi.cleanupPrepared(prepareResult.hostId)
        logger.info('[AddHostDialog] Cleaned up prepared host:', prepareResult.hostId)
      } catch (err) {
        logger.warn('[AddHostDialog] Cleanup failed:', err)
      }
    }

    setHostForm({ name: '', sshUrl: '' })
    setActiveStep(0)
    setPrepareResult(null)
    setCopied(false)
    setSaveStatus('idle')
    setSaveError(null)
    onClose()
  }, [onClose, prepareResult, saveStatus])

  // Handle generate key
  const handleGenerateKey = useCallback(() => {
    if (!hostForm.name || !hostForm.sshUrl) return
    prepareMutation.mutate(hostForm)
  }, [hostForm, prepareMutation])

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    if (!prepareResult) return

    try {
      await navigator.clipboard.writeText(prepareResult.installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logger.error('[AddHostDialog] Copy failed:', err)
    }
  }, [prepareResult])

  // Handle save (test connection first, then save)
  const handleSave = useCallback(async () => {
    if (!prepareResult) return

    setSaveStatus('testing')
    setSaveError(null)

    try {
      // Test connection first
      const testResult = await engineHostsApi.test(prepareResult.hostId, hostForm.sshUrl)

      if (!testResult.success) {
        setSaveError(testResult.error || 'Connection test failed')
        setSaveStatus('idle')
        return
      }

      logger.info('[AddHostDialog] Connection test passed:', {
        dockerVersion: testResult.dockerVersion,
        hasGpu: testResult.hasGpu,
      })

      // Connection successful, now save
      setSaveStatus('saving')
      createMutation.mutate({
        name: hostForm.name,
        sshUrl: hostForm.sshUrl,
        hostId: prepareResult.hostId,
        hasGpu: testResult.hasGpu,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      setSaveError(message)
      setSaveStatus('idle')
    }
  }, [hostForm, prepareResult, createMutation])

  const steps = [
    t('settings.addHost.step1', 'Enter Details'),
    t('settings.addHost.step2', 'Install SSH Key'),
  ]

  const isStep1Valid = hostForm.name.trim() !== '' && hostForm.sshUrl.trim() !== ''

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { minHeight: 400 } }}
    >
      <DialogTitle>{t('settings.addHost.title', 'Add Docker Host')}</DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3, mt: 1 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Step 1: Enter Details */}
        {activeStep === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('settings.addHost.name', 'Host Name')}
              value={hostForm.name}
              onChange={(e) => setHostForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('settings.addHost.namePlaceholder', 'GPU Server')}
              fullWidth
              autoFocus
            />
            <TextField
              label={t('settings.addHost.sshUrl', 'SSH URL')}
              value={hostForm.sshUrl}
              onChange={(e) => setHostForm((prev) => ({ ...prev, sshUrl: e.target.value }))}
              placeholder={t('settings.addHost.sshUrlPlaceholder', 'ssh://user@192.168.1.100')}
              helperText={t('settings.addHost.sshUrlHelp', 'SSH connection URL for the remote Docker host')}
              fullWidth
            />

            {prepareMutation.error && (
              <Alert severity="error">
                {translateBackendError(prepareMutation.error.message, t)}
              </Alert>
            )}
          </Box>
        )}

        {/* Step 2: Install SSH Key */}
        {activeStep === 1 && prepareResult && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="info" sx={{ mb: 1 }}>
              {t('settings.addHost.installInstructions', 'Run this command on your remote host to authorize the SSH key:')}
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
                  fontSize: '0.75rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'grey.100',
                  m: 0,
                  pr: 5,
                }}
              >
                {prepareResult.installCommand}
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

            <Alert severity="warning">
              {t('settings.addHost.securityNote', 'This key is restricted to Docker operations only. Even if compromised, it cannot open a shell on the remote host.')}
            </Alert>

            {/* Error display */}
            {saveError && (
              <Alert severity="error">
                {translateBackendError(saveError, t)}
              </Alert>
            )}

            {createMutation.error && (
              <Alert severity="error">
                {translateBackendError(createMutation.error.message, t)}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit">
          {t('common.cancel')}
        </Button>

        {activeStep === 0 && (
          <Button
            variant="contained"
            onClick={handleGenerateKey}
            disabled={!isStep1Valid || prepareMutation.isPending}
            startIcon={prepareMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            {t('settings.addHost.generateKey', 'Generate SSH Key')}
          </Button>
        )}

        {activeStep === 1 && (
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saveStatus !== 'idle'}
            startIcon={saveStatus !== 'idle' ? <CircularProgress size={16} /> : null}
          >
            {saveStatus === 'testing'
              ? t('settings.addHost.testingConnection', 'Testing...')
              : saveStatus === 'saving'
                ? t('common.saving', 'Saving...')
                : t('common.save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
})

AddHostDialog.displayName = 'AddHostDialog'

export default AddHostDialog
