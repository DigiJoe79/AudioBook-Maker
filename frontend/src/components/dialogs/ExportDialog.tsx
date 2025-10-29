
import React, { useState, useMemo, useEffect } from 'react'
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
import { useExportWorkflow } from '../../hooks/useExportQuery'
import type { Chapter, Project } from '../../types'
import { exportApi } from '../../services/api'
import { useAppStore } from '../../store/appStore'
import { useTranslation } from 'react-i18next'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  chapter: Chapter
  project: Project
  segmentCount: number
  completedSegmentCount: number
}

type QualityLevel = 'low' | 'medium' | 'high'

const QUALITY_PRESETS = {
  mp3: {
    low: { label: 'Low (96 kbps, 22 kHz)', labelShort: 'Low' },
    medium: { label: 'Medium (128 kbps, 44.1 kHz)', labelShort: 'Medium' },
    high: { label: 'High (192 kbps, 48 kHz)', labelShort: 'High' },
  },
  m4a: {
    low: { label: 'Low (96 kbps, 24 kHz)', labelShort: 'Low' },
    medium: { label: 'Medium (128 kbps, 44.1 kHz)', labelShort: 'Medium' },
    high: { label: 'High (192 kbps, 48 kHz)', labelShort: 'High' },
  },
  wav: {
    low: { label: 'Low (22 kHz)', labelShort: 'Low' },
    medium: { label: 'Medium (24 kHz, XTTS Standard)', labelShort: 'Medium' },
    high: { label: 'High (48 kHz)', labelShort: 'High' },
  },
}

export function ExportDialog({
  open,
  onClose,
  chapter,
  project,
  segmentCount,
  completedSegmentCount,
}: ExportDialogProps) {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings)

  const [format, setFormat] = useState<'mp3' | 'm4a' | 'wav'>(settings?.audio.defaultFormat ?? 'm4a')
  const [quality, setQuality] = useState<QualityLevel>(settings?.audio.defaultQuality ?? 'medium')
  const [customFilename, setCustomFilename] = useState('')

  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500
  const [downloadSuccess, setDownloadSuccess] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const exportWorkflow = useExportWorkflow(chapter.id)
  const { progress, isExporting, startExport, cancelExport, downloadExport } = exportWorkflow

  useEffect(() => {
    if (open) {
      const defaultName = `${project.title} - ${chapter.title}`
      setCustomFilename(defaultName)

      if (settings?.audio.defaultFormat) {
        setFormat(settings.audio.defaultFormat)
      }
      if (settings?.audio.defaultQuality) {
        setQuality(settings.audio.defaultQuality)
      }
    }
  }, [open, chapter, project, settings?.audio.defaultFormat, settings?.audio.defaultQuality])

  const canExport = completedSegmentCount === segmentCount && segmentCount > 0

  const estimatedFileSize = useMemo(() => {
    if (!progress?.duration) return null

    const duration = progress.duration
    const bitrateMap = {
      mp3: { low: 96, medium: 128, high: 192 },
      m4a: { low: 96, medium: 128, high: 192 },
      wav: { low: 0, medium: 0, high: 0 },
    }

    const sampleRateMap = {
      mp3: { low: 22050, medium: 44100, high: 48000 },
      m4a: { low: 24000, medium: 44100, high: 48000 },
      wav: { low: 22050, medium: 24000, high: 48000 },
    }

    if (format === 'wav') {
      const sr = sampleRateMap[format][quality]
      const bytesPerSecond = sr * 2 * 2
      return (duration * bytesPerSecond) / (1024 * 1024)
    } else {
      const bitrateNum = bitrateMap[format][quality] * 1000
      const bytes = (bitrateNum * duration) / 8
      return bytes / (1024 * 1024)
    }
  }, [format, quality, progress?.duration])

  const handleStartExport = async () => {
    try {
      await startExport({
        outputFormat: format,
        quality: quality,
        pauseBetweenSegments: pauseBetweenSegments,
        customFilename: customFilename,
      })
    } catch (error) {
      console.error('Failed to start export:', error)
    }
  }

  const handleClose = async () => {
    if (!isExporting || progress?.status === 'completed') {
      if (exportWorkflow.jobId && progress?.status === 'completed' && !downloadSuccess) {
        try {
          await exportApi.deleteExport(exportWorkflow.jobId)
          console.log('Export file cleaned up on dialog close')
        } catch (error) {
          console.warn('Failed to cleanup export file:', error)
        }
      }

      exportWorkflow.resetExport()
      setDownloadSuccess(false)
      setDownloadError(null)
      onClose()
    }
  }

  const handleDownload = async () => {
    try {
      setDownloadError(null)
      setDownloadSuccess(false)

      const filenameWithExt = `${customFilename}.${format}`

      const savedPath = await downloadExport(filenameWithExt)

      if (savedPath) {
        setDownloadSuccess(true)
        console.log(`File saved to: ${savedPath}`)

        if (exportWorkflow.jobId) {
          try {
            await exportApi.deleteExport(exportWorkflow.jobId)
            console.log('Export file cleaned up successfully')
          } catch (error) {
            console.warn('Failed to cleanup export file:', error)
          }
        }
      } else {
        console.log('Download cancelled by user')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setDownloadError(errorMsg)
      console.error('Download failed:', error)
    }
  }

  const getStatusIcon = () => {
    switch (progress?.status) {
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
    if (!progress) return 0
    return Math.round(progress.progress * 100)
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('export.title')}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          {!canExport && (
            <Alert severity="warning">
              {t('export.warnings.allSegmentsRequired', { completed: completedSegmentCount, total: segmentCount })}
            </Alert>
          )}

          {isExporting && progress && (
            <Box>
              <Box display="flex" alignItems="center" mb={1}>
                {getStatusIcon()}
                <Typography variant="body2" sx={{ ml: 1 }}>
                  {progress.message}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={getProgressPercentage()}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('export.progress.segmentsProcessed', { current: progress.currentSegment, total: progress.totalSegments })}
              </Typography>
            </Box>
          )}

          {progress?.status === 'completed' && (
            <>
              <Alert
                severity="success"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownload}
                  >
                    {t('export.download')}
                  </Button>
                }
              >
                {t('export.status.completed')}
                {progress.fileSize && (
                  <Typography variant="caption" display="block">
                    {t('export.fileSize', { size: (progress.fileSize / (1024 * 1024)).toFixed(2) })}
                  </Typography>
                )}
                {progress.duration && (
                  <Typography variant="caption" display="block">
                    {t('export.duration', { duration: Math.round(progress.duration) })}
                  </Typography>
                )}
              </Alert>

              {downloadSuccess && (
                <Alert severity="success">
                  {t('export.status.fileSaved')}
                </Alert>
              )}

              {downloadError && (
                <Alert severity="error">
                  {t('export.status.downloadFailed', { error: downloadError })}
                </Alert>
              )}
            </>
          )}

          {progress?.status === 'failed' && (
            <Alert severity="error">
              {t('export.status.failed', { error: progress.error || 'Unknown error' })}
            </Alert>
          )}

          {!isExporting && progress?.status !== 'completed' && (
            <>
              <TextField
                label={t('export.filename')}
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                fullWidth
                helperText={t('export.filenameHint')}
              />

              <FormControl fullWidth>
                <InputLabel>{t('export.audioFormat')}</InputLabel>
                <Select
                  value={format}
                  label={t('export.audioFormat')}
                  onChange={(e) => setFormat(e.target.value as typeof format)}
                >
                  <MenuItem value="mp3">{t('export.formats.mp3')}</MenuItem>
                  <MenuItem value="m4a">{t('export.formats.m4a')}</MenuItem>
                  <MenuItem value="wav">{t('export.formats.wav')}</MenuItem>
                </Select>
                <FormHelperText>
                  {t('export.formatHint')}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>{t('export.quality')}</InputLabel>
                <Select
                  value={quality}
                  label={t('export.quality')}
                  onChange={(e) => setQuality(e.target.value as QualityLevel)}
                >
                  <MenuItem value="low">{QUALITY_PRESETS[format].low.label}</MenuItem>
                  <MenuItem value="medium">{QUALITY_PRESETS[format].medium.label}</MenuItem>
                  <MenuItem value="high">{QUALITY_PRESETS[format].high.label}</MenuItem>
                </Select>
                <FormHelperText>
                  {t('export.qualityHint')}
                </FormHelperText>
              </FormControl>



              {estimatedFileSize && (
                <Typography variant="body2" color="text.secondary">
                  {t('export.estimatedSize', { size: estimatedFileSize.toFixed(2) })}
                </Typography>
              )}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        {isExporting && progress?.status === 'running' ? (
          <Button onClick={cancelExport} color="error" startIcon={<CancelIcon />}>
            {t('export.cancelExport')}
          </Button>
        ) : (
          <Button onClick={handleClose}>
            {progress?.status === 'completed' ? t('common.close') : t('common.cancel')}
          </Button>
        )}

        {!isExporting && progress?.status !== 'completed' && (
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
    </Dialog>
  )
}