/**
 * SpeakerPreviewPlayer - Compact Audio Player for Speaker Samples
 *
 * Features:
 * - Plays speaker audio samples (cycles through all samples)
 * - Compact inline design (fits in cards/modals)
 * - Auto-plays next sample when current finishes
 * - Visual feedback (waveform bars animation)
 * - Play/Pause/Stop controls
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box,
  IconButton,
  LinearProgress,
  Typography,
  Stack,
  Tooltip,
} from '@mui/material'
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { Speaker } from '@types'
import { useAppStore } from '@store/appStore'
import { logger } from '@/utils/logger'

interface SpeakerPreviewPlayerProps {
  speaker: Speaker
  autoPlay?: boolean
  compact?: boolean
}

export default function SpeakerPreviewPlayer({
  speaker,
  autoPlay = false,
  compact = false,
}: SpeakerPreviewPlayerProps) {
  const { t } = useTranslation()
  const backendUrl = useAppStore(state => state.connection.url)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const samples = speaker.samples || []
  const currentSample = samples[currentSampleIndex]

  // Load audio sample
  useEffect(() => {
    if (!currentSample || !audioRef.current || !backendUrl) return

    const audio = audioRef.current
    audio.src = `${backendUrl}/api/speakers/${speaker.id}/samples/${currentSample.id}/audio`

    // Auto-play if requested and audio is loaded
    if (autoPlay || isPlaying) {
      const playWhenReady = () => {
        audio.play()
          .then(() => setIsPlaying(true))
          .catch(err => {
            logger.error('[SpeakerPreviewPlayer] Failed to play audio', { error: err })
            setIsPlaying(false)
          })
      }

      if (audio.readyState >= 2) {
        // Audio already loaded
        playWhenReady()
      } else {
        // Wait for audio to load
        audio.addEventListener('canplay', playWhenReady, { once: true })
      }
    }

    // Cleanup on unmount
    return () => {
      audio.pause()
    }
  }, [currentSample, speaker.id, backendUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update progress
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateProgress = () => {
      if (audio.duration > 0) {
        setProgress((audio.currentTime / audio.duration) * 100)
        setCurrentTime(audio.currentTime)
        setDuration(audio.duration)
      }
    }

    const handleEnded = () => {
      // Auto-play next sample if available
      if (currentSampleIndex < samples.length - 1) {
        setCurrentSampleIndex(prev => prev + 1)
      } else {
        // Loop back to first sample
        setCurrentSampleIndex(0)
        setIsPlaying(false)
        setProgress(0)
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }

    audio.addEventListener('timeupdate', updateProgress)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)

    return () => {
      audio.removeEventListener('timeupdate', updateProgress)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [currentSampleIndex, samples.length])

  const handlePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || samples.length === 0) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().catch(err => {
        logger.error('[SpeakerPreviewPlayer] Failed to play audio', { error: err })
      })
      setIsPlaying(true)
    }
  }, [isPlaying, samples.length])

  const handleStop = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
    setProgress(0)
    setCurrentSampleIndex(0)
  }, [])

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (samples.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          bgcolor: 'action.hover',
          borderRadius: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('speakers.preview.noSamples')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        p: compact ? 1 : 2,
      }}
    >
      <audio ref={audioRef} />

      <Stack spacing={1}>
        {/* Progress Bar */}
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: 'action.hover',
          }}
        />

        {/* Controls Row */}
        <Stack direction="row" alignItems="center" spacing={1}>
          {/* Play/Pause Button */}
          <Tooltip title={isPlaying ? t('speakers.preview.pause') : t('speakers.preview.play')}>
            <IconButton
              size="small"
              onClick={handlePlay}
              color="primary"
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              {isPlaying ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          {/* Stop Button */}
          <Tooltip title={t('speakers.preview.stop')}>
            <span>
              <IconButton
                size="small"
                onClick={handleStop}
                disabled={!isPlaying && progress === 0}
              >
                <StopIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          {/* Time Display */}
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Typography>

          {/* Sample Indicator */}
          {samples.length > 1 && (
            <>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="caption" color="text.secondary">
                {t('speakers.preview.sample')} {currentSampleIndex + 1}/{samples.length}
              </Typography>
            </>
          )}
        </Stack>

        {/* Current Sample Name */}
        {!compact && currentSample && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {currentSample.fileName}
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
