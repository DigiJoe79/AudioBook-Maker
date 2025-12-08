/**
 * EngineStatusBadge - Visual engine status indicator
 *
 * Shows colored badge with icon for engine status (Running/Stopped/Disabled/Error).
 * Includes tooltip with detailed status information.
 *
 * Status Colors:
 * - Running: Green (success.main)
 * - Stopped: Gray (text.disabled)
 * - Disabled: Gray (text.disabled)
 * - Error: Red (error.main)
 *
 * @example
 * ```tsx
 * <EngineStatusBadge
 *   status="running"
 *   port={8765}
 *   errorMessage={undefined}
 * />
 * ```
 */

import React, { memo } from 'react'
import { Chip, Tooltip, Box } from '@mui/material'
import {
  CheckCircle as RunningIcon,
  Block as StoppedIcon,
  Error as ErrorIcon,
  DoNotDisturb as DisabledIcon,
  HourglassEmpty as StartingIcon,
  HourglassBottom as StoppingIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { EngineStatus } from '@/types/engines'

export interface EngineStatusBadgeProps {
  status: EngineStatus
  port?: number
  errorMessage?: string
}

const EngineStatusBadge = memo(({ status, port, errorMessage }: EngineStatusBadgeProps) => {
  const { t } = useTranslation()

  const getStatusConfig = () => {
    switch (status) {
      case 'running':
        return {
          icon: <RunningIcon sx={{ fontSize: 16 }} />,
          color: 'success' as const,
          label: t('engines.status.running'),
          tooltip: port ? t('engines.status.runningOn', { port }) : t('engines.status.running'),
        }
      case 'stopped':
        return {
          icon: <StoppedIcon sx={{ fontSize: 16 }} />,
          color: 'default' as const,
          label: t('engines.status.stopped'),
          tooltip: t('engines.status.stoppedTooltip'),
        }
      case 'disabled':
        return {
          icon: <DisabledIcon sx={{ fontSize: 16 }} />,
          color: 'default' as const,
          label: t('engines.status.disabled'),
          tooltip: t('engines.status.disabledTooltip'),
        }
      case 'error':
        return {
          icon: <ErrorIcon sx={{ fontSize: 16 }} />,
          color: 'error' as const,
          label: t('engines.status.error'),
          tooltip: errorMessage || t('engines.status.errorTooltip'),
        }
      case 'starting':
        return {
          icon: <StartingIcon sx={{ fontSize: 16 }} />,
          color: 'warning' as const,
          label: t('engines.status.starting'),
          tooltip: t('engines.status.startingTooltip'),
        }
      case 'stopping':
        return {
          icon: <StoppingIcon sx={{ fontSize: 16 }} />,
          color: 'warning' as const,
          label: t('engines.status.stopping'),
          tooltip: t('engines.status.stoppingTooltip'),
        }
      default:
        return {
          icon: <StoppedIcon sx={{ fontSize: 16 }} />,
          color: 'default' as const,
          label: status,
          tooltip: status,
        }
    }
  }

  const config = getStatusConfig()

  return (
    <Tooltip title={config.tooltip} arrow placement="top">
      <Box component="span">
        <Chip
          icon={config.icon}
          label={config.label}
          color={config.color}
          size="small"
          sx={{ fontWeight: 500 }}
        />
      </Box>
    </Tooltip>
  )
})

EngineStatusBadge.displayName = 'EngineStatusBadge'

export default EngineStatusBadge
