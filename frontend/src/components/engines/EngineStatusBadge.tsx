/**
 * Engine Status Utilities
 *
 * Provides status border colors for engine cards and optional badge component.
 * Status is indicated via card left border - minimal and ambient.
 *
 * Status Colors:
 * - Running: Green (success.main)
 * - Starting/Stopping: Orange (warning.main)
 * - Error: Red (error.main)
 * - Stopped/Disabled/Not Installed: Gray (action.disabled)
 *
 * @example
 * ```tsx
 * // Use border color on card
 * const borderColor = useStatusBorderColor(engine.status)
 * <Card sx={{ borderBottom: `3px solid ${borderColor}` }}>
 *
 * // Or use the hook with full config
 * const { borderColor, tooltip } = useEngineStatusStyle(status, port, errorMessage)
 * ```
 */

import React, { memo, useMemo } from 'react'
import { Tooltip, Box, useTheme, type Theme } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { EngineStatus } from '@/types/engines'

/**
 * Returns the border color for a given engine status.
 * Used to style card bottom borders as ambient status indicators.
 */
export function getStatusBorderColor(status: EngineStatus, theme: Theme): string {
  switch (status) {
    case 'running':
      return theme.palette.success.main
    case 'starting':
    case 'stopping':
      return theme.palette.warning.main
    case 'error':
      return theme.palette.error.main
    default:
      // stopped, disabled, not_installed - gray border
      return theme.palette.action.disabled
  }
}

/**
 * Hook to get status border color with theme.
 */
export function useStatusBorderColor(status: EngineStatus): string {
  const theme = useTheme()
  return useMemo(() => getStatusBorderColor(status, theme), [status, theme])
}

/**
 * Hook to get full status styling config including tooltip.
 */
export function useEngineStatusStyle(
  status: EngineStatus,
  port?: number,
  errorMessage?: string
) {
  const { t } = useTranslation()
  const theme = useTheme()

  return useMemo(() => {
    const borderColor = getStatusBorderColor(status, theme)

    let tooltip: string
    switch (status) {
      case 'running':
        tooltip = port ? t('engines.status.runningOn', { port }) : t('engines.status.running')
        break
      case 'error':
        tooltip = errorMessage || t('engines.status.errorTooltip')
        break
      case 'starting':
        tooltip = t('engines.status.startingTooltip')
        break
      case 'stopping':
        tooltip = t('engines.status.stoppingTooltip')
        break
      case 'not_installed':
        tooltip = t('engines.status.notInstalledTooltip')
        break
      default:
        tooltip = ''
    }

    // Show badge only for active statuses (not stopped/disabled/not_installed)
    const isActiveStatus = ['running', 'starting', 'stopping', 'error'].includes(status)
    return { borderColor, tooltip, showBorder: isActiveStatus }
  }, [status, port, errorMessage, t, theme])
}

interface EngineStatusBadgeProps {
  status: EngineStatus
  port?: number
  errorMessage?: string
}

/**
 * Minimal status indicator - small colored dot.
 * Only shown for active statuses (running, starting, stopping, error).
 * Used in dropdown menus where card border isn't available.
 */
const EngineStatusBadge = memo(({ status, port, errorMessage }: EngineStatusBadgeProps) => {
  const { borderColor, tooltip, showBorder } = useEngineStatusStyle(status, port, errorMessage)

  if (!showBorder) {
    return null
  }

  return (
    <Tooltip title={tooltip} arrow placement="top">
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: borderColor,
          flexShrink: 0,
        }}
      />
    </Tooltip>
  )
})

EngineStatusBadge.displayName = 'EngineStatusBadge'

export default EngineStatusBadge
