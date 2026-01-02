/**
 * EngineVariantBadge - Shows the runner type for an engine variant
 *
 * Displays a small badge indicating whether the engine runs locally or via Docker.
 */

import React, { memo } from 'react'
import { Chip, Tooltip } from '@mui/material'
import {
  Computer as LocalIcon,
  Cloud as DockerIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface EngineVariantBadgeProps {
  /** Runner type: 'subprocess' | 'docker:local' | 'docker:remote' */
  runnerType?: string
  /** Runner host for docker:remote */
  runnerHost?: string
  /** Size variant */
  size?: 'small' | 'medium'
}

const EngineVariantBadge = memo(({
  runnerType = 'subprocess',
  runnerHost,
  size = 'small',
}: EngineVariantBadgeProps) => {
  const { t } = useTranslation()

  const isDocker = runnerType?.startsWith('docker')
  const isRemote = runnerType === 'docker:remote'

  const label = isDocker
    ? isRemote
      ? runnerHost || 'Remote'
      : 'Docker'
    : t('engines.runnerLocal', 'Local')

  const icon = isDocker ? <DockerIcon /> : <LocalIcon />

  const tooltipText = isDocker
    ? isRemote
      ? t('engines.runnerDockerRemote', 'Running in Docker on {{host}}', { host: runnerHost })
      : t('engines.runnerDockerLocal', 'Running in Docker locally')
    : t('engines.runnerLocalTooltip', 'Running as local subprocess')

  return (
    <Tooltip title={tooltipText} arrow>
      <Chip
        icon={icon}
        label={label}
        size={size}
        variant="outlined"
        sx={{
          height: size === 'small' ? 20 : 24,
          '& .MuiChip-label': {
            px: 0.5,
            fontSize: size === 'small' ? '0.7rem' : '0.75rem',
          },
          '& .MuiChip-icon': {
            fontSize: size === 'small' ? 14 : 16,
            ml: 0.5,
          },
        }}
      />
    </Tooltip>
  )
})

EngineVariantBadge.displayName = 'EngineVariantBadge'

export default EngineVariantBadge
