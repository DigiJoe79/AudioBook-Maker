
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  Paper,
  Typography,
  Chip,
  Stack,
  LinearProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  Description,
  CheckCircle,
  Error,
  HourglassEmpty,
  Loop,
} from '@mui/icons-material'
import type { Chapter } from '../types'
import { useAppStore } from '../store/appStore'

interface ChapterListProps {
  chapters: Chapter[]
  selectedChapterId?: string | null
  onChapterClick?: (chapter: Chapter) => void
}

export default function ChapterList({
  chapters,
  selectedChapterId,
  onChapterClick,
}: ChapterListProps) {
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500

  const getChapterStats = (chapter: Chapter) => {
    const segments = chapter.segments || []
    const total = segments.filter(s => s.segmentType !== 'divider').length
    const completed = segments.filter(s => s.status === 'completed' && s.segmentType !== 'divider').length
    const processing = segments.filter(s => s.status === 'processing' && s.segmentType !== 'divider').length
    const failed = segments.filter(s => s.status === 'failed' && s.segmentType !== 'divider').length
    const pending = segments.filter(s => s.status === 'pending' && s.segmentType !== 'divider').length

    const progress = total > 0 ? (completed / total) * 100 : 0

    return { total, completed, processing, failed, pending, progress }
  }

  const getStatusIcon = (stats: ReturnType<typeof getChapterStats>) => {
    if (stats.processing > 0) {
      return <Loop sx={{ fontSize: 20, color: 'warning.main' }} />
    }
    if (stats.failed > 0) {
      return <Error sx={{ fontSize: 20, color: 'error.main' }} />
    }
    if (stats.completed === stats.total && stats.total > 0) {
      return <CheckCircle sx={{ fontSize: 20, color: 'success.main' }} />
    }
    if (stats.pending > 0) {
      return <HourglassEmpty sx={{ fontSize: 20, color: 'text.disabled' }} />
    }
    return <Description sx={{ fontSize: 20, color: 'text.disabled' }} />
  }

  const getStatusColor = (stats: ReturnType<typeof getChapterStats>) => {
    if (stats.processing > 0) return 'warning.main'
    if (stats.failed > 0) return 'error.main'
    if (stats.completed === stats.total && stats.total > 0) return 'success.main'
    return 'action.hover'
  }

  const formatDuration = (segments: any[]) => {
    if (!segments || segments.length === 0) return '0s'

    let totalMs = 0

    const standardSegments = segments.filter(s => s.segmentType !== 'divider')
    totalMs += standardSegments.reduce((sum, s) => sum + ((s.endTime - s.startTime) * 1000), 0)

    const dividerSegments = segments.filter(s => s.segmentType === 'divider')
    totalMs += dividerSegments.reduce((sum, s) => sum + (s.pauseDuration || 0), 0)

    if (segments.length > 1) {
      totalMs += (segments.length - 1) * pauseBetweenSegments
    }

    const totalSeconds = Math.floor(totalMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  if (chapters.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%', 
          py: 8,
          px: 3,
        }}
      >
        <Description sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          {t('chapterList.noChapters')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('chapterList.createFirstChapter')}
        </Typography>
      </Box>
    )
  }

  return (
    <List sx={{ width: '100%', p: 0 }}>
      {chapters.map((chapter, index) => {
        const stats = getChapterStats(chapter)
        const isSelected = selectedChapterId === chapter.id
        const statusColor = getStatusColor(stats)

        return (
          <Paper
            key={chapter.id}
            elevation={isSelected ? 2 : 0}
            sx={{
              mb: 1,
              bgcolor: isSelected ? 'action.selected' : 'background.paper',
              borderLeft: 3,
              borderColor: statusColor,
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: 'action.hover',
                elevation: 1,
              },
            }}
          >
            <ListItem disablePadding>
              <ListItemButton
                selected={isSelected}
                onClick={() => onChapterClick?.(chapter)}
                sx={{ py: 2, px: 2 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 2 }}>
                  <Box sx={{ pt: 0.5 }}>
                    {getStatusIcon(stats)}
                  </Box>

                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          bgcolor: 'action.selected',
                          px: 1,
                          py: 0.25,
                          borderRadius: 1,
                          fontWeight: 'medium',
                        }}
                      >
                        #{index + 1}
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {chapter.title}
                      </Typography>
                    </Box>

                    {stats.total > 0 && (
                      <Box sx={{ mb: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={stats.progress}
                          sx={{
                            height: 6,
                            borderRadius: 3,
                            bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: stats.failed > 0 ? 'error.main' :
                                       stats.processing > 0 ? 'warning.main' :
                                       'success.main',
                            },
                          }}
                        />
                      </Box>
                    )}

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>

                      {stats.completed > 0 && (
                        <Chip
                          size="small"
                          icon={<CheckCircle />}
                          label={stats.completed}
                          color="success"
                          variant={stats.completed === stats.total ? 'filled' : 'outlined'}
                        />
                      )}

                      {stats.processing > 0 && (
                        <Chip
                          size="small"
                          icon={<Loop />}
                          label={stats.processing}
                          color="warning"
                        />
                      )}

                      {stats.failed > 0 && (
                        <Chip
                          size="small"
                          icon={<Error />}
                          label={stats.failed}
                          color="error"
                        />
                      )}

                      {stats.pending > 0 && (
                        <Chip
                          size="small"
                          icon={<HourglassEmpty />}
                          label={stats.pending}
                          variant="outlined"
                        />
                      )}

                      {stats.completed > 0 && (
                        <Chip
                          size="small"
                          label={formatDuration(chapter.segments)}
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Box>
                </Box>
              </ListItemButton>
            </ListItem>
          </Paper>
        )
      })}
    </List>
  )
}
