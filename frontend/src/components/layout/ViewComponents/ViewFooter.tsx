/**
 * ViewFooter Component
 *
 * Optional footer for status display and secondary actions.
 *
 * Pattern Specs:
 * - Height: 56px (fixed)
 * - Padding: 16px 24px
 * - Background: Elevated background (theme-based)
 * - Border-top: 1px solid divider (theme-based)
 * - Layout: Status/Info (left), Actions (right)
 */

import React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { getElevatedBackground } from '../../../theme'

export interface ViewFooterProps {
  /** Status/info text displayed on the left */
  status?: React.ReactNode

  /** Action buttons displayed on the right */
  actions?: React.ReactNode

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const ViewFooter: React.FC<ViewFooterProps> = ({
  status,
  actions,
  sx,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '56px',
        padding: '16px 24px',
        bgcolor: (theme) => getElevatedBackground(theme),
        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
        ...sx,
      }}
    >
      {/* Left: Status */}
      {status && (
        <Box sx={{ fontSize: '13px', color: 'text.secondary' }}>{status}</Box>
      )}

      {/* Right: Actions */}
      {actions && (
        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {actions}
        </Box>
      )}
    </Box>
  )
}
