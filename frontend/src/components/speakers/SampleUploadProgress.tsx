/**
 * SampleUploadProgress - Progress Display for Uploading Samples
 *
 * Features:
 * - Per-file progress tracking
 * - Success/Error status indicators
 * - Retry failed uploads
 * - Cancel pending uploads
 * - Overall progress summary
 */

import React, { memo } from 'react'
import {
  Box,
  Typography,
  LinearProgress,
  IconButton,
  Stack,
  Chip,
  Alert,
} from '@mui/material'
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Close as CloseIcon,
  Refresh as RetryIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

export interface UploadItem {
  id: string
  fileName: string
  fileSize: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

interface SampleUploadProgressProps {
  items: UploadItem[]
  onCancel: (id: string) => void
  onRetry?: (id: string) => void
}

export default function SampleUploadProgress({
  items,
  onCancel,
  onRetry,
}: SampleUploadProgressProps) {
  const { t } = useTranslation()

  if (items.length === 0) return null

  const totalItems = items.length
  const successCount = items.filter((item) => item.status === 'success').length
  const errorCount = items.filter((item) => item.status === 'error').length
  const uploadingCount = items.filter((item) => item.status === 'uploading').length
  const pendingCount = items.filter((item) => item.status === 'pending').length

  const overallProgress = items.reduce((sum, item) => sum + item.progress, 0) / totalItems

  return (
    <Box>
      {/* Overall Progress Summary */}
      <Box mb={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="body2" fontWeight="medium">
            {t('speakers.uploadProgress.uploading', { current: uploadingCount + pendingCount, total: totalItems })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('speakers.uploadProgress.status', { succeeded: successCount, failed: errorCount })}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={overallProgress}
          sx={{ height: 6, borderRadius: 1 }}
        />
      </Box>

      {/* Individual File Progress */}
      <Stack spacing={1}>
        {items.map((item) => (
          <UploadItemRow
            key={item.id}
            item={item}
            onCancel={onCancel}
            onRetry={onRetry}
          />
        ))}
      </Stack>

      {/* Error Summary */}
      {errorCount > 0 && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('speakers.uploadProgress.errorSummary', { count: errorCount })}
        </Alert>
      )}
    </Box>
  )
}

// Helper function outside component (pure function, no re-creation)
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Individual upload item row
const UploadItemRow = memo(({
  item,
  onCancel,
  onRetry,
}: {
  item: UploadItem
  onCancel: (id: string) => void
  onRetry?: (id: string) => void
}) => {
  const { t } = useTranslation()

  const getStatusIcon = () => {
    switch (item.status) {
      case 'success':
        return <SuccessIcon sx={{ fontSize: 20, color: 'success.main' }} />
      case 'error':
        return <ErrorIcon sx={{ fontSize: 20, color: 'error.main' }} />
      case 'uploading':
        return null
      default:
        return null
    }
  }

  const getStatusColor = () => {
    switch (item.status) {
      case 'success':
        return 'success.50'
      case 'error':
        return 'error.50'
      case 'uploading':
        return 'primary.50'
      default:
        return 'background.default'
    }
  }

  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: getStatusColor(),
        borderRadius: 1,
        border: 1,
        borderColor: item.status === 'error' ? 'error.light' : 'divider',
      }}
    >
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
        <Box display="flex" alignItems="center" gap={1} flex={1}>
          {getStatusIcon()}
          <Box flex={1} minWidth={0}>
            <Typography variant="body2" noWrap>
              {item.fileName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatFileSize(item.fileSize)}
              {item.status === 'uploading' && ` • ${item.progress}%`}
            </Typography>
          </Box>
        </Box>

        {/* Actions */}
        <Box display="flex" alignItems="center" gap={0.5}>
          {item.status === 'uploading' && (
            <Chip
              label={`${item.progress}%`}
              size="small"
              color="primary"
              sx={{ minWidth: 60 }}
            />
          )}

          {item.status === 'error' && onRetry && (
            <IconButton size="small" onClick={() => onRetry(item.id)} title={t('speakers.uploadProgress.retry')}>
              <RetryIcon fontSize="small" />
            </IconButton>
          )}

          {(item.status === 'pending' || item.status === 'uploading' || item.status === 'error') && (
            <IconButton size="small" onClick={() => onCancel(item.id)} title={t('speakers.uploadProgress.cancel')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Progress Bar for Uploading */}
      {item.status === 'uploading' && (
        <LinearProgress
          variant="determinate"
          value={item.progress}
          sx={{ height: 4, borderRadius: 1 }}
        />
      )}

      {/* Error Message */}
      {item.status === 'error' && item.error && (
        <Typography variant="caption" color="error" display="block" mt={0.5}>
          {item.error}
        </Typography>
      )}
    </Box>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.progress === nextProps.item.progress &&
    prevProps.item.error === nextProps.item.error &&
    prevProps.onCancel === nextProps.onCancel &&
    prevProps.onRetry === nextProps.onRetry
  )
})

UploadItemRow.displayName = 'UploadItemRow'
