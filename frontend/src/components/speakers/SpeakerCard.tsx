/**
 * SpeakerCard - Individual Speaker Card Component
 *
 * Modern card-based display for speaker with:
 * - Color-coded top border (gender)
 * - Waveform placeholder background
 * - Metadata display (gender, samples, duration)
 * - Quick action buttons (Preview, Edit)
 * - Status indicators (Default, Inactive, Quality)
 */

import React, { memo, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  IconButton,
  Button,
  Chip,
  Tooltip
} from '@mui/material'
import {
  Star as StarIcon,
  PlayArrow as PlayIcon,
  Edit as EditIcon,
  MoreVert as MoreIcon,
  Mic as MicIcon,
  Male as MaleIcon,
  Female as FemaleIcon,
  Transgender as NeutralIcon
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { Speaker } from '@types'

interface SpeakerCardProps {
  speaker: Speaker
  isDefault?: boolean
  onEdit: (speaker: Speaker) => void
  onPreview?: (speaker: Speaker) => void
  onMenuClick?: (event: React.MouseEvent<HTMLElement>, speaker: Speaker) => void
}

const SpeakerCard = memo(({
  speaker,
  isDefault = false,
  onEdit,
  onPreview,
  onMenuClick
}: SpeakerCardProps) => {
  const { t } = useTranslation()

  // Calculate total duration from samples
  const totalDuration = useMemo(
    () => speaker.samples.reduce((sum, sample) => sum + (sample.duration || 0), 0),
    [speaker.samples]
  )

  // Get gender color for border
  const genderColor = getGenderColor(speaker.gender)

  // Get gender icon
  const GenderIcon = getGenderIcon(speaker.gender)

  // Translate gender value
  const getGenderLabel = useMemo(() => {
    switch (speaker.gender) {
      case 'male':
        return t('speakers.genderMale')
      case 'female':
        return t('speakers.genderFemale')
      case 'neutral':
        return t('speakers.genderNeutral')
      default:
        return t('speakers.card.unknownGender')
    }
  }, [speaker.gender, t])

  // Calculate quality based on sample duration
  const quality = useMemo(
    () => getQuality(totalDuration, speaker.samples.length, t),
    [totalDuration, speaker.samples.length, t]
  )
  const qualityColor = useMemo(
    () => getQualityColor(quality),
    [quality]
  )

  return (
    <Card
      data-testid={`speaker-card-${speaker.id}`}
      sx={{
        height: 300,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderTop: '4px solid',
        borderTopColor: genderColor,
        opacity: speaker.isActive ? 1 : 0.5,
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
        }
      }}
    >
      {/* Waveform Background */}
      <Box
        sx={{
          height: 80,
          bgcolor: speaker.isActive ? `${genderColor}15` : 'grey.100',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative Waveform Pattern */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.15,
            background: `repeating-linear-gradient(
              90deg,
              transparent,
              transparent 3px,
              ${genderColor} 3px,
              ${genderColor} 4px
            )`,
          }}
        >
          {/* Waveform bars with varying heights */}
          {[20, 45, 65, 35, 70, 50, 30, 60, 40, 55, 25, 75, 45, 35, 60, 50, 40, 65, 30, 70].map((height, i) => (
            <Box
              key={i}
              sx={{
                position: 'absolute',
                left: `${i * 5}%`,
                bottom: '50%',
                width: 2,
                height: `${height}%`,
                bgcolor: genderColor,
                transform: 'translateY(50%)',
              }}
            />
          ))}
        </Box>

        {/* Center Icon */}
        <MicIcon sx={{ fontSize: 40, color: genderColor, opacity: 0.4, zIndex: 1 }} />
      </Box>

      {/* Badges Container */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 0.5,
          zIndex: 1,
        }}
      >
        {/* Quality Badge */}
        <Tooltip title={getQualityTooltip(quality, totalDuration, speaker.samples.length, t)}>
          <Chip
            label={quality}
            size="small"
            sx={{
              bgcolor: qualityColor,
              color: 'white',
              fontWeight: 'bold',
              fontSize: '0.7rem',
            }}
          />
        </Tooltip>

        {/* Default Badge */}
        {isDefault && (
          <Tooltip title={t('speakers.card.defaultTooltip')}>
            <Chip
              icon={<StarIcon />}
              label={t('speakers.card.default')}
              color="warning"
              size="small"
            />
          </Tooltip>
        )}
      </Box>

      {/* Card Content */}
      <CardContent sx={{ flexGrow: 1, pb: 1.5, pt: 2 }}>
        {/* Speaker Name */}
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
          <Typography
            variant="h6"
            component="div"
            noWrap
            sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}
          >
            {speaker.name}
          </Typography>

          <IconButton
            data-testid={`speaker-menu-button-${speaker.id}`}
            size="small"
            onClick={(e) => onMenuClick?.(e, speaker)}
            sx={{ mt: -0.5, mr: -1 }}
          >
            <MoreIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Metadata Line */}
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Tooltip title={getGenderLabel}>
            <Box display="flex" alignItems="center" gap={0.5}>
              {GenderIcon && <GenderIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
              <Typography variant="caption" color="text.secondary">
                {getGenderLabel}
              </Typography>
            </Box>
          </Tooltip>

          <Typography variant="caption" color="text.secondary">
            •
          </Typography>

          <Typography variant="caption" color="text.secondary">
            {speaker.samples.length} {speaker.samples.length === 1 ? t('speakers.card.sample') : t('speakers.card.samples')}
          </Typography>

          {totalDuration > 0 && (
            <>
              <Typography variant="caption" color="text.secondary">
                •
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {totalDuration.toFixed(1)}s
              </Typography>
            </>
          )}
        </Box>

        {/* Description */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            minHeight: 60,
          }}
        >
          {speaker.description || t('speakers.card.noDescription')}
        </Typography>
      </CardContent>

      {/* Quick Actions */}
      <CardActions sx={{ justifyContent: 'space-between', pt: 1.5, px: 2, pb: 2 }}>
        {onPreview && (
          <Button
            size="small"
            startIcon={<PlayIcon />}
            onClick={() => onPreview(speaker)}
            disabled={speaker.samples.length === 0}
          >
            {t('speakers.card.preview')}
          </Button>
        )}

        <Button
          data-testid={`speaker-edit-button-${speaker.id}`}
          size="small"
          startIcon={<EditIcon />}
          onClick={() => onEdit(speaker)}
          variant="outlined"
        >
          {t('speakers.card.edit')}
        </Button>
      </CardActions>
    </Card>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.speaker.id === nextProps.speaker.id &&
    prevProps.speaker.name === nextProps.speaker.name &&
    prevProps.speaker.gender === nextProps.speaker.gender &&
    prevProps.speaker.description === nextProps.speaker.description &&
    prevProps.speaker.isActive === nextProps.speaker.isActive &&
    prevProps.speaker.samples.length === nextProps.speaker.samples.length &&
    prevProps.isDefault === nextProps.isDefault &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onPreview === nextProps.onPreview &&
    prevProps.onMenuClick === nextProps.onMenuClick
  )
})

SpeakerCard.displayName = 'SpeakerCard'

export default SpeakerCard

// Helper functions

function getGenderColor(gender?: string): string {
  switch (gender) {
    case 'male':
      return '#1976d2' // Blue
    case 'female':
      return '#d81b60' // Pink
    case 'neutral':
      return '#9c27b0' // Purple
    default:
      return '#757575' // Gray
  }
}

function getGenderIcon(gender?: string) {
  switch (gender) {
    case 'male':
      return MaleIcon
    case 'female':
      return FemaleIcon
    case 'neutral':
      return NeutralIcon
    default:
      return null
  }
}

function getQuality(totalDuration: number, sampleCount: number, t: (key: string) => string): string {
  if (sampleCount === 0) return t('speakers.card.quality.noSamples')
  if (totalDuration >= 60) return t('speakers.card.quality.excellent')
  if (totalDuration >= 30) return t('speakers.card.quality.good')
  return t('speakers.card.quality.poor')
}

function getQualityColor(quality: string): string {
  // Check quality text to determine color
  if (quality.includes('Excellent') || quality.includes('Exzellent')) return '#4caf50' // Green
  if (quality.includes('Good') || quality.includes('Gut')) return '#ff9800' // Orange
  if (quality.includes('Poor') || quality.includes('Mangelhaft')) return '#f44336' // Red
  return '#9e9e9e' // Gray (No Samples / Keine Proben)
}

function getQualityTooltip(quality: string, totalDuration: number, sampleCount: number, t: (key: string, options?: any) => string): string {
  if (sampleCount === 0) {
    return t('speakers.card.quality.noSamplesTooltip')
  }

  // Format duration in human-readable format
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }

  const durationText = formatDuration(totalDuration)
  const sampleText = `${sampleCount} ${sampleCount === 1 ? t('speakers.card.sample') : t('speakers.card.samples')}`

  // Determine recommendation based on quality text
  const recommendation =
    quality.includes('Excellent') || quality.includes('Exzellent')
      ? t('speakers.card.quality.optimalTooltip')
      : quality.includes('Good') || quality.includes('Gut')
      ? t('speakers.card.quality.goodTooltip')
      : t('speakers.card.quality.poorTooltip')

  return `${quality} Quality\n${sampleText} • ${durationText} total\n${recommendation}`
}
