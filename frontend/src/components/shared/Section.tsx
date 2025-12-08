/**
 * Section Component
 *
 * Collapsible section with header (title, count badge, expand button).
 * Used in list views to group related items.
 *
 * Pattern Specs:
 * - Margin-bottom: 24px (theme.spacing(3))
 * - Header: Title + Count + Expand button
 * - Border-bottom: 1px solid theme.palette.divider
 * - Collapsible content area
 * - Uses theme.palette for all colors
 */

import React, { useState } from 'react'
import { Box, Typography, IconButton, Collapse, type SxProps, type Theme, useTheme } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'

export interface SectionProps {
  /** Section title */
  title: string

  /** Optional count badge */
  count?: number

  /** Section content */
  children: React.ReactNode

  /** Start collapsed */
  defaultCollapsed?: boolean

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const Section: React.FC<SectionProps> = ({
  title,
  count,
  children,
  defaultCollapsed = false,
  sx,
}) => {
  const theme = useTheme()
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  const handleToggle = () => {
    setIsCollapsed(!isCollapsed)
  }

  return (
    <Box sx={{ marginBottom: 3, ...sx }}>
      {/* Section Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 2,
          paddingBottom: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        {/* Title + Count */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Typography
            sx={{
              fontSize: '16px',
              fontWeight: 500,
              color: 'primary.light',
            }}
          >
            {title}
          </Typography>
          {count !== undefined && (
            <Box
              component="span"
              sx={{
                background: theme.palette.action.hover,
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                color: 'text.secondary',
              }}
            >
              {count}
            </Box>
          )}
        </Box>

        {/* Expand Button */}
        <IconButton
          onClick={handleToggle}
          size="small"
          sx={{
            color: 'text.secondary',
            padding: 0.5,
            '&:hover': {
              background: theme.palette.action.hover,
            },
          }}
        >
          {isCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </IconButton>
      </Box>

      {/* Section Content */}
      <Collapse in={!isCollapsed}>
        {children}
      </Collapse>
    </Box>
  )
}
