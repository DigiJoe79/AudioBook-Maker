/**
 * QualityStatusIndicator - Visual indicator for segment quality status
 *
 * Shows a colored circle/icon based on quality status:
 * - Green: Perfect (no issues)
 * - Yellow: Warning (minor issues or low confidence)
 * - Red: Defect (critical audio issues)
 *
 * Performance: Memoized to prevent re-renders in virtualized segment list (400+ items)
 */

import React, { memo } from 'react'
import { Box, Tooltip, styled } from '@mui/material'
import { CheckCircle, Warning, Error } from '@mui/icons-material'
import type { QualityStatus } from '@types'

interface QualityStatusIndicatorProps {
  status?: QualityStatus
  size?: 'small' | 'medium' | 'large'
  showTooltip?: boolean
  tooltipContent?: React.ReactNode
}

const StatusIcon = styled(Box, {
  shouldForwardProp: (prop) => !prop.toString().startsWith('$')
})<{ $status: QualityStatus; $size: 'small' | 'medium' | 'large' }>(({ theme, $status, $size }) => {
  const sizeMap = {
    small: 16,
    medium: 20,
    large: 24,
  }

  const colorMap = {
    perfect: theme.palette.success.main,
    warning: theme.palette.warning.main,
    defect: theme.palette.error.main,
  }

  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: sizeMap[$size],
    color: colorMap[$status],
  }
})

const getStatusIcon = (status: QualityStatus, size: number) => {
  const iconProps = { sx: { fontSize: size } }

  switch (status) {
    case 'perfect':
      return <CheckCircle {...iconProps} />
    case 'warning':
      return <Warning {...iconProps} />
    case 'defect':
      return <Error {...iconProps} />
    default:
      return <CheckCircle {...iconProps} />
  }
}

const getStatusLabel = (status: QualityStatus): string => {
  switch (status) {
    case 'perfect':
      return 'Perfekt - Keine Probleme erkannt'
    case 'warning':
      return 'Warnung - Kleinere Probleme oder niedrige Confidence'
    case 'defect':
      return 'Defekt - Kritische Audio-Probleme erkannt'
    default:
      return 'Unbekannter Status'
  }
}

export const QualityStatusIndicator = memo<QualityStatusIndicatorProps>(({
  status = 'perfect',
  size = 'small',
  showTooltip = true,
  tooltipContent,
}) => {
  const sizeMap = {
    small: 16,
    medium: 20,
    large: 24,
  }

  const indicator = (
    <StatusIcon $status={status} $size={size} data-testid="quality-indicator" data-quality-status={status}>
      {getStatusIcon(status, sizeMap[size])}
    </StatusIcon>
  )

  if (showTooltip) {
    return (
      <Tooltip
        title={tooltipContent || getStatusLabel(status)}
        placement="top"
        arrow
      >
        <Box display="inline-flex" sx={{ cursor: 'help' }}>
          {indicator}
        </Box>
      </Tooltip>
    )
  }

  return indicator
})

QualityStatusIndicator.displayName = 'QualityStatusIndicator'
