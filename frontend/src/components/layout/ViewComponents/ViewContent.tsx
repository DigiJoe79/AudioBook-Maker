/**
 * ViewContent Component
 *
 * Main content area for views.
 *
 * Pattern Specs:
 * - Padding: theme.custom.spacing.lg (24px)
 * - Background: theme.palette.background.paper
 * - Flex: 1 (takes remaining height)
 * - Overflow: auto (scrollable)
 */

import React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'

export interface ViewContentProps {
  /** Content to display */
  children: React.ReactNode

  /** Disable padding (for custom layouts) */
  noPadding?: boolean

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const ViewContent: React.FC<ViewContentProps> = ({
  children,
  noPadding = false,
  sx,
}) => {
  return (
    <Box
      sx={{
        flex: 1,
        padding: (theme) => noPadding ? 0 : theme.custom.spacing.lg,
        bgcolor: 'background.paper',
        overflowY: 'auto',
        overflowX: 'hidden',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
