/**
 * ViewContainer Component
 *
 * Root container for complete view structure.
 * Combines ViewHeader, ViewToolbar, ViewContent, ViewFooter.
 *
 * Pattern Specs:
 * - Display: flex column
 * - Height: 100%
 * - Background: theme.palette.background.paper (Dark: #242424, Light: #ffffff)
 * - Overflow: hidden
 * - No border-radius (views are directly at window edge)
 */

import React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'

interface ViewContainerProps {
  /** View content (should include ViewHeader, ViewContent, etc.) */
  children: React.ReactNode

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const ViewContainer: React.FC<ViewContainerProps> = ({
  children,
  sx,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
