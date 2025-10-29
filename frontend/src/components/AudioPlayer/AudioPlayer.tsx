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

  const currentSegment = chapter?.segments.find(s => s.id === playingSegmentId)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => setCurrentTime(audio.currentTime)
    const updateDuration = () => setDuration(audio.duration)

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)

    audio.volume = volume / 100

    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
    }
  }, [audioRef, volume])

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
      onStopPlayback?.()
    } else if (chapter && chapter.segments.length > 0) {

      if (selectedSegmentId) {
        const selectedSegment = chapter.segments.find(s => s.id === selectedSegmentId)
        if (selectedSegment?.audioPath) {
          onPlaySegment?.(selectedSegment, true)
          return
        }
      }

      const firstSegmentWithAudio = chapter.segments.find(s => s.audioPath)
      if (firstSegmentWithAudio) {
        onPlaySegment?.(firstSegmentWithAudio, true)
      }
    }
  }

  const handlePrevious = () => {
    if (!chapter) return

    console.log('[AudioPlayer] Previous button clicked', {
      playingSegmentId,
      selectedSegmentId
    })

    const referenceSegmentId = playingSegmentId || selectedSegmentId
    if (!referenceSegmentId) {
      const lastSegmentWithAudio = [...chapter.segments].reverse().find(s => s.audioPath)
      if (lastSegmentWithAudio) {
        console.log('[AudioPlayer] No reference, playing last segment with audio')
        onPlaySegment?.(lastSegmentWithAudio, true)
      }
      return
    }

    const currentIndex = chapter.segments.findIndex(s => s.id === referenceSegmentId)
    if (currentIndex <= 0) return

    for (let i = currentIndex - 1; i >= 0; i--) {
      if (chapter.segments[i].audioPath) {
        console.log('[AudioPlayer] Playing previous segment', {
          segmentId: chapter.segments[i].id,
          continuous: true,
          index: i
        })
        onPlaySegment?.(chapter.segments[i], true)
        return
      }
    }
  }

  const handleNext = () => {
    if (!chapter) return

    console.log('[AudioPlayer] Next button clicked', {
      playingSegmentId,
      selectedSegmentId
    })

    const referenceSegmentId = playingSegmentId || selectedSegmentId
    if (!referenceSegmentId) {
      const firstSegmentWithAudio = chapter.segments.find(s => s.audioPath)
      if (firstSegmentWithAudio) {
        console.log('[AudioPlayer] No reference, playing first segment with audio')
        onPlaySegment?.(firstSegmentWithAudio, true)
      }
      return
    }

    const currentIndex = chapter.segments.findIndex(s => s.id === referenceSegmentId)
    if (currentIndex === -1 || currentIndex >= chapter.segments.length - 1) return

    for (let i = currentIndex + 1; i < chapter.segments.length; i++) {
      if (chapter.segments[i].audioPath) {
        console.log('[AudioPlayer] Playing next segment', {
          segmentId: chapter.segments[i].id,
          continuous: true,
          index: i
        })
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

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

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
