/**
 * Export Dialog Component
 *
 * Allows users to export a chapter with various audio format options
 */

import { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Typography,
  LinearProgress,
  Alert,
  Box,
  FormHelperText,
  CircularProgress,
  Stack,
} from '@mui/material'
import {
  Download as DownloadIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material'
import { useExportWorkflow } from '@hooks/useExportQuery'
import type { Chapter, Project } from '@types'
import { exportApi } from '@services/api'
import { useAppStore } from '@store/appStore'
import { useTranslation } from 'react-i18next'
import { useSnackbar } from '@hooks/useSnackbar'
import { useError } from '@hooks/useError'
import { logger } from '@utils/logger'
import { translateBackendError } from '@utils/translateBackendError'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  chapter: Chapter
  project: Project
  segmentCount: number
  completedSegmentCount: number
}

// Quality presets for all formats
type QualityLevel = 'low' | 'medium' | 'high'

export function ExportDialog({
  open,
  onClose,
  chapter,
  project,
  segmentCount,
  completedSegmentCount,
}: ExportDialogProps) {
  const { t } = useTranslation()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const { showError, ErrorDialog } = useError()
  const settings = useAppStore((state) => state.settings)

  // Initialize from backend settings
  const [format, setFormat] = useState<'mp3' | 'm4a' | 'wav'>(settings?.audio.defaultFormat ?? 'm4a')
  const [quality, setQuality] = useState<QualityLevel>(settings?.audio.defaultQuality ?? 'medium')
  const [customFilename, setCustomFilename] = useState('')

  // Use pause from backend settings
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500

  const exportWorkflow = useExportWorkflow(chapter.id)
  const { progress, isExporting, isResetting, startExport, cancelExport, downloadExport } = exportWorkflow

  // Don't show any progress data while resetting (prevents showing 100% from old export)
  const currentProgress = (!isResetting && exportWorkflow.jobId) ? progress : null

  // Quality presets using translations
  const getQualityPresets = () => ({
    mp3: {
      low: { label: t('export.qualityLabels.mp3.low'), labelShort: t('export.qualityLabels.low') },
      medium: { label: t('export.qualityLabels.mp3.medium'), labelShort: t('export.qualityLabels.medium') },
      high: { label: t('export.qualityLabels.mp3.high'), labelShort: t('export.qualityLabels.high') },
    },
    m4a: {
      low: { label: t('export.qualityLabels.m4a.low'), labelShort: t('export.qualityLabels.low') },
      medium: { label: t('export.qualityLabels.m4a.medium'), labelShort: t('export.qualityLabels.medium') },
      high: { label: t('export.qualityLabels.m4a.high'), labelShort: t('export.qualityLabels.high') },
    },
    wav: {
      low: { label: t('export.qualityLabels.wav.low'), labelShort: t('export.qualityLabels.low') },
      medium: { label: t('export.qualityLabels.wav.medium'), labelShort: t('export.qualityLabels.medium') },
      high: { label: t('export.qualityLabels.wav.high'), labelShort: t('export.qualityLabels.high') },
    },
  })

  const QUALITY_PRESETS = getQualityPresets()

  // Generate default filename and reset settings when dialog opens
  useEffect(() => {
    if (open) {
      const defaultName = `${project.title} - ${chapter.title}`
      setCustomFilename(defaultName)

      // Update format and quality from current settings
      if (settings?.audio.defaultFormat) {
        setFormat(settings.audio.defaultFormat)
      }
      if (settings?.audio.defaultQuality) {
        setQuality(settings.audio.defaultQuality)
      }
    }
  }, [open, chapter, project, settings?.audio.defaultFormat, settings?.audio.defaultQuality])

  // Check if all segments are completed
  const canExport = completedSegmentCount === segmentCount && segmentCount > 0

  // Estimate file size (rough calculation based on quality preset)
  const estimatedFileSize = useMemo(() => {
    if (!currentProgress?.duration) return null

    const duration = currentProgress.duration
    // Bitrate mapping for quality levels (in kbps)
    const bitrateMap = {
      mp3: { low: 96, medium: 128, high: 192 },
      m4a: { low: 96, medium: 128, high: 192 },
      wav: { low: 0, medium: 0, high: 0 }, // Calculate from sample rate for WAV
    }

    // Sample rate mapping for quality levels
    const sampleRateMap = {
      mp3: { low: 22050, medium: 44100, high: 48000 },
      m4a: { low: 24000, medium: 44100, high: 48000 },
      wav: { low: 22050, medium: 24000, high: 48000 },
    }

    if (format === 'wav') {
      // WAV: uncompressed, calculate from sample rate
      const sr = sampleRateMap[format][quality]
      const bytesPerSecond = sr * 2 * 2 // 16-bit stereo
      return (duration * bytesPerSecond) / (1024 * 1024) // MB
    } else {
      // MP3 / M4A: use bitrate
      const bitrateNum = bitrateMap[format][quality] * 1000
      const bytes = (bitrateNum * duration) / 8
      return bytes / (1024 * 1024) // MB
    }
  }, [format, quality, currentProgress?.duration])

  const handleStartExport = async () => {
    try {
      await startExport({
        outputFormat: format,
        quality: quality,
        pauseBetweenSegments: pauseBetweenSegments,
        customFilename: customFilename,
      })
    } catch (error) {
      logger.error('[ExportDialog] Failed to start export:', error)
      await showError(t('export.title'), t('export.startFailed'))
    }
  }

  const handleClose = async () => {
    if (!isExporting || currentProgress?.status === 'completed') {
      // Cleanup export file when closing without download
      if (exportWorkflow.jobId && currentProgress?.status === 'completed') {
        try {
          await exportApi.deleteExport(exportWorkflow.jobId)
          logger.debug('[ExportDialog] Export file cleaned up on dialog close')
        } catch (error) {
          logger.warn('[ExportDialog] Failed to cleanup export file:', error)
          // Non-critical error, don't block closing
        }
      }

      exportWorkflow.resetExport()
      onClose()
    }
  }

  const handleDownload = async () => {
    try {
      // Generate filename with extension
      const filenameWithExt = `${customFilename}.${format}`

      const savedPath = await downloadExport(filenameWithExt)

      if (savedPath) {
        logger.group(
          '📤 Export',
          'File saved successfully',
          { path: savedPath },
          '#4CAF50'
        )

        // Cleanup export file after successful download
        if (exportWorkflow.jobId) {
          try {
            await exportApi.deleteExport(exportWorkflow.jobId)
            logger.debug('[ExportDialog] Export file cleaned up successfully')
          } catch (error) {
            logger.warn('[ExportDialog] Failed to cleanup export file:', error)
            // Non-critical error, don't show to user
          }
        }

        // Show success snackbar
        showSnackbar(t('export.status.fileSaved'), { severity: 'success' })

        // Close dialog automatically after successful download
        exportWorkflow.resetExport()
        onClose()
      } else {
        // User cancelled
        logger.debug('[ExportDialog] Download cancelled by user')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const translatedError = translateBackendError(errorMsg, t)
      showSnackbar(t('export.status.downloadFailed', { error: translatedError }), { severity: 'error' })
      logger.error('[ExportDialog] Download failed:', error)
    }
  }

  const getStatusIcon = () => {
    switch (currentProgress?.status) {
      case 'completed':
        return <CheckCircleIcon color="success" />
      case 'failed':
        return <ErrorIcon color="error" />
      case 'running':
        return <CircularProgress size={20} />
      default:
        return null
    }
  }

  const getProgressPercentage = () => {
    if (!currentProgress) return 0
    return Math.round(currentProgress.progress * 100)
  }

  // Generate localized progress message based on progress state
  const getProgressMessage = () => {
    if (!currentProgress) return t('export.status.starting')

    const progressPercent = currentProgress.progress
    const mergeThreshold = format === 'wav' ? 0.95 : 0.75

    if (progressPercent < mergeThreshold) {
      // Merging phase
      return t('export.progress.merging', {
        current: currentProgress.currentSegment,
        total: currentProgress.totalSegments,
      })
    } else if (progressPercent < 1.0) {
      // Converting phase
      return t('export.progress.converting', { format: format.toUpperCase() })
    } else {
      // Completed
      return t('export.status.completed')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {t('export.title')}
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Stack spacing={3} sx={{ mt: 2 }}>
          {/* Warning if not all segments are completed */}
          {!canExport && (
            <Alert severity="warning">
              {t('export.warnings.allSegmentsRequired', { completed: completedSegmentCount, total: segmentCount })}
            </Alert>
          )}

          {/* Export in progress */}
          {isExporting && (
            <Box>
              <Box display="flex" alignItems="center" mb={1}>
                {getStatusIcon()}
                <Typography variant="body2" sx={{ ml: 1 }}>
                  {getProgressMessage()}
                </Typography>
              </Box>
              <LinearProgress
                variant={currentProgress ? 'determinate' : 'indeterminate'}
                value={currentProgress ? getProgressPercentage() : undefined}
                sx={{
                  // FIX BUG 1: Disable CSS transitions to prevent 100→0 animation when switching exports
                  '& .MuiLinearProgress-bar': {
                    transition: 'none !important'
                  }
                }}
              />
              {currentProgress && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('export.progress.segmentsProcessed', { current: currentProgress.currentSegment, total: currentProgress.totalSegments })}
                </Typography>
              )}
            </Box>
          )}

          {/* Export completed */}
          {currentProgress?.status === 'completed' && (
            <Alert severity="success">
              {t('export.status.completed')}
              {currentProgress.fileSize && (
                <Typography variant="caption" display="block">
                  {t('export.fileSize', { size: (currentProgress.fileSize / (1024 * 1024)).toFixed(2) })}
                </Typography>
              )}
              {currentProgress.duration && (
                <Typography variant="caption" display="block">
                  {t('export.duration', { duration: Math.round(currentProgress.duration) })}
                </Typography>
              )}
            </Alert>
          )}

          {/* Export failed */}
          {currentProgress?.status === 'failed' && (
            <Alert severity="error">
              {t('export.status.failed', { error: translateBackendError(currentProgress.error || 'Unknown error', t) })}
            </Alert>
          )}

          {/* Export options (hidden during export) */}
          {!isExporting && currentProgress?.status !== 'completed' && (
            <>
              {/* Output filename */}
              <TextField
                label={t('export.filename')}
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
                placeholder={t('export.filenamePlaceholder')}
                helperText={t('export.filenameHint')}
              />

              {/* Format selection */}
              <FormControl fullWidth>
                <InputLabel shrink sx={{ backgroundColor: 'background.paper', px: 0.5 }}>
                  {t('export.audioFormat')}
                </InputLabel>
                <Select
                  value={format}
                  label={t('export.audioFormat')}
                  onChange={(e) => setFormat(e.target.value as typeof format)}
                  displayEmpty
                  notched
                >
                  <MenuItem value="mp3">{t('export.formats.mp3')}</MenuItem>
                  <MenuItem value="m4a">{t('export.formats.m4a')}</MenuItem>
                  <MenuItem value="wav">{t('export.formats.wav')}</MenuItem>
                </Select>
                <FormHelperText>
                  {t('export.formatHint')}
                </FormHelperText>
              </FormControl>

              {/* Quality selector - unified for all formats */}
              <FormControl fullWidth>
                <InputLabel shrink sx={{ backgroundColor: 'background.paper', px: 0.5 }}>
                  {t('export.quality')}
                </InputLabel>
                <Select
                  value={quality}
                  label={t('export.quality')}
                  onChange={(e) => setQuality(e.target.value as QualityLevel)}
                  displayEmpty
                  notched
                >
                  <MenuItem value="low">{QUALITY_PRESETS[format].low.label}</MenuItem>
                  <MenuItem value="medium">{QUALITY_PRESETS[format].medium.label}</MenuItem>
                  <MenuItem value="high">{QUALITY_PRESETS[format].high.label}</MenuItem>
                </Select>
                <FormHelperText>
                  {t('export.qualityHint')}
                </FormHelperText>
              </FormControl>

              {/* File size estimate (if available) */}
              {estimatedFileSize && (
                <Typography variant="body2" color="text.secondary">
                  {t('export.estimatedSize', { size: estimatedFileSize.toFixed(2) })}
                </Typography>
              )}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        {/* Cancel button (different behavior based on state) */}
        {isExporting && currentProgress?.status === 'running' ? (
          <Button
            onClick={cancelExport}
            color="error"
            variant="contained"
            startIcon={<CancelIcon />}
          >
            {t('export.cancelExport')}
          </Button>
        ) : (
          <Button onClick={handleClose}>
            {currentProgress?.status === 'completed' ? t('common.close') : t('common.cancel')}
          </Button>
        )}

        {/* Download button (when export completed) */}
        {currentProgress?.status === 'completed' && (
          <Button
            onClick={handleDownload}
            variant="contained"
            startIcon={<DownloadIcon />}
            color="success"
          >
            {t('export.download')}
          </Button>
        )}

        {/* Start export button */}
        {!isExporting && currentProgress?.status !== 'completed' && (
          <Button
            onClick={handleStartExport}
            variant="contained"
            disabled={!canExport || !customFilename}
            startIcon={<DownloadIcon />}
          >
            {t('export.startExport')}
          </Button>
        )}

      </DialogActions>

      {/* Snackbar for success/error notifications */}
      <SnackbarComponent />

      {/* Error dialog for critical failures */}
      <ErrorDialog />
    </Dialog>
  )
}