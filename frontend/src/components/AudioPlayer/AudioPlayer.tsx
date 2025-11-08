import {
  Box,
  IconButton,
  Slider,
  Typography,
  Stack,
} from '@mui/material'
import {
  PlayArrow,
  Pause,
  SkipPrevious,
  SkipNext,
  VolumeUp,
  VolumeOff,
} from '@mui/icons-material'
import { useState, useEffect, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Chapter, Segment } from '../../types'
import { logger } from '../../utils/logger'

interface AudioPlayerProps {
  chapter?: Chapter
  selectedSegmentId?: string | null
  playingSegmentId?: string | null
  audioRef: RefObject<HTMLAudioElement>
  onPlaySegment?: (segment: Segment, continuous?: boolean) => void
  onStopPlayback?: () => void
}

export default function AudioPlayer({
  chapter,
  selectedSegmentId,
  playingSegmentId,
  audioRef,
  onPlaySegment,
  onStopPlayback
}: AudioPlayerProps) {
  const { t } = useTranslation()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)

  const isPlaying = !!playingSegmentId

  // Get current playing segment
  const currentSegment = chapter?.segments.find(s => s.id === playingSegmentId)

  // Sync with audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => setCurrentTime(audio.currentTime)
    const updateDuration = () => setDuration(audio.duration)

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)

    // Set initial volume
    audio.volume = volume / 100

    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
    }
  }, [audioRef, volume])

  // Reset time/duration when playback stops
  useEffect(() => {
    if (!playingSegmentId) {
      setCurrentTime(0)
      setDuration(0)
    }
  }, [playingSegmentId])

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlayPause = () => {
    if (isPlaying) {
      // Stop current playback
      onStopPlayback?.()
    } else if (chapter && chapter.segments.length > 0) {
      // Big play button: ALWAYS starts continuous playback (continuous=true)
      // Priority: 1. Selected segment, 2. First segment with audio

      if (selectedSegmentId) {
        const selectedSegment = chapter.segments.find(s => s.id === selectedSegmentId)
        if (selectedSegment?.audioPath) {
          onPlaySegment?.(selectedSegment, true)  // continuous=true for autoplay
          return
        }
      }

      // Fallback: Play first segment with audio
      const firstSegmentWithAudio = chapter.segments.find(s => s.audioPath)
      if (firstSegmentWithAudio) {
        onPlaySegment?.(firstSegmentWithAudio, true)  // continuous=true for autoplay
      }
    }
  }

  const handlePrevious = () => {
    if (!chapter) return

    logger.group(
      '⏮️ Navigation',
      'Previous button clicked',
      { playingSegmentId, selectedSegmentId },
      '#2196F3'
    )

    // Use playing segment as reference, fallback to selected segment
    const referenceSegmentId = playingSegmentId || selectedSegmentId
    if (!referenceSegmentId) {
      // No reference point - play last segment with audio
      const lastSegmentWithAudio = [...chapter.segments].reverse().find(s => s.audioPath)
      if (lastSegmentWithAudio) {
        logger.group(
          '⏮️ Navigation',
          'No reference, playing last segment',
          { segmentId: lastSegmentWithAudio.id },
          '#2196F3'
        )
        onPlaySegment?.(lastSegmentWithAudio, true)
      }
      return
    }

    const currentIndex = chapter.segments.findIndex(s => s.id === referenceSegmentId)
    if (currentIndex <= 0) return // Already at first segment or not found

    // Find previous segment with audio
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (chapter.segments[i].audioPath) {
        // Previous button: ALWAYS continue with autoplay (continuous=true)
        logger.group(
          '⏮️ Navigation',
          'Playing previous segment',
          { segmentId: chapter.segments[i].id, continuous: true, index: i },
          '#2196F3'
        )
        onPlaySegment?.(chapter.segments[i], true)
        return
      }
    }
  }

  const handleNext = () => {
    if (!chapter) return

    logger.group(
      '⏭️ Navigation',
      'Next button clicked',
      { playingSegmentId, selectedSegmentId },
      '#2196F3'
    )

    // Use playing segment as reference, fallback to selected segment
    const referenceSegmentId = playingSegmentId || selectedSegmentId
    if (!referenceSegmentId) {
      // No reference point - play first segment with audio
      const firstSegmentWithAudio = chapter.segments.find(s => s.audioPath)
      if (firstSegmentWithAudio) {
        logger.group(
          '⏭️ Navigation',
          'No reference, playing first segment',
          { segmentId: firstSegmentWithAudio.id },
          '#2196F3'
        )
        onPlaySegment?.(firstSegmentWithAudio, true)
      }
      return
    }

    const currentIndex = chapter.segments.findIndex(s => s.id === referenceSegmentId)
    if (currentIndex === -1 || currentIndex >= chapter.segments.length - 1) return // Not found or at last segment

    // Find next segment with audio
    for (let i = currentIndex + 1; i < chapter.segments.length; i++) {
      if (chapter.segments[i].audioPath) {
        // Next button: ALWAYS continue with autoplay (continuous=true)
        logger.group(
          '⏭️ Navigation',
          'Playing next segment',
          { segmentId: chapter.segments[i].id, continuous: true, index: i },
          '#2196F3'
        )
        onPlaySegment?.(chapter.segments[i], true)
        return
      }
    }
  }

  const handleTimeChange = (_: Event, value: number | number[]) => {
    const audio = audioRef.current
    if (!audio) return
    const newTime = value as number
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handleVolumeChange = (_: Event, value: number | number[]) => {
    const newVolume = value as number
    setVolume(newVolume)
    setIsMuted(false)
    const audio = audioRef.current
    if (audio) {
      audio.volume = newVolume / 100
    }
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return
    const newMuted = !isMuted
    setIsMuted(newMuted)
    audio.volume = newMuted ? 0 : volume / 100
  }

  // No chapter selected
  if (!chapter) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('audioPlayer.selectChapter')}
        </Typography>
      </Box>
    )
  }

  const hasAudio = chapter.segments.some(s => s.audioPath)

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: 'background.paper',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {/* Timeline Slider */}
      <Box sx={{ px: 1 }}>
        <Slider
          value={currentTime}
          max={duration || 100}
          onChange={handleTimeChange}
          disabled={!hasAudio}
          size="small"
          sx={{
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
            },
          }}
        />
      </Box>

      {/* Controls */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1 }}
      >
        {/* Time Display */}
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        {/* Playback Controls */}
        <IconButton
          size="small"
          disabled={!hasAudio}
          onClick={handlePrevious}
        >
          <SkipPrevious />
        </IconButton>

        <IconButton
          size="large"
          color="primary"
          onClick={handlePlayPause}
          disabled={!hasAudio}
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              bgcolor: 'primary.dark',
            },
            '&.Mui-disabled': {
              bgcolor: 'action.disabledBackground',
            },
          }}
        >
          {isPlaying ? <Pause /> : <PlayArrow />}
        </IconButton>

        <IconButton
          size="small"
          disabled={!hasAudio}
          onClick={handleNext}
        >
          <SkipNext />
        </IconButton>

        <Box sx={{ flexGrow: 1 }} />

        {/* Volume Control */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 150 }}>
          <IconButton size="small" onClick={toggleMute}>
            {isMuted || volume === 0 ? <VolumeOff /> : <VolumeUp />}
          </IconButton>
          <Slider
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            size="small"
            sx={{ width: 100 }}
          />
        </Stack>
      </Stack>
    </Box>
  )
}
