/**
 * EmptyState Component
 *
 * Display when a view/section has no content.
 *
 * Pattern Specs:
 * - Text align: center
 * - Padding: 48px 24px
 * - Icon: 64px x 64px, color #3a3a3a
 * - Text color: #b0b0b0
 */

import React from 'react'
import { Box, Typography, type SxProps, type Theme } from '@mui/material'

interface EmptyStateProps {
  /** Icon to display (SVG or MUI Icon) */
  icon?: React.ReactNode

  /** Primary message */
  message: string

  /** Optional secondary message */
  description?: string

  /** Optional action button */
  action?: React.ReactNode

  /** Override default styles */
  sx?: SxProps<Theme>
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  message,
  description,
  action,
  sx,
}) => {
  return (
    <Box
      sx={{
        textAlign: 'center',
        padding: '48px 24px',
        color: '#b0b0b0',
        ...sx,
      }}
    >
      {/* Icon */}
      {icon && (
        <Box
          sx={{
            width: '64px',
            height: '64px',
            margin: '0 auto 16px',
            color: '#3a3a3a',
            '& svg': {
              width: '100%',
              height: '100%',
              fill: 'currentColor',
            },
          }}
        >
          {icon}
        </Box>
      )}

      {/* Message */}
      <Typography
        sx={{
          fontSize: '14px',
          color: '#b0b0b0',
          marginBottom: description ? '8px' : 0,
        }}
      >
        {message}
      </Typography>

      {/* Description */}
      {description && (
        <Typography
          sx={{
            fontSize: '13px',
            color: '#888',
            marginBottom: action ? '16px' : 0,
          }}
        >
          {description}
        </Typography>
      )}

      {/* Action */}
      {action && <Box sx={{ marginTop: '16px' }}>{action}</Box>}
    </Box>
  )
}
