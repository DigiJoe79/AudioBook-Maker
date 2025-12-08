/**
 * ViewTransition - Smooth Transition Wrapper for Views
 *
 * Provides fade-in/out animations when switching between views.
 *
 * Features:
 * - Fade transition with Material-UI Fade component
 * - Memoized for performance
 * - 200ms transition duration (quick but smooth)
 * - Full height/width container
 *
 * Usage:
 * ```tsx
 * <ViewTransition viewKey={currentView}>
 *   {renderCurrentView()}
 * </ViewTransition>
 * ```
 */

import React, { memo } from 'react'
import { Fade, Box } from '@mui/material'

interface ViewTransitionProps {
  children: React.ReactNode
  viewKey: string // currentView - triggers transition when changed
}

/**
 * ViewTransition Component
 *
 * Wraps view content with fade transition.
 * The key prop on Fade triggers transition when viewKey changes.
 */
export const ViewTransition = memo<ViewTransitionProps>(({ children, viewKey }) => {
  return (
    <Fade in={true} timeout={200} key={viewKey}>
      <Box
        sx={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </Box>
    </Fade>
  )
})

ViewTransition.displayName = 'ViewTransition'
