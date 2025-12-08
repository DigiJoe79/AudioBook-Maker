/**
 * useNavigationShortcuts - Keyboard Shortcuts for Navigation
 *
 * Handles global keyboard shortcuts for navigation:
 * - Cmd/Ctrl+1-6: Navigate to views
 * - Cmd/Ctrl+B: Toggle project sidebar (only in main view)
 * - Cmd/Ctrl+[: Go back to previous view
 *
 * Features:
 * - Cross-platform (Mac: Cmd, Windows/Linux: Ctrl)
 * - Prevents default browser behavior
 * - Proper cleanup with useEffect
 * - TypeScript strict mode compatible
 */

import { useEffect, useCallback } from 'react'
import { useNavigationStore } from '@store/navigationStore'
import type { ViewType } from '@types'
import { logger } from '@utils/logger'

/**
 * Map keyboard keys to view types (workflow-based order)
 */
const KEY_TO_VIEW: Record<string, ViewType> = {
  '1': 'main',
  '2': 'import',
  '3': 'speakers',
  '4': 'pronunciation',
  '5': 'monitoring',
  '6': 'settings',
}

/**
 * Hook for handling navigation keyboard shortcuts
 */
export function useNavigationShortcuts() {
  const currentView = useNavigationStore((state) => state.currentView)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const goBack = useNavigationStore((state) => state.goBack)
  const toggleProjectSidebar = useNavigationStore((state) => state.toggleProjectSidebar)

  // Memoized keyboard handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const isModifierPressed = event.metaKey || event.ctrlKey

      if (!isModifierPressed) {
        return
      }

      // Handle number keys (1-6) for view navigation
      if (event.key in KEY_TO_VIEW) {
        event.preventDefault()
        const targetView = KEY_TO_VIEW[event.key]

        if (import.meta.env.DEV) {
          logger.debug('[NavigationShortcuts] View shortcut triggered:', {
            key: event.key,
            view: targetView,
          })
        }

        navigateTo(targetView)
        return
      }

      // Handle Cmd/Ctrl+B for project sidebar toggle (only in main view)
      if (event.key.toLowerCase() === 'b') {
        if (currentView === 'main') {
          event.preventDefault()

          if (import.meta.env.DEV) {
            logger.debug('[NavigationShortcuts] Sidebar toggle shortcut triggered')
          }

          toggleProjectSidebar()
        }
        return
      }

      // Handle Cmd/Ctrl+[ for back navigation
      if (event.key === '[') {
        event.preventDefault()

        if (import.meta.env.DEV) {
          logger.debug('[NavigationShortcuts] Back navigation shortcut triggered')
        }

        goBack()
        return
      }
    },
    [currentView, navigateTo, goBack, toggleProjectSidebar]
  )

  // Register and cleanup keyboard event listener
  useEffect(() => {
    // Register event listener
    window.addEventListener('keydown', handleKeyDown)

    // Cleanup on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
