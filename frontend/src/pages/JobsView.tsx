/**
 * JobsView - Job Monitoring
 *
 * Full-screen job monitoring extracted from JobsPanelDialog.
 * Provides more vertical space for viewing more jobs simultaneously.
 *
 * @param embedded - When true, renders without ViewContainer/ViewHeader/ViewFooter (for use in MonitoringView tabs)
 */

import React, { useState, useCallback, useEffect, useMemo, memo } from 'react'
import {
  Box,
  Typography,
  Button,
  IconButton,
  List,
  Paper,
  Chip,
  LinearProgress,
  Stack,
  Alert,
  alpha,
  useTheme,
  CircularProgress,
} from '@mui/material'
import {
  CheckCircle,
  Error as ErrorIcon,
  Pause,
  HourglassEmpty,
  PlayArrow,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
  Loop,
  Work as JobsIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useTTSJobs, useDeleteJob, useClearJobHistory, useResumeJob, useCancelJob } from '@hooks/useTTSQuery'
import { useSnackbar } from '@hooks/useSnackbar'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { TTSJob } from '@types'
import { logger } from '@utils/logger'
import { translateBackendError } from '@utils/translateBackendError'
import {
  ViewContainer,
  ViewHeader,
  ViewFooter,
} from '@components/layout/ViewComponents'
import { Section, EmptyState } from '@components/shared'

interface JobCardProps {
  job: TTSJob
  onPause: (job: TTSJob) => void
  onResume: (job: TTSJob) => void
  onDelete: (job: TTSJob) => void
  isPauseDisabled: boolean
  isResumeDisabled: boolean
  isDeleteDisabled: boolean
}

const JobCard = memo(
  ({ job, onPause, onResume, onDelete, isPauseDisabled, isResumeDisabled, isDeleteDisabled }: JobCardProps) => {
    const { t, i18n } = useTranslation()
    const theme = useTheme()
    const dateLocale = i18n.language === 'de' ? de : enUS
    const [isHovered, setIsHovered] = useState(false)

    const getStatusConfig = useCallback(
      (status: string) => {
        switch (status) {
          case 'running':
            return {
              icon: <Loop sx={{ fontSize: 24 }} className="rotating-icon" />,
              color: 'warning.main',
              bgColor: alpha(theme.palette.warning.main, 0.08),
              label: t('jobs.status.running'),
              chipColor: 'warning' as const,
            }
          case 'completed':
            return {
              icon: <CheckCircle sx={{ fontSize: 24 }} />,
              color: 'success.main',
              bgColor: alpha(theme.palette.success.main, 0.08),
              label: t('jobs.status.completed'),
              chipColor: 'success' as const,
            }
          case 'failed':
            return {
              icon: <ErrorIcon sx={{ fontSize: 24 }} />,
              color: 'error.main',
              bgColor: alpha(theme.palette.error.main, 0.08),
              label: t('jobs.status.failed'),
              chipColor: 'error' as const,
            }
          case 'cancelled':
          case 'cancelling':
            return {
              icon: <Pause sx={{ fontSize: 24 }} />,
              color: 'info.main',
              bgColor: alpha(theme.palette.info.main, 0.08),
              label: t('jobs.status.paused'),
              chipColor: 'default' as const,
            }
          case 'pending':
            return {
              icon: <HourglassEmpty sx={{ fontSize: 24 }} />,
              color: 'info.main',
              bgColor: alpha(theme.palette.info.main, 0.08),
              label: t('jobs.status.pending'),
              chipColor: 'info' as const,
            }
          default:
            return {
              icon: <HourglassEmpty sx={{ fontSize: 24 }} />,
              color: 'text.disabled',
              bgColor: alpha(theme.palette.action.disabled, 0.08),
              label: status,
              chipColor: 'default' as const,
            }
        }
      },
      [t, theme.palette]
    )

    const formatTimestamp = useCallback(
      (timestamp: string | Date) => {
        try {
          const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
          return formatDistanceToNow(date, { addSuffix: true, locale: dateLocale })
        } catch {
          return String(timestamp)
        }
      },
      [dateLocale]
    )

    const statusConfig = getStatusConfig(job.status)
    const progress = useMemo(() => {
      if (!job.totalSegments || job.totalSegments === 0) return 0
      const calculated = (job.processedSegments / job.totalSegments) * 100
      return Math.max(0, Math.min(100, calculated))
    }, [job.processedSegments, job.totalSegments])

    const remaining = job.totalSegments - job.processedSegments - (job.failedSegments || 0)
    const hasActions = job.status === 'running' || job.status === 'pending' || job.status === 'cancelled' || job.status === 'cancelling' || job.status === 'completed' || job.status === 'failed'
    const showActions = isHovered || job.status === 'running' || job.status === 'pending'

    // Build job title: "Project / Chapter (Engine)"
    const jobTitle = useMemo(() => {
      // Build location part
      let location = ''
      if (job.projectTitle && job.chapterTitle) {
        location = `${job.projectTitle} / ${job.chapterTitle}`
      } else if (job.chapterTitle) {
        location = job.chapterTitle
      } else if (job.projectTitle) {
        location = job.projectTitle
      }

      // Build engine part (TTS engine name)
      const engineStr = job.ttsEngine ? `(${job.ttsEngine})` : ''

      // Combine
      if (location && engineStr) {
        return `${location} ${engineStr}`
      } else if (location) {
        return location
      } else if (engineStr) {
        return engineStr
      }
      return t('appLayout.jobs.noTitle')
    }, [job.projectTitle, job.chapterTitle, job.ttsEngine, t])

    return (
      <Paper
        elevation={isHovered ? 4 : 1}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-testid={`tts-job-item-${job.id}`}
        sx={{
          mb: 2,
          borderRadius: 2,
          overflow: 'hidden',
          transition: 'all 0.2s ease',
          transform: isHovered ? 'translateY(-2px)' : 'none',
          bgcolor: 'background.paper',
        }}
      >
        {/* Header Row: Status Icon + Title + Timestamp */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.5,
            bgcolor: (job.status === 'running' || job.status === 'pending') ? statusConfig.bgColor : 'transparent',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ color: statusConfig.color, display: 'flex', alignItems: 'center' }}>
            {statusConfig.icon}
          </Box>

          <Typography
            variant="body1"
            sx={{
              fontWeight: 500,
              flexGrow: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {jobTitle}
          </Typography>

          <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
            {formatTimestamp(
              (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed')
                ? (job.completedAt || job.createdAt)
                : (job.status === 'running' || job.status === 'cancelling')
                  ? (job.startedAt || job.createdAt)
                  : job.createdAt
            )}
          </Typography>
        </Box>

        {/* Progress Section */}
        <Box sx={{ px: 2, py: 1.5 }}>
          {/* Progress Bar with integrated percentage */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
            <Box sx={{ flexGrow: 1, position: 'relative' }}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: alpha(theme.palette.action.disabled, 0.2),
                  '& .MuiLinearProgress-bar': {
                    bgcolor: statusConfig.color,
                    borderRadius: 4,
                    transition: 'transform 0.5s ease',
                  },
                }}
              />
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                color: statusConfig.color,
                minWidth: 48,
                textAlign: 'right',
              }}
            >
              {progress.toFixed(0)}%
            </Typography>
          </Box>

          {/* Chips Row + Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label={statusConfig.label}
                color={statusConfig.chipColor}
                variant={job.status === 'completed' ? 'filled' : 'outlined'}
                sx={{ height: 24, fontSize: '0.75rem' }}
              />
              {job.totalSegments > 0 && (
                <Chip
                  size="small"
                  label={`${job.processedSegments} / ${job.totalSegments}`}
                  color="success"
                  variant={job.processedSegments === job.totalSegments ? 'filled' : 'outlined'}
                  sx={{ height: 24, fontSize: '0.75rem' }}
                />
              )}
              {(job.failedSegments || 0) > 0 && (
                <Chip
                  size="small"
                  label={`${job.failedSegments} ${t('jobs.failed')}`}
                  color="error"
                  variant="filled"
                  sx={{ height: 24, fontSize: '0.75rem' }}
                />
              )}
              {remaining > 0 && (job.status === 'running' || job.status === 'pending') && (
                <Chip
                  size="small"
                  label={`${remaining} ${t('jobs.remaining')}`}
                  variant="outlined"
                  sx={{ height: 24, fontSize: '0.75rem' }}
                />
              )}
            </Stack>

            {/* Action Buttons - show on hover or for active jobs */}
            {hasActions && (
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  opacity: showActions ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                }}
              >
                {(job.status === 'running' || job.status === 'pending') && (
                  <IconButton
                    size="small"
                    onClick={() => onPause(job)}
                    disabled={isPauseDisabled}
                    data-testid={`tts-job-cancel-${job.id}`}
                    sx={{
                      bgcolor: alpha(theme.palette.warning.main, 0.1),
                      '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.2) },
                    }}
                  >
                    <Pause color="warning" fontSize="small" />
                  </IconButton>
                )}

                {job.status === 'cancelled' && (
                  <IconButton
                    size="small"
                    onClick={() => onResume(job)}
                    disabled={isResumeDisabled}
                    data-testid={`tts-job-resume-${job.id}`}
                    sx={{
                      bgcolor: alpha(theme.palette.success.main, 0.1),
                      '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.2) },
                    }}
                  >
                    <PlayArrow color="success" fontSize="small" />
                  </IconButton>
                )}

                {(job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') && (
                  <IconButton
                    size="small"
                    onClick={() => onDelete(job)}
                    disabled={isDeleteDisabled}
                    data-testid={`tts-job-delete-${job.id}`}
                    sx={{
                      bgcolor: alpha(theme.palette.error.main, 0.1),
                      '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) },
                    }}
                  >
                    <DeleteIcon color="error" fontSize="small" />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

          {/* Error Message */}
          {job.status === 'failed' && job.errorMessage && (
            <Alert severity="error" sx={{ mt: 1.5, py: 0.5 }}>
              <Typography variant="caption">{translateBackendError(job.errorMessage, t)}</Typography>
            </Alert>
          )}
        </Box>
      </Paper>
    )
  },
  (prevProps, nextProps) => {
    const prev = prevProps.job
    const next = nextProps.job

    const propsChanged = prevProps.isPauseDisabled !== nextProps.isPauseDisabled || prevProps.isResumeDisabled !== nextProps.isResumeDisabled || prevProps.isDeleteDisabled !== nextProps.isDeleteDisabled

    const shouldSkipRerender =
      !propsChanged &&
      prev.id === next.id &&
      prev.status === next.status &&
      prev.processedSegments === next.processedSegments &&
      prev.totalSegments === next.totalSegments &&
      prev.failedSegments === next.failedSegments &&
      prev.errorMessage === next.errorMessage &&
      prev.currentSegmentId === next.currentSegmentId &&
      prev.chapterTitle === next.chapterTitle &&
      prev.projectTitle === next.projectTitle &&
      prev.startedAt === next.startedAt &&
      prev.completedAt === next.completedAt

    return shouldSkipRerender
  }
)

JobCard.displayName = 'JobCard'

interface JobsViewProps {
  embedded?: boolean
}

const JobsView = memo(({ embedded = false }: JobsViewProps) => {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language === 'de' ? de : enUS
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  const [expandedSections, setExpandedSections] = useState({ active: true, finished: true })

  const { data: jobsData, isLoading, dataUpdatedAt } = useTTSJobs({ limit: 50 }, { refetchInterval: false })
  const jobs = jobsData?.jobs ?? []

  const deleteJobMutation = useDeleteJob()
  const clearHistoryMutation = useClearJobHistory()
  const resumeJobMutation = useResumeJob()
  const cancelJobMutation = useCancelJob()

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === 'pending' || job.status === 'running' || job.status === 'cancelled' || job.status === 'cancelling'), [jobs])
  const finishedJobs = useMemo(() => jobs.filter((job) => job.status === 'completed' || job.status === 'failed'), [jobs])

  const handlePauseJob = useCallback(
    async (job: TTSJob) => {
      try {
        await cancelJobMutation.mutateAsync(job.id)
        showSnackbar(t('jobs.messages.pauseSuccess'), { severity: 'success' })
      } catch (err: unknown) {
        logger.error('[JobsView] Failed to pause job:', err)
        const errorMessage = translateBackendError(
          err instanceof Error ? err.message : t('jobs.errors.pauseFailed'),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
      }
    },
    [cancelJobMutation, showSnackbar, t]
  )

  const handleDeleteJob = useCallback(
    async (job: TTSJob) => {
      try {
        await deleteJobMutation.mutateAsync(job.id)
        showSnackbar(t('jobs.messages.deleteSuccess'), { severity: 'success' })
      } catch (err: unknown) {
        logger.error('[JobsView] Failed to delete job:', err)
        const errorMessage = translateBackendError(
          err instanceof Error ? err.message : t('jobs.errors.deleteFailed'),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
      }
    },
    [deleteJobMutation, showSnackbar, t]
  )

  const handleResumeJob = useCallback(
    async (job: TTSJob) => {
      try {
        await resumeJobMutation.mutateAsync(job.id)
        showSnackbar(t('jobs.messages.resumeSuccess'), { severity: 'success' })
      } catch (err: unknown) {
        logger.error('[JobsView] Failed to resume job:', err)
        const errorMessage = translateBackendError(
          err instanceof Error ? err.message : t('jobs.errors.resumeFailed'),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
      }
    },
    [resumeJobMutation, showSnackbar, t]
  )

  const handleClearHistory = useCallback(async () => {
    try {
      await clearHistoryMutation.mutateAsync()
      showSnackbar(t('jobs.messages.clearHistorySuccess'), { severity: 'success' })
    } catch (err: unknown) {
      logger.error('[JobsView] Failed to clear history:', err)
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('jobs.errors.clearHistoryFailed'),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
    }
  }, [clearHistoryMutation, showSnackbar, t])

  const formatTimestamp = useCallback(
    (timestamp: string | Date) => {
      try {
        const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
        return formatDistanceToNow(date, { addSuffix: true, locale: dateLocale })
      } catch {
        return String(timestamp)
      }
    },
    [dateLocale]
  )


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

  // Render content (jobs list + footer)
  const content = (
    <>
      {/* Content */}
      <Box
        sx={{
          flex: 1,
          padding: '24px',
          bgcolor: 'background.default',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {isLoading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
            <Typography color="text.secondary" sx={{ ml: 2 }}>
              {t('common.loading')}
            </Typography>
          </Box>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<HourglassEmpty />}
            message={t('appLayout.jobs.noJobs')}
            description={t('appLayout.jobs.noJobsDescription')}
          />
        ) : (
          <>
            {/* Active Jobs Section */}
            {activeJobs.length > 0 && (
              <Section
                title={t('jobs.sections.active')}
                count={activeJobs.length}
                defaultCollapsed={!expandedSections.active}
                data-testid="tts-jobs-active-section"
              >
                <List sx={{ p: 0 }} data-testid="tts-jobs-active-list">
                  {activeJobs.map((job) => (
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
              </Section>
            )}

            {/* Finished Jobs Section */}
            <Section
              title={t('jobs.sections.finished')}
              count={finishedJobs.length}
              defaultCollapsed={!expandedSections.finished}
              data-testid="tts-jobs-finished-section"
            >
              {finishedJobs.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle />}
                  message={t('appLayout.jobs.noFinishedJobs')}
                  sx={{ py: 3 }}
                />
              ) : (
                <List sx={{ p: 0 }} data-testid="tts-jobs-finished-list">
                  {finishedJobs.map((job) => (
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
            </Section>
          </>
        )}
      </Box>

      {/* Footer */}
      {jobs.length > 0 && (
        <ViewFooter
          status={
            <Stack direction="row" spacing={2} divider={<Box sx={{ width: '1px', height: '12px', bgcolor: 'divider' }} />}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('jobs.totalJobs', { count: jobs.length })}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('jobs.lastUpdated')}: {formatTimestamp(new Date(dataUpdatedAt).toISOString())}
              </Typography>
            </Stack>
          }
        />
      )}
    </>
  )

  // Render embedded or standalone
  if (embedded) {
    return (
      <>
        {content}
        {/* Snackbar notifications */}
        <SnackbarComponent />
      </>
    )
  }

  // Standalone mode with header and actions
  return (
    <>
      <ViewContainer>
        {/* ViewHeader */}
        <ViewHeader
          title={t('appLayout.jobs.title')}
          icon={<JobsIcon />}
          actions={
            finishedJobs.length > 0 && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<DeleteSweepIcon />}
                onClick={handleClearHistory}
                disabled={clearHistoryMutation.isPending}
              >
                {t('jobs.actions.clearHistory')}
              </Button>
            )
          }
        />

        {content}
      </ViewContainer>

      {/* Snackbar notifications */}
      <SnackbarComponent />
    </>
  )
})

JobsView.displayName = 'JobsView'

export default JobsView
