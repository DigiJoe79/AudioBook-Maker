/**
 * ViewHeader Component
 *
 * Consistent header for all views following the View Pattern System.
 *
 * Pattern Specs:
 * - Height: 64px (fixed)
 * - Padding: 16px 24px
 * - Background: Theme-aware elevated background (Dark: #2a2a2a, Light: #f5f5f5)
 * - Border-bottom: 1px solid theme divider
 * - Layout: Title + Icon (left), Actions (right)
 *
 * Theme Integration:
 * - Uses getElevatedBackground() for consistent header styling
 * - All colors respond to theme mode changes
 */

import React from 'react'
import { Box, Typography, type SxProps, type Theme } from '@mui/material'
import { getElevatedBackground } from '../../../theme'

export interface ViewHeaderProps {
  /** View title (e.g., "Jobs", "Einstellungen") */
  title: string

  /** Icon displayed left of title */
  icon?: React.ReactNode

  /** Action buttons displayed on the right */
  actions?: React.ReactNode

  /** Optional additional content below title */
  subtitle?: React.ReactNode

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const ViewHeader: React.FC<ViewHeaderProps> = ({
  title,
  icon,
  actions,
  subtitle,
  sx,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: (theme) => theme.custom.heights.header,
        padding: (theme) => `${theme.custom.spacing.md} ${theme.custom.spacing.lg}`,
        bgcolor: (theme) => getElevatedBackground(theme),
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        ...sx,
      }}
    >
      {/* Left: Title + Icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: (theme) => theme.custom.spacing.sm }}>
        {icon && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              color: 'primary.light',
            }}
          >
            {icon}
          </Box>
        )}
        <Box>
          <Typography
            variant="h5"
            sx={{
              color: 'text.primary',
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Box sx={{ mt: 0.5, color: 'text.secondary', fontSize: '13px' }}>
              {subtitle}
            </Box>
          )}
        </Box>
      </Box>

      {/* Right: Actions */}
      {actions && (
        <Box sx={{ display: 'flex', gap: (theme) => theme.custom.spacing.sm, alignItems: 'center' }}>
          {actions}
        </Box>
      )}
    </Box>
  )
}
