/**
 * Jobs Panel Dialog - Real-Time Job Monitoring
 *
 * Completely redesigned for perfect SSE integration and excellent UX:
 * - Direct SSE subscription for instant updates (no polling)
 * - Grouped by status: Active (running/pending) vs. Finished (completed/failed/cancelled)
 * - Toast notifications instead of alerts
 * - Optimistic UI updates for instant feedback
 * - Smooth animations for status changes
 * - Live progress bars with real-time updates
 */

import { useState, useCallback, useEffect, useMemo, memo } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  List,
  ListItem,
  Paper,
  Chip,
  LinearProgress,
  Button,
  Tooltip,
  Stack,
  Divider,
  Collapse,
  Alert,
  Snackbar,
  alpha,
  useTheme,
} from '@mui/material'
import {
  Close as CloseIcon,
  CheckCircle,
  Error as ErrorIcon,
  Pause,
  HourglassEmpty,
  PlayArrow,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
  Loop,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import {
  useTTSJobs,
  useDeleteJob,
  useClearJobHistory,
  useResumeJob,
  useCancelJob,
} from '../../hooks/useTTSQuery'
import { useSSEConnection } from '../../contexts/SSEContext'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { TTSJob } from '../../types'
import { logger } from '../../utils/logger'

interface JobsPanelDialogProps {
  open: boolean
  onClose: () => void
}

interface ToastState {
  open: boolean
  message: string
  severity: 'success' | 'error' | 'info' | 'warning'
}

// ============================================================================
// Job Card Component (Extracted outside for proper memoization)
// ============================================================================

interface JobCardProps {
  job: TTSJob
  onPause: (job: TTSJob) => void
  onResume: (job: TTSJob) => void
  onDelete: (job: TTSJob) => void
  isPauseDisabled: boolean
  isResumeDisabled: boolean
  isDeleteDisabled: boolean
}

const JobCard = memo(({
  job,
  onPause,
  onResume,
  onDelete,
  isPauseDisabled,
  isResumeDisabled,
  isDeleteDisabled
}: JobCardProps) => {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const dateLocale = i18n.language === 'de' ? de : enUS

  // Get status configuration
  const getStatusConfig = useCallback((status: string) => {
    switch (status) {
      case 'running':
        return {
          icon: <Loop sx={{ fontSize: 20 }} className="rotating-icon" />,
          color: 'warning.main',
          label: t('jobs.status.running'),
          chipColor: 'warning' as const,
        }
      case 'completed':
        return {
          icon: <CheckCircle sx={{ fontSize: 20 }} />,
          color: 'success.main',
          label: t('jobs.status.completed'),
          chipColor: 'success' as const,
        }
      case 'failed':
        return {
          icon: <ErrorIcon sx={{ fontSize: 20 }} />,
          color: 'error.main',
          label: t('jobs.status.failed'),
          chipColor: 'error' as const,
        }
      case 'cancelled':
        return {
          icon: <Pause sx={{ fontSize: 20 }} />,
          color: 'info.main',
          label: t('jobs.status.paused'),
          chipColor: 'default' as const,
        }
      case 'pending':
        return {
          icon: <HourglassEmpty sx={{ fontSize: 20 }} />,
          color: 'info.main',
          label: t('jobs.status.pending'),
          chipColor: 'info' as const,
        }
      default:
        return {
          icon: <HourglassEmpty sx={{ fontSize: 20 }} />,
          color: 'text.disabled',
          label: status,
          chipColor: 'default' as const,
        }
    }
  }, [t])

  // Format timestamp
  const formatTimestamp = useCallback((timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), {
        addSuffix: true,
        locale: dateLocale,
      })
    } catch {
      return timestamp
    }
  }, [dateLocale])

  const statusConfig = getStatusConfig(job.status)

  // Calculate progress - use max(current, 0) to prevent negative or NaN values
  const progress = useMemo(() => {
    if (!job.totalSegments || job.totalSegments === 0) return 0
    const calculated = (job.processedSegments / job.totalSegments) * 100
    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, calculated))
  }, [job.processedSegments, job.totalSegments])

  const remaining = job.totalSegments - job.processedSegments - (job.failedSegments || 0)

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 1,
        bgcolor: 'background.paper',
        borderLeft: 3,
        borderColor: statusConfig.color,
        maxHeight: 180,
        overflow: 'hidden',
      }}
    >
      <ListItem
        sx={{
          py: 2,
          px: 2,
          alignItems: 'flex-start',
        }}
      >
        {/* Left Side: Icon + Job Info */}
        <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, minWidth: 0 }}>
          {/* Status Icon */}
          <Box
            sx={{
              pt: 0.5,
              color: statusConfig.color,
            }}
          >
            {statusConfig.icon}
          </Box>

          {/* Job Info */}
          <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {/* Title */}
            <Typography variant="body1" sx={{ fontWeight: 'medium', mb: 0.5 }}>
              {job.projectTitle && job.chapterTitle
                ? `${job.projectTitle} / ${job.chapterTitle}`
                : job.chapterTitle || job.projectTitle || t('appLayout.jobs.noTitle')}
            </Typography>

            {/* Meta Info */}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {/* Status Chip */}
              <Chip
                size="small"
                label={statusConfig.label}
                color={statusConfig.chipColor}
                variant={job.status === 'completed' ? 'filled' : 'outlined'}
              />

              {/* Completed Segments */}
              {job.processedSegments > 0 && (
                <Chip
                  size="small"
                  icon={<CheckCircle />}
                  label={`${job.processedSegments}/${job.totalSegments}`}
                  color="success"
                  variant={job.processedSegments === job.totalSegments ? 'filled' : 'outlined'}
                />
              )}

              {/* Failed Segments */}
              {(job.failedSegments || 0) > 0 && (
                <Chip
                  size="small"
                  icon={<ErrorIcon />}
                  label={job.failedSegments}
                  color="error"
                />
              )}

              {/* Remaining Segments */}
              {remaining > 0 && (job.status === 'running' || job.status === 'pending') && (
                <Chip
                  size="small"
                  icon={<HourglassEmpty />}
                  label={remaining}
                  variant="outlined"
                />
              )}

              {/* Timestamp */}
              <Chip
                size="small"
                label={formatTimestamp(job.createdAt)}
                variant="outlined"
                sx={{ opacity: 0.7 }}
              />
            </Stack>

            {/* Progress Bar (running and paused jobs) - Show if any progress exists */}
            {((job.status === 'running' || job.status === 'cancelled') || job.processedSegments > 0) && (
              <Box sx={{ mt: 1.5 }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 0.5,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {t('appLayout.jobs.progress')}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={job.status === 'running' ? 'warning.main' : 'text.secondary'}
                    fontWeight="bold"
                  >
                    {progress.toFixed(0)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: 'action.hover',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: statusConfig.color,
                      transition: 'transform 0.5s ease',
                    },
                  }}
                />
              </Box>
            )}

            {/* Error Message */}
            {job.status === 'failed' && job.errorMessage && (
              <Alert severity="error" sx={{ mt: 1, py: 0 }}>
                <Typography variant="caption">{job.errorMessage}</Typography>
              </Alert>
            )}
          </Box>
        </Box>

        {/* Action Buttons - Positioned top right */}
        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            alignSelf: 'flex-start',
            flexShrink: 0,
          }}
        >
          {/* Running/Pending → Pause */}
          {(job.status === 'running' || job.status === 'pending') && (
            <Tooltip title={t('jobs.actions.pause')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onPause(job)}
                  disabled={isPauseDisabled}
                  sx={{
                    '&:hover': {
                      bgcolor: alpha(theme.palette.warning.main, 0.1),
                    },
                  }}
                >
                  <Pause color="warning" fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}

          {/* Paused → Resume + Delete */}
          {job.status === 'cancelled' && (
            <>
              <Tooltip title={t('jobs.actions.resume')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onResume(job)}
                    disabled={isResumeDisabled}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.success.main, 0.1),
                      },
                    }}
                  >
                    <PlayArrow color="success" fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('jobs.actions.delete')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onDelete(job)}
                    disabled={isDeleteDisabled}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.error.main, 0.1),
                      },
                    }}
                  >
                    <DeleteIcon color="error" fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </Box>
      </ListItem>
    </Paper>
  )
}, (prevProps, nextProps) => {
  // Custom comparison: return TRUE to SKIP re-render, FALSE to re-render
  const prev = prevProps.job
  const next = nextProps.job

  // Also check if disabled states changed
  const propsChanged =
    prevProps.isPauseDisabled !== nextProps.isPauseDisabled ||
    prevProps.isResumeDisabled !== nextProps.isResumeDisabled ||
    prevProps.isDeleteDisabled !== nextProps.isDeleteDisabled

  // SKIP re-render if all relevant fields are identical and props haven't changed
  const shouldSkipRerender = !propsChanged && (
    prev.id === next.id &&
    prev.status === next.status &&
    prev.processedSegments === next.processedSegments &&
    prev.totalSegments === next.totalSegments &&
    prev.failedSegments === next.failedSegments &&
    prev.errorMessage === next.errorMessage &&
    prev.currentSegmentId === next.currentSegmentId &&
    prev.chapterTitle === next.chapterTitle &&
    prev.projectTitle === next.projectTitle
  )

  return shouldSkipRerender
})

// ============================================================================
// Main Dialog Component
// ============================================================================

export function JobsPanelDialog({ open, onClose }: JobsPanelDialogProps) {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language === 'de' ? de : enUS
  const theme = useTheme()

  // SSE connection status
  const { connection: sseConnection } = useSSEConnection()
  const isSSEActive = sseConnection.connectionType === 'sse' && sseConnection.status === 'connected'

  // Toast notification state
  const [toast, setToast] = useState<ToastState>({
    open: false,
    message: '',
    severity: 'info',
  })

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState({
    active: true,
    finished: true,
  })

  // Fetch all jobs (SSE-aware, no unnecessary polling)
  const { data: jobsData, isLoading, dataUpdatedAt, refetch } = useTTSJobs(
    { limit: 50 },
    { refetchInterval: open ? undefined : false }
  )
  const jobs = jobsData?.jobs ?? []

  // Refetch jobs when dialog opens (ensures fresh data after disconnect)
  useEffect(() => {
    if (open) {
      refetch()
    }
  }, [open, refetch])

  // Job action mutations
  const deleteJobMutation = useDeleteJob()
  const clearHistoryMutation = useClearJobHistory()
  const resumeJobMutation = useResumeJob()
  const cancelJobMutation = useCancelJob()

  // Group jobs by status
  // Active: pending, running, cancelled (paused)
  // Finished: completed, failed
  const activeJobs = useMemo(() => jobs.filter(
    (job) => job.status === 'pending' || job.status === 'running' || job.status === 'cancelled'
  ), [jobs])

  const finishedJobs = useMemo(() => jobs.filter(
    (job) => job.status === 'completed' || job.status === 'failed'
  ), [jobs])

  // Show toast notification
  const showToast = useCallback(
    (message: string, severity: ToastState['severity'] = 'info') => {
      setToast({ open: true, message, severity })
    },
    []
  )

  // Close toast
  const handleToastClose = useCallback(() => {
    setToast((prev) => ({ ...prev, open: false }))
  }, [])

  // Toggle section expansion
  const toggleSection = useCallback((section: 'active' | 'finished') => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }, [])

  // Handler: Pause job (with optimistic update to prevent visual jump)
  const handlePauseJob = useCallback(async (job: TTSJob) => {
    try {
      // Show toast immediately for instant feedback
      showToast(t('jobs.messages.pauseSuccess'), 'success')
      // API call happens in background (SSE will update the UI)
      await cancelJobMutation.mutateAsync(job.id)
    } catch (err) {
      logger.error('[JobsPanelDialog] Failed to pause job:', err)
      showToast(t('jobs.errors.pauseFailed'), 'error')
    }
  }, [cancelJobMutation, showToast, t])

  // Handler: Delete job
  const handleDeleteJob = useCallback(async (job: TTSJob) => {
    try {
      await deleteJobMutation.mutateAsync(job.id)
      showToast(t('jobs.messages.deleteSuccess'), 'success')
    } catch (err) {
      logger.error('[JobsPanelDialog] Failed to delete job:', err)
      showToast(t('jobs.errors.deleteFailed'), 'error')
    }
  }, [deleteJobMutation, showToast, t])

  // Handler: Resume cancelled job (with optimistic update to prevent visual jump)
  const handleResumeJob = useCallback(async (job: TTSJob) => {
    try {
      // Show toast immediately for instant feedback
      showToast(t('jobs.messages.resumeSuccess'), 'success')
      // API call happens in background (SSE will update the UI)
      await resumeJobMutation.mutateAsync(job.id)
    } catch (err) {
      logger.error('[JobsPanelDialog] Failed to resume job:', err)
      showToast(t('jobs.errors.resumeFailed'), 'error')
    }
  }, [resumeJobMutation, showToast, t])

  // Handler: Clear all finished jobs
  const handleClearHistory = useCallback(async () => {
    try {
      await clearHistoryMutation.mutateAsync()
      showToast(t('jobs.messages.clearHistorySuccess'), 'success')
    } catch (err) {
      logger.error('[JobsPanelDialog] Failed to clear history:', err)
      showToast(t('jobs.errors.clearHistoryFailed'), 'error')
    }
  }, [clearHistoryMutation, showToast, t])

  // Format timestamp
  const formatTimestamp = useCallback((timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), {
        addSuffix: true,
        locale: dateLocale,
      })
    } catch {
      return timestamp
    }
  }, [dateLocale])

  // Job section component
  const JobSection = useCallback(({
    title,
    jobs,
    expanded,
    onToggle,
    emptyMessage,
  }: {
    title: string
    jobs: TTSJob[]
    expanded: boolean
    onToggle: () => void
    emptyMessage: string
  }) => (
    <Box sx={{ mb: 2 }}>
      <Button
        fullWidth
        onClick={onToggle}
        endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
        sx={{
          justifyContent: 'space-between',
          textTransform: 'none',
          py: 1,
          px: 2,
          bgcolor: 'action.hover',
          '&:hover': {
            bgcolor: 'action.selected',
          },
        }}
      >
        <Typography variant="subtitle2" fontWeight="bold">
          {title} ({jobs.length})
        </Typography>
      </Button>
      <Collapse in={expanded}>
        <Box sx={{ mt: 1 }}>
          {jobs.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              align="center"
              sx={{ py: 3 }}
            >
              {emptyMessage}
            </Typography>
          ) : (
            <List sx={{ p: 0 }}>
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onPause={handlePauseJob}
                  onResume={handleResumeJob}
                  onDelete={handleDeleteJob}
                  isPauseDisabled={cancelJobMutation.isPending}
                  isResumeDisabled={resumeJobMutation.isPending}
                  isDeleteDisabled={deleteJobMutation.isPending}
                />
              ))}
            </List>
          )}
        </Box>
      </Collapse>
    </Box>
  ), [handlePauseJob, handleResumeJob, handleDeleteJob, cancelJobMutation.isPending, resumeJobMutation.isPending, deleteJobMutation.isPending])

  // Add CSS animation for rotating icon
  useEffect(() => {
    const style = document.createElement('style')
    style.innerHTML = `
      @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .rotating-icon {
        animation: rotate 2s linear infinite;
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '60vh',
            maxHeight: '85vh',
          },
        }}
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">{t('appLayout.jobs.title')}</Typography>
            <Box display="flex" gap={1} alignItems="center">
              {/* Clear History Button */}
              {finishedJobs.length > 0 && (
                <Button
                  size="small"
                  startIcon={<DeleteSweepIcon />}
                  onClick={handleClearHistory}
                  disabled={clearHistoryMutation.isPending}
                  sx={{ textTransform: 'none' }}
                >
                  {t('jobs.actions.clearHistory')}
                </Button>
              )}
              <IconButton onClick={onClose} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ p: 2 }}>
          {isLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <Typography color="text.secondary">{t('common.loading')}</Typography>
            </Box>
          ) : jobs.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" py={6}>
              <HourglassEmpty sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                {t('appLayout.jobs.noJobs')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('appLayout.jobs.noJobsDescription')}
              </Typography>
            </Box>
          ) : (
            <>
              {/* Active Jobs Section */}
              {activeJobs.length > 0 && (
                <JobSection
                  title={t('jobs.sections.active')}
                  jobs={activeJobs}
                  expanded={expandedSections.active}
                  onToggle={() => toggleSection('active')}
                  emptyMessage={t('appLayout.jobs.noActiveJobs')}
                />
              )}

              {/* Finished Jobs Section */}
              <JobSection
                title={t('jobs.sections.finished')}
                jobs={finishedJobs}
                expanded={expandedSections.finished}
                onToggle={() => toggleSection('finished')}
                emptyMessage={t('appLayout.jobs.noFinishedJobs')}
              />

              {/* Last Updated Indicator */}
              <Typography
                variant="caption"
                color="text.disabled"
                align="center"
                display="block"
                sx={{ mt: 2 }}
              >
                {t('jobs.lastUpdated')}: {formatTimestamp(new Date(dataUpdatedAt).toISOString())}
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={handleToastClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleToastClose}
          severity={toast.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  )
}
