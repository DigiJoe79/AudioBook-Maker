/**
 * ViewToolbar Component
 *
 * Optional toolbar for filters, tabs, or search.
 *
 * Pattern Specs:
 * - Height: 56px (filters) or 48px (tabs) - theme.custom.heights.*
 * - Padding: 16px 24px (filters) or 0 24px (tabs) - theme.custom.spacing.*
 * - Background: Elevated background (theme-aware)
 * - Border-bottom: theme.palette.divider
 *
 * Variants:
 * - "filters": For filter controls (56px height)
 * - "tabs": For tab navigation (48px height)
 */

import React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { getElevatedBackground } from '../../../theme'

interface ViewToolbarProps {
  /** Toolbar content (filters, tabs, search, etc.) */
  children: React.ReactNode

  /** Toolbar variant */
  variant?: 'filters' | 'tabs'

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const ViewToolbar: React.FC<ViewToolbarProps> = ({
  children,
  variant = 'filters',
  sx,
}) => {
  const isFilters = variant === 'filters'
  const isTabs = variant === 'tabs'

  return (
    <Box
      sx={{
        minHeight: (theme) => isFilters ? theme.custom.heights.toolbar : theme.custom.heights.tabs,
        padding: (theme) => isFilters ? `${theme.custom.spacing.md} ${theme.custom.spacing.lg}` : `0 ${theme.custom.spacing.lg}`,
        bgcolor: (theme) => getElevatedBackground(theme),
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        display: 'flex',
        alignItems: isTabs ? 'flex-end' : 'center',
        overflowX: 'auto',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
