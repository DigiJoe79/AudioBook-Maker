/**
 * ChapterStreamPlayer Component
 *
 * Main audio player component using MediaSource Extensions:
 * - Integrates useMediaSourceStream + useSegmentPeaks + WaveformCanvas
 * - Playback controls
 * - Central update coordination via useAudioPlayerUpdate
 */

import React, { useEffect, useCallback, useState, useRef } from 'react'
import { Box, IconButton, Stack, Slider, Typography, Paper } from '@mui/material'
import {
  PlayArrow,
  Pause,
  VolumeUp,
  VolumeOff,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { logger } from '@/utils/logger'
import { useMediaSourceStream } from '@/hooks/useMediaSourceStream'
import { useSegmentPeaks } from '@/hooks/useSegmentPeaks'
import { useAudioPlayerUpdate } from '@/hooks/useAudioPlayerUpdate'
import { useChapter } from '@/hooks/useChaptersQuery'
import { usePlayerHotkeys } from '@/hooks/usePlayerHotkeys'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { useSnackbar } from '@/hooks/useSnackbar'
import WaveformCanvas from './WaveformCanvas'
import { useAppStore } from '@/store/appStore'

interface ChapterStreamPlayerProps {
  chapterId: string | null
  pauseBetweenSegments?: number
  seekToSegmentId?: string | null // Segment to seek to
  seekTrigger?: number // Increment to trigger seek even if same segment
  onCurrentSegmentChange?: (segmentId: string | null) => void // Callback when current playing segment changes
}

export default function ChapterStreamPlayer({
  chapterId,
  pauseBetweenSegments = 300, // 300ms default
  seekToSegmentId,
  seekTrigger,
  onCurrentSegmentChange,
}: ChapterStreamPlayerProps) {
  const { t } = useTranslation()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const settings = useAppStore(state => state.settings)

  // Get chapter data from React Query (single source of truth)
  const { data: chapter } = useChapter(chapterId)


  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)

  // Smooth playhead animation (interpolate between timeupdate events)
  const [displayTime, setDisplayTime] = useState(0)
  const lastUpdateTimeRef = useRef<number>(0)
  const lastAudioTimeRef = useRef<number>(0)

  // Reset playback state on chapter change
  useEffect(() => {
    setCurrentTime(0)
    setDisplayTime(0)
    setIsPlaying(false)
    lastUpdateTimeRef.current = 0
    lastAudioTimeRef.current = 0
  }, [chapterId])

  // Stable callbacks to prevent re-renders
  const handleStreamReady = useCallback(() => {
    // Stream ready - no logging needed
  }, [])

  const handleStreamError = useCallback((error: Error) => {
    logger.error('[ChapterStreamPlayer] Stream error', { error })
  }, [])

  // MediaSource stream
  const {
    audioElement,
    streamState,
    boundaries,
    updateSegment: updateAudioStream,
    invalidateCache: invalidateAudioCache,
  } = useMediaSourceStream({
    chapter: chapter || null,
    pauseBetweenSegments: settings?.audio?.pauseBetweenSegments || pauseBetweenSegments,
    onReady: handleStreamReady,
    onError: handleStreamError,
  })

  // Segment peaks
  const {
    peaks,
    isLoading: peaksLoading,
    invalidatePeaks,
    loadPeaksForSegment,
  } = useSegmentPeaks({
    chapter: chapter || null,
    peaksPerSecond: 35, // 35 peaks/second = optimized for smooth performance
  })

  // Central update coordinator
  const { updateSegment } = useAudioPlayerUpdate({
    chapterId,
    updateAudioStream,
    invalidateAudioCache,
    updatePeaks: loadPeaksForSegment,
    invalidatePeaksCache: invalidatePeaks,
  })

  // Register updateSegment with AudioPlayerContext
  // This allows centralized SSE handlers to trigger updates
  const { registerUpdateSegment } = useAudioPlayerContext()

  useEffect(() => {
    registerUpdateSegment(updateSegment)
  }, [registerUpdateSegment, updateSegment])

  // Audio element event handlers
  useEffect(() => {
    if (!audioElement) return

    const handleTimeUpdate = () => {
      const now = performance.now()
      const audioTime = audioElement.currentTime

      // Store the actual audio time and when we received it
      lastAudioTimeRef.current = audioTime
      lastUpdateTimeRef.current = now

      // Update React state (used for segment boundaries, etc.)
      setCurrentTime(audioTime)
      // Also update display time to sync with actual position
      setDisplayTime(audioTime)
    }

    const handlePlay = () => {
      setIsPlaying(true)
    }

    const handlePause = () => {
      setIsPlaying(false)
    }

    const handleEnded = () => {
      setIsPlaying(false)
    }

    audioElement.addEventListener('timeupdate', handleTimeUpdate)
    audioElement.addEventListener('play', handlePlay)
    audioElement.addEventListener('pause', handlePause)
    audioElement.addEventListener('ended', handleEnded)

    // Set volume
    audioElement.volume = volume / 100

    return () => {
      audioElement.removeEventListener('timeupdate', handleTimeUpdate)
      audioElement.removeEventListener('play', handlePlay)
      audioElement.removeEventListener('pause', handlePause)
      audioElement.removeEventListener('ended', handleEnded)
    }
  }, [audioElement, volume])

  // Smooth playhead interpolation (60fps animation loop)
  useEffect(() => {
    if (!isPlaying) return

    let animationFrameId: number

    const animate = () => {
      const now = performance.now()
      const timeSinceLastUpdate = (now - lastUpdateTimeRef.current) / 1000 // Convert to seconds

      // Interpolate position: last known position + time elapsed
      // This creates smooth 60fps animation between timeupdate events (which fire at ~4fps)
      const interpolatedTime = lastAudioTimeRef.current + timeSinceLastUpdate

      setDisplayTime(interpolatedTime)

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [isPlaying])

  // Playback controls
  const handlePlayPause = useCallback(() => {
    if (!audioElement) return

    if (isPlaying) {
      audioElement.pause()
    } else {
      audioElement.play().catch(err => {
        logger.error('[ChapterStreamPlayer] Play failed', { error: err })
        showSnackbar(t('audioPlayer.playbackError'), { severity: 'error' })
      })
    }
  }, [audioElement, isPlaying, showSnackbar, t])

  const handleSeek = useCallback((time: number) => {
    if (!audioElement) return
    audioElement.currentTime = time
    // Update refs immediately for smooth interpolation
    lastAudioTimeRef.current = time
    lastUpdateTimeRef.current = performance.now()
    setDisplayTime(time)
  }, [audioElement])

  // Handle segment seek when seekToSegmentId changes
  useEffect(() => {
    if (!seekToSegmentId) return

    // Find segment start time from boundaries
    const boundary = boundaries.find(b => b.segmentId === seekToSegmentId)
    if (boundary) {
      handleSeek(boundary.startTime)
    }
  }, [seekToSegmentId, seekTrigger, boundaries, handleSeek])

  const handleVolumeChange = useCallback((_: Event, value: number | number[]) => {
    const newVolume = value as number
    setVolume(newVolume)
    setIsMuted(false)
    if (audioElement) {
      audioElement.volume = newVolume / 100
    }
  }, [audioElement])

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted)
    if (audioElement) {
      audioElement.volume = newMuted ? 0 : volume / 100
    }
  }, [audioElement, isMuted, volume])

  // Segment navigation handlers
  const handlePreviousSegment = useCallback(() => {
    if (!audioElement || boundaries.length === 0) return

    const currentTimePos = audioElement.currentTime

    // Find current segment
    const currentSegmentIndex = boundaries.findIndex(
      (b, idx) => {
        const nextBoundary = boundaries[idx + 1]
        return currentTimePos >= b.startTime &&
               (!nextBoundary || currentTimePos < nextBoundary.startTime)
      }
    )

    if (currentSegmentIndex === -1) {
      // Not in any segment, go to first
      handleSeek(boundaries[0].startTime)
      return
    }

    // If we're more than 2 seconds into current segment, seek to start of current
    const currentBoundary = boundaries[currentSegmentIndex]
    if (currentTimePos - currentBoundary.startTime > 2.0) {
      handleSeek(currentBoundary.startTime)
      return
    }

    // Otherwise, go to previous segment
    if (currentSegmentIndex > 0) {
      const prevBoundary = boundaries[currentSegmentIndex - 1]
      handleSeek(prevBoundary.startTime)
    } else {
      // Already at first segment, seek to start
      handleSeek(boundaries[0].startTime)
    }
  }, [audioElement, boundaries, handleSeek])

  const handleNextSegment = useCallback(() => {
    if (!audioElement || boundaries.length === 0) return

    const currentTimePos = audioElement.currentTime

    // Find current segment
    const currentSegmentIndex = boundaries.findIndex(
      (b, idx) => {
        const nextBoundary = boundaries[idx + 1]
        return currentTimePos >= b.startTime &&
               (!nextBoundary || currentTimePos < nextBoundary.startTime)
      }
    )

    // Go to next segment if available
    if (currentSegmentIndex !== -1 && currentSegmentIndex < boundaries.length - 1) {
      const nextBoundary = boundaries[currentSegmentIndex + 1]
      handleSeek(nextBoundary.startTime)
    } else if (currentSegmentIndex === -1 && boundaries.length > 0) {
      // Not in any segment, go to first
      handleSeek(boundaries[0].startTime)
    }
    // Else: Already at last segment, do nothing
  }, [audioElement, boundaries, handleSeek])

  // Player hotkeys (Space, Arrow keys)
  usePlayerHotkeys({
    isEnabled: streamState.isReady && !streamState.isLoading && !streamState.error,
    onPlayPause: handlePlayPause,
    onPreviousSegment: handlePreviousSegment,
    onNextSegment: handleNextSegment,
  })

  // Track current segment for auto-scroll
  useEffect(() => {
    if (!onCurrentSegmentChange || !isPlaying || boundaries.length === 0) return

    // Find current segment based on currentTime
    const currentSegmentBoundary = boundaries.find((b, idx) => {
      const nextBoundary = boundaries[idx + 1]
      return currentTime >= b.startTime &&
             (!nextBoundary || currentTime < nextBoundary.startTime)
    })

    if (currentSegmentBoundary) {
      onCurrentSegmentChange(currentSegmentBoundary.segmentId)
    } else {
      onCurrentSegmentChange(null)
    }
  }, [currentTime, isPlaying, boundaries, onCurrentSegmentChange])

  // Format time
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Loading state - show while audio is being prepared
  if (streamState.isLoading) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            border: 4,
            borderColor: 'primary.main',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' },
            },
          }}
        />
        <Typography variant="body2" color="text.secondary">
          {t('audioPlayer.loadingAudio')}
        </Typography>
      </Box>
    )
  }

  // Error state - no audio available
  if (streamState.error === 'NO_AUDIO') {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('audioPlayer.noAudioAvailable')}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {t('audioPlayer.generateAudioHint')}
        </Typography>
      </Box>
    )
  }

  // Error state - other errors
  if (streamState.error && streamState.error !== 'NO_AUDIO') {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" color="error">
          {t('audioPlayer.errorLoadingAudio')}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {typeof streamState.error === 'string' ? streamState.error : streamState.error.message}
        </Typography>
      </Box>
    )
  }

  // No chapter selected
  if (!chapter) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('audioPlayer.noChapterSelected')}
        </Typography>
      </Box>
    )
  }

  // Chapter selected but no audio generated yet
  const hasAudioSegments = chapter.segments.some(seg => seg.audioPath)
  if (!hasAudioSegments) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('audioPlayer.noAudioAvailable')}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {t('audioPlayer.generateAudioHint')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        px: 2,
        py: 1,
        gap: 0.5,
        bgcolor: 'background.paper',
      }}
    >
      {/* Waveform */}
      <Paper
        elevation={0}
        sx={{
          width: '100%',
          flexShrink: 0,
          borderLeft: 3,
          borderRight: 3,
          borderColor: 'primary.main',
          bgcolor: 'background.paper',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <WaveformCanvas
          boundaries={boundaries}
          peaks={peaks}
          currentTime={displayTime}
          isLoading={peaksLoading}
          width={undefined} // Will use container width
          height={60}
          onSeek={handleSeek}
        />
      </Paper>

      {/* Controls */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1 }}>
        {/* Play/Pause */}
        <IconButton
          onClick={handlePlayPause}
          disabled={!streamState.isReady}
          size="large"
          data-testid="play-button"
          aria-label={isPlaying ? t('audioPlayer.pause') : t('audioPlayer.play')}
        >
          {isPlaying ? <Pause /> : <PlayArrow />}
        </IconButton>

        {/* Time Display */}
        <Typography variant="body2" sx={{ minWidth: 100 }} data-testid="time-display">
          {formatTime(displayTime)} / {formatTime(streamState.totalDuration)}
        </Typography>

        {/* Volume */}
        <IconButton onClick={toggleMute} size="small">
          {isMuted ? <VolumeOff /> : <VolumeUp />}
        </IconButton>

        <Slider
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          sx={{ width: 100 }}
          size="small"
        />

        {/* Spacer */}
        <Box sx={{ flexGrow: 1 }} />

        {/* Stream State */}
        {chapter && (
          <Typography variant="caption" color="text.secondary">
            {t('audioPlayer.loaded')}: {streamState.loadedUntilIndex + 1} / {chapter.segments.length}
            {streamState.pendingSegments.size > 0 && ` (${streamState.pendingSegments.size} ${t('audioPlayer.pending')})`}
          </Typography>
        )}
      </Stack>

      {/* Snackbar for error notifications */}
      <SnackbarComponent />
    </Box>
  )
}
