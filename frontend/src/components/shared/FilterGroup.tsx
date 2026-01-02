/**
 * FilterGroup Component
 *
 * Container for filter controls in ViewToolbar.
 * Responsive grid layout for filter items.
 *
 * Pattern Specs:
 * - Display: flex (wraps on small screens)
 * - Gap: 16px
 * - Align: center
 */

import React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'

interface FilterGroupProps {
  /** Filter controls */
  children: React.ReactNode

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const FilterGroup: React.FC<FilterGroupProps> = ({ children, sx }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
        flexWrap: 'wrap',
        width: '100%',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

/**
 * FilterItem Component
 *
 * Individual filter control with label.
 */

interface FilterItemProps {
  /** Filter label */
  label: string

  /** Filter control (input, select, etc.) */
  children: React.ReactNode

  /** Flex grow (1 for search, 0 for dropdowns) */
  flexGrow?: number

  /** Minimum width */
  minWidth?: string

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const FilterItem: React.FC<FilterItemProps> = ({
  label,
  children,
  flexGrow = 0,
  minWidth = '200px',
  sx,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flexGrow,
        minWidth,
        ...sx,
      }}
    >
      <Box
        component="label"
        sx={{
          fontSize: '12px',
          color: '#b0b0b0',
          fontWeight: 500,
        }}
      >
        {label}
      </Box>
      {children}
    </Box>
  )
}
