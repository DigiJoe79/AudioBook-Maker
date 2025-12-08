/**
 * SampleListItem - Enhanced Sample Display with Inline Preview
 *
 * Features:
 * - Two-line layout with name and metadata
 * - Inline audio playback with mini waveform visualization
 * - Editable name (inline editing)
 * - Duration in human-readable format (e.g., "1m 23s")
 * - Action buttons (Play/Pause, Delete, Download)
 * - Hover states for better UX
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box,
  IconButton,
  Typography,
  TextField,
  Tooltip,
  LinearProgress,
  Stack,
} from '@mui/material'
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { SpeakerSample } from '@types'
import { useAppStore } from '@store/appStore'

interface SampleListItemProps {
  sample: SpeakerSample
  speakerId: string
  onDelete: (sampleId: string) => void
  onRename?: (sampleId: string, newName: string) => void
  onDownload?: (sample: SpeakerSample) => void
  disabled?: boolean
}

const SampleListItem = React.memo(function SampleListItem({
  sample,
  speakerId,
  onDelete,
  onRename,
  onDownload,
  disabled = false,
}: SampleListItemProps) {
  const { t } = useTranslation()
  const backendUrl = useAppStore((state) => state.connection.url)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(sample.fileName)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Format duration to human-readable format
  const formatDuration = (seconds: number): string => {
    if (!seconds || seconds < 1) return '< 1s'
    if (seconds < 60) return `${Math.floor(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }

  // Initialize audio element
  useEffect(() => {
    if (!backendUrl) return

    // Create audio element if not exists
    if (!audioRef.current) {
      audioRef.current = new Audio()

      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current?.currentTime || 0)
      })

      audioRef.current.addEventListener('ended', () => {
        setIsPlaying(false)
        setCurrentTime(0)
      })
    }

    // Set audio source from backend API
    audioRef.current.src = `${backendUrl}/api/speakers/${speakerId}/samples/${sample.id}/audio`

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [sample.id, speakerId, backendUrl])

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleDelete = useCallback(() => {
    onDelete(sample.id)
  }, [sample.id, onDelete])

  const handleDownload = useCallback(() => {
    if (onDownload) {
      onDownload(sample)
    }
  }, [sample, onDownload])

  const handleStartEdit = useCallback(() => {
    setEditedName(sample.fileName)
    setIsEditing(true)
  }, [sample.fileName])

  const handleSaveEdit = useCallback(() => {
    if (onRename && editedName.trim() && editedName !== sample.fileName) {
      onRename(sample.id, editedName.trim())
    }
    setIsEditing(false)
  }, [sample.id, sample.fileName, editedName, onRename])

  const handleCancelEdit = useCallback(() => {
    setEditedName(sample.fileName)
    setIsEditing(false)
  }, [sample.fileName])

  const progress = sample.duration ? (currentTime / sample.duration) * 100 : 0

  return (
    <Box
      sx={{
        py: 1.5,
        px: 2,
        bgcolor: 'background.default',
        borderRadius: 1,
        border: 1,
        borderColor: isPlaying ? 'primary.main' : 'divider',
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: 'action.hover',
          borderColor: 'primary.light',
        },
      }}
    >
      {/* Line 1: Name + Actions */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
        {isEditing ? (
          <Box display="flex" alignItems="center" gap={1} flex={1}>
            <TextField
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              size="small"
              autoFocus
              fullWidth
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit()
                if (e.key === 'Escape') handleCancelEdit()
              }}
            />
            <IconButton size="small" onClick={handleSaveEdit} color="primary">
              <CheckIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleCancelEdit}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <>
            <Box display="flex" alignItems="center" gap={1} flex={1}>
              <Typography variant="body2" fontWeight="medium" noWrap>
                {sample.fileName}
              </Typography>
              {onRename && (
                <Tooltip title={t('speakers.sample.rename')}>
                  <IconButton size="small" onClick={handleStartEdit} disabled={disabled}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            <Stack direction="row" spacing={0.5}>
              {onDownload && (
                <Tooltip title={t('speakers.sample.download')}>
                  <IconButton size="small" onClick={handleDownload} disabled={disabled}>
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('speakers.sample.delete')}>
                <IconButton size="small" onClick={handleDelete} disabled={disabled} color="error">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </>
        )}
      </Box>

      {/* Line 2: Waveform + Duration + Play Button */}
      {!isEditing && (
        <Box display="flex" alignItems="center" gap={1.5}>
          {/* Play/Pause Button */}
          <IconButton
            size="small"
            onClick={handlePlayPause}
            disabled={!sample.filePath || disabled}
            color="primary"
            sx={{
              bgcolor: isPlaying ? (theme) => theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.15)' : 'rgba(25, 118, 210, 0.08)' : 'transparent',
            }}
          >
            {isPlaying ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
          </IconButton>

          {/* Mini Waveform / Progress Bar */}
          <Box flex={1} position="relative">
            {/* Background waveform visualization (decorative) */}
            <Box
              sx={{
                height: 32,
                bgcolor: 'action.hover',
                borderRadius: 0.5,
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 1,
              }}
            >
              {/* Simple waveform bars */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  height: '100%',
                  opacity: 0.3,
                }}
              >
                {[30, 50, 40, 60, 45, 70, 35, 55, 50, 65, 40, 75, 50, 45, 60, 35, 70, 50, 55, 40].map((height, i) => (
                  <Box
                    key={i}
                    sx={{
                      width: 2,
                      height: `${height}%`,
                      bgcolor: 'primary.main',
                      borderRadius: 1,
                    }}
                  />
                ))}
              </Box>

              {/* Progress overlay */}
              {isPlaying && (
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    bgcolor: 'transparent',
                  }}
                />
              )}

              {/* Time display */}
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  fontWeight: 'medium',
                  color: 'text.secondary',
                }}
              >
                {isPlaying
                  ? `${formatDuration(currentTime)} / ${formatDuration(sample.duration || 0)}`
                  : formatDuration(sample.duration || 0)}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}, (prevProps, nextProps) => {
  return prevProps.sample.id === nextProps.sample.id &&
         prevProps.sample.fileName === nextProps.sample.fileName &&
         prevProps.sample.duration === nextProps.sample.duration &&
         prevProps.disabled === nextProps.disabled
})

SampleListItem.displayName = 'SampleListItem'

export default SampleListItem
