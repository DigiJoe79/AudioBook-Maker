/**
 * ChapterList - Display chapters with status information
 * Similar to SegmentList but for chapter overview
 *
 * Performance optimizations:
 * - React.memo on ChapterItem with custom comparison
 * - useMemo for computed values (stats, statusColor)
 * - useCallback for click handler
 */

import React, { useMemo, useCallback } from 'react'
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
import type { Chapter } from '@types'
import { useAppStore } from '@store/appStore'

interface ChapterStats {
  total: number
  completed: number
  processing: number
  queued: number
  failed: number
  pending: number
  progress: number
}

interface ChapterItemProps {
  chapter: Chapter
  index: number
  isSelected: boolean
  stats: ChapterStats
  pauseBetweenSegments: number
  onChapterClick?: (chapter: Chapter) => void
}

interface ChapterListProps {
  chapters: Chapter[]
  selectedChapterId?: string | null
  onChapterClick?: (chapter: Chapter) => void
}

/**
 * Helper functions - extracted for use in memoization
 */
const getStatusIcon = (stats: ChapterStats) => {
  if (stats.processing > 0) {
    return <Loop sx={{ fontSize: 20, color: 'warning.main' }} />
  }
  if (stats.failed > 0) {
    return <Error sx={{ fontSize: 20, color: 'error.main' }} />
  }
  if (stats.completed === stats.total && stats.total > 0) {
    return <CheckCircle sx={{ fontSize: 20, color: 'success.main' }} />
  }
  if (stats.queued > 0) {
    return <HourglassEmpty sx={{ fontSize: 20, color: 'warning.main' }} />
  }
  if (stats.pending > 0) {
    return <HourglassEmpty sx={{ fontSize: 20, color: 'text.disabled' }} />
  }
  return <Description sx={{ fontSize: 20, color: 'text.disabled' }} />
}

const getStatusColor = (stats: ChapterStats) => {
  if (stats.processing > 0) return 'warning.main'
  if (stats.queued > 0) return 'warning.main'
  if (stats.failed > 0) return 'error.main'
  if (stats.completed === stats.total && stats.total > 0) return 'success.main'
  return 'action.hover'
}

/**
 * Memoized Chapter Item Component
 * Prevents re-renders when other chapters in the list change
 */
const ChapterItem = React.memo(function ChapterItem({
  chapter,
  index,
  isSelected,
  stats,
  pauseBetweenSegments,
  onChapterClick,
}: ChapterItemProps) {
  const { t } = useTranslation()

  // Memoize status color to prevent recalculation
  const statusColor = useMemo(() => getStatusColor(stats), [stats])

  // Memoize click handler
  const handleClick = useCallback(() => {
    onChapterClick?.(chapter)
  }, [chapter, onChapterClick])

  // Memoize duration calculation
  const duration = useMemo(() => {
    const segments = chapter.segments
    if (!segments || segments.length === 0) return '0s'

    let totalMs = 0

    // Add audio duration of standard segments
    const standardSegments = segments.filter(s => s.segmentType !== 'divider')
    totalMs += standardSegments.reduce((sum, s) => sum + ((s.endTime - s.startTime) * 1000), 0)

    // Add pause duration of divider segments
    const dividerSegments = segments.filter(s => s.segmentType === 'divider')
    totalMs += dividerSegments.reduce((sum, s) => sum + (s.pauseDuration || 0), 0)

    // Add pauses between segments (between all segments, not just standard ones)
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
  }, [chapter.segments, pauseBetweenSegments])

  return (
    <Paper
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
          onClick={handleClick}
          sx={{ py: 2, px: 2 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 2 }}>
            {/* Status Icon */}
            <Box sx={{ pt: 0.5 }}>
              {getStatusIcon(stats)}
            </Box>

            {/* Chapter Info */}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              {/* Title and Chapter Number */}
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

              {/* Progress Bar (only if there are segments) */}
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
                                 stats.queued > 0 ? 'warning.main' :
                                 'success.main',
                      },
                    }}
                  />
                </Box>
              )}

              {/* Status Chips */}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>

                {/* Completed */}
                {stats.completed > 0 && (
                  <Chip
                    size="small"
                    icon={<CheckCircle />}
                    label={stats.completed}
                    color="success"
                    variant={stats.completed === stats.total ? 'filled' : 'outlined'}
                  />
                )}

                {/* Processing */}
                {stats.processing > 0 && (
                  <Chip
                    size="small"
                    icon={<Loop />}
                    label={stats.processing}
                    color="warning"
                  />
                )}

                {/* Queued */}
                {stats.queued > 0 && (
                  <Chip
                    size="small"
                    icon={<HourglassEmpty />}
                    label={stats.queued}
                    color="warning"
                    variant="outlined"
                  />
                )}

                {/* Failed */}
                {stats.failed > 0 && (
                  <Chip
                    size="small"
                    icon={<Error />}
                    label={stats.failed}
                    color="error"
                  />
                )}

                {/* Pending */}
                {stats.pending > 0 && (
                  <Chip
                    size="small"
                    icon={<HourglassEmpty />}
                    label={stats.pending}
                    variant="outlined"
                  />
                )}

                {/* Duration (if audio exists) */}
                {stats.completed > 0 && (
                  <Chip
                    size="small"
                    label={duration}
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
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Only re-render if relevant props actually changed
  return (
    prevProps.chapter.id === nextProps.chapter.id &&
    prevProps.chapter.title === nextProps.chapter.title &&
    prevProps.index === nextProps.index &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.pauseBetweenSegments === nextProps.pauseBetweenSegments &&
    // Compare stats
    prevProps.stats.total === nextProps.stats.total &&
    prevProps.stats.completed === nextProps.stats.completed &&
    prevProps.stats.processing === nextProps.stats.processing &&
    prevProps.stats.queued === nextProps.stats.queued &&
    prevProps.stats.failed === nextProps.stats.failed &&
    prevProps.stats.pending === nextProps.stats.pending &&
    prevProps.stats.progress === nextProps.stats.progress &&
    // Compare segments for duration calculation (shallow check)
    prevProps.chapter.segments?.length === nextProps.chapter.segments?.length
  )
})

/**
 * Calculate chapter stats - memoization helper
 */
const calculateChapterStats = (chapter: Chapter): ChapterStats => {
  const segments = chapter.segments || []
  const total = segments.filter(s => s.segmentType !== 'divider').length
  const completed = segments.filter(s => s.status === 'completed' && s.segmentType !== 'divider').length
  const processing = segments.filter(s => s.status === 'processing' && s.segmentType !== 'divider').length
  const queued = segments.filter(s => s.status === 'queued' && s.segmentType !== 'divider').length
  const failed = segments.filter(s => s.status === 'failed' && s.segmentType !== 'divider').length
  const pending = segments.filter(s => s.status === 'pending' && s.segmentType !== 'divider').length

  const progress = total > 0 ? (completed / total) * 100 : 0

  return { total, completed, processing, queued, failed, pending, progress }
}

export default function ChapterList({
  chapters,
  selectedChapterId,
  onChapterClick,
}: ChapterListProps) {
  const { t } = useTranslation()

  // Get pause settings
  const settings = useAppStore((state) => state.settings)
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500

  // Memoize chapter stats to prevent recalculation on every render
  const chapterStatsMap = useMemo(() => {
    const map = new Map<string, ChapterStats>()
    chapters.forEach(chapter => {
      map.set(chapter.id, calculateChapterStats(chapter))
    })
    return map
  }, [chapters])

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
      {chapters.map((chapter, index) => (
        <ChapterItem
          key={chapter.id}
          chapter={chapter}
          index={index}
          isSelected={selectedChapterId === chapter.id}
          stats={chapterStatsMap.get(chapter.id)!}
          pauseBetweenSegments={pauseBetweenSegments}
          onChapterClick={onChapterClick}
        />
      ))}
    </List>
  )
}
