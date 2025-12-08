/**
 * ImportPreviewPanel - Preview panel for markdown import
 *
 * Displays parsed markdown structure before import:
 * - Project info (title, description)
 * - Statistics (chapters, segments, characters)
 * - Warnings (critical, warning, info)
 * - Chapter list with counts
 */

import React, { memo } from 'react'
import {
  Box,
  Paper,
  Typography,
  Alert,
  List,
  ListItem,
  Stack,
  Divider,
  CircularProgress,
  Chip,
} from '@mui/material'
import {
  UploadFile as UploadIcon,
  Info as InfoIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Description as ChapterIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { translateBackendError } from '@utils/translateBackendError'
import type { ImportPreviewResponse, ChapterPreview } from '../../types/import'
// SegmentPreview - Commented out (not used in preview anymore)

interface ImportPreviewPanelProps {
  previewData: ImportPreviewResponse | null
  loading?: boolean
  importing?: boolean
}

const ImportPreviewPanel = memo(({ previewData, loading, importing }: ImportPreviewPanelProps) => {
  const { t } = useTranslation()

  // Loading state
  if (loading) {
    return (
      <Box
        data-testid="import-preview-loading"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
        }}
      >
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            {t('import.preview.loading')}
          </Typography>
        </Stack>
      </Box>
    )
  }

  // Empty state
  if (!previewData) {
    return (
      <Box
        data-testid="import-preview-empty"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
        }}
      >
        <Box
          sx={{
            textAlign: 'center',
            maxWidth: 400,
          }}
        >
          <UploadIcon
            sx={{
              fontSize: 100,
              color: 'text.secondary',
              opacity: 0.3,
              mb: 3,
            }}
          />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('import.preview.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('import.preview.emptyDescription')}
          </Typography>
        </Box>
      </Box>
    )
  }

  // Format number with thousand separators
  const formatNumber = (num: number | undefined | null): string => {
    if (num === undefined || num === null) {
      return '0'
    }
    return num.toLocaleString()
  }

  // Get character count from stats (segments are no longer included in preview)
  const getChapterCharCount = (chapter: ChapterPreview): number => {
    return chapter.stats?.totalChars ?? 0
  }

  // Get severity icon
  const getSeverityIcon = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return <ErrorIcon fontSize="small" />
      case 'warning':
        return <WarningIcon fontSize="small" />
      case 'info':
        return <InfoIcon fontSize="small" />
    }
  }

  // Map severity to MUI Alert severity
  const getSeverityType = (severity: 'critical' | 'warning' | 'info'): 'error' | 'warning' | 'info' => {
    if (severity === 'critical') return 'error'
    return severity
  }

  return (
    <Box
      data-testid="import-preview-content"
      sx={{
        flex: 1,
        position: 'relative',
        overflowY: 'auto',
        overflowX: 'hidden',
        p: 2,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          background: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
          borderRadius: '4px',
          '&:hover': {
            background: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)',
          },
        },
      }}
    >
      <Stack spacing={3}>
        {/* Project Info Card */}
        <Paper
          data-testid="import-preview-project-info"
          sx={{
            p: 2.5,
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {t('import.preview.projectInfo')}
          </Typography>
          <Typography
            variant="h6"
            sx={{
              mb: previewData.project.description ? 1 : 0,
              fontWeight: 600,
            }}
          >
            {previewData.project.title}
          </Typography>
          {previewData.project.description && (
            <Typography variant="body2" color="text.secondary">
              {previewData.project.description}
            </Typography>
          )}
        </Paper>

        {/* Statistics Card */}
        <Paper
          data-testid="import-preview-statistics"
          sx={{
            p: 2.5,
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {t('import.preview.statistics')}
          </Typography>
          <Stack direction="row" spacing={3} flexWrap="wrap">
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('import.preview.totalChapters')}
              </Typography>
              <Typography variant="h5" fontWeight="bold">
                {formatNumber(previewData.stats.totalChapters)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('import.preview.totalSegments')}
              </Typography>
              <Typography variant="h5" fontWeight="bold">
                {formatNumber(previewData.stats.totalSegments)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('import.preview.totalCharacters')}
              </Typography>
              <Typography variant="h5" fontWeight="bold">
                {formatNumber(previewData.stats.totalChars)}
              </Typography>
            </Box>
            {previewData.stats.estimatedDuration && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {t('import.preview.estimatedDuration')}
                </Typography>
                <Typography variant="h5" fontWeight="bold">
                  {previewData.stats.estimatedDuration}
                </Typography>
              </Box>
            )}
          </Stack>
        </Paper>

        {/* Global Warnings */}
        {previewData.globalWarnings.length > 0 && (
          <Paper
            data-testid="import-preview-warnings"
            sx={{
              p: 2.5,
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mb: 1.5,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {t('import.preview.warnings')}
            </Typography>
            <Stack spacing={1}>
              {previewData.globalWarnings.map((warning, index) => (
                <Alert
                  key={`${warning.type}-${warning.severity}-${index}`}
                  severity={getSeverityType(warning.severity)}
                  icon={getSeverityIcon(warning.severity)}
                  sx={{
                    fontSize: '0.875rem',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                >
                  {translateBackendError(warning.message, t)}
                </Alert>
              ))}
            </Stack>
          </Paper>
        )}

        {/* Chapters List */}
        <Paper
          data-testid="import-preview-chapters"
          sx={{
            p: 2.5,
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {t('import.preview.chapters')} ({previewData.chapters.length})
          </Typography>
          <List sx={{ p: 0 }}>
            {previewData.chapters.map((chapter, index) => (
              <React.Fragment key={chapter.id}>
                {index > 0 && <Divider sx={{ my: 1.5 }} />}
                <ListItem
                  data-testid={`import-preview-chapter-${chapter.id}`}
                  sx={{
                    p: 1.5,
                    bgcolor: 'background.paper',
                    borderRadius: 1,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                  }}
                >
                  {/* Chapter Title + Stats */}
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{
                      width: '100%',
                      mb: chapter.warnings.length > 0 ? 1 : 0
                    }}
                  >
                    <ChapterIcon fontSize="small" color="action" />
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        flex: 1,
                      }}
                    >
                      {chapter.title}
                    </Typography>

                    {/* Chapter Stats - Right aligned */}
                    <Stack direction="row" spacing={1}>
                      {(chapter.stats?.failedCount ?? 0) > 0 && (
                        <Chip
                          label={`${formatNumber(chapter.stats.failedCount)} ${t('import.preview.failed')}`}
                          size="small"
                          variant="outlined"
                          color="warning"
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                      <Chip
                        label={`${formatNumber(chapter.stats?.segmentCount ?? 0)} ${t('import.preview.segments')}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.75rem' }}
                      />
                      <Chip
                        label={`${formatNumber(getChapterCharCount(chapter))} ${t('import.preview.characters')}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    </Stack>
                  </Stack>

                  {/* Chapter Warnings */}
                  {chapter.warnings.length > 0 && (
                    <Stack spacing={0.5} sx={{ ml: 4, mt: 1, width: 'calc(100% - 32px)' }}>
                      {chapter.warnings.map((warning, wIndex) => (
                        <Alert
                          key={wIndex}
                          severity={getSeverityType(warning.severity)}
                          icon={getSeverityIcon(warning.severity)}
                          sx={{
                            fontSize: '0.75rem',
                            py: 0.25,
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                          }}
                        >
                          {translateBackendError(warning.message, t)}
                        </Alert>
                      ))}
                    </Stack>
                  )}
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        </Paper>

        {/* Validation Status */}
        {!previewData.isValid && (
          <Alert severity="error" icon={<ErrorIcon />}>
            {t('import.preview.invalidStatus')}
          </Alert>
        )}
      </Stack>

      {/* Importing Overlay - Semi-transparent */}
      {importing && (
        <Box
          data-testid="import-preview-importing"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 10,
          }}
        >
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={48} />
            <Typography variant="body1" color="text.primary" fontWeight={500}>
              {t('import.actions.importing')}
            </Typography>
          </Stack>
        </Box>
      )}
    </Box>
  )
})

ImportPreviewPanel.displayName = 'ImportPreviewPanel'

export default ImportPreviewPanel
