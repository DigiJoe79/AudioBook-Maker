/**
 * Navigation Store - Teams-Style Navigation State Management
 *
 * Manages application-wide navigation state with localStorage persistence.
 *
 * Features:
 * - View navigation with history tracking
 * - Project sidebar collapse state
 * - localStorage sync for persistent state
 * - TypeScript strict mode compatible
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { produce } from 'immer'
import type { ViewType, NavigationState } from '@types'
import { logger } from '@utils/logger'

interface NavigationStore extends NavigationState {
  // Actions
  navigateTo: (view: ViewType) => void
  goBack: () => void
  toggleProjectSidebar: () => void
}

const DEFAULT_STATE: NavigationState = {
  currentView: 'main',
  previousView: null,
  projectSidebarCollapsed: false,
}

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_STATE,

      // Navigate to a new view, tracking previous view for back navigation
      navigateTo: (view: ViewType) => {
        const currentView = get().currentView

        // Don't navigate if already on this view
        if (currentView === view) {
          if (import.meta.env.DEV) {
            logger.debug('[NavigationStore] Already on view:', view)
          }
          return
        }

        logger.group(
          '🧭 Navigation',
          'Navigating to view',
          {
            from: currentView,
            to: view,
          },
          '#2196F3' // Blue for navigation
        )

        set(
          produce((draft) => {
            draft.previousView = currentView
            draft.currentView = view
          })
        )
      },

      // Navigate back to previous view
      goBack: () => {
        const { previousView, currentView } = get()

        if (!previousView) {
          if (import.meta.env.DEV) {
            logger.debug('[NavigationStore] No previous view to go back to')
          }
          return
        }

        logger.group(
          '🧭 Navigation',
          'Going back to previous view',
          {
            from: currentView,
            to: previousView,
          },
          '#2196F3' // Blue for navigation
        )

        set(
          produce((draft) => {
            draft.currentView = previousView
            draft.previousView = null
          })
        )
      },

      // Toggle project sidebar collapsed state
      toggleProjectSidebar: () => {
        const collapsed = get().projectSidebarCollapsed

        logger.group(
          '🧭 Navigation',
          'Toggling project sidebar',
          {
            previousState: collapsed ? 'collapsed' : 'expanded',
            newState: collapsed ? 'expanded' : 'collapsed',
          },
          '#2196F3' // Blue for navigation
        )

        set(
          produce((draft) => {
            draft.projectSidebarCollapsed = !collapsed
          })
        )
      },
    }),
    {
      name: 'audiobook-maker:navigation', // localStorage key
      version: 1,
      // Only persist currentView and projectSidebarCollapsed
      // previousView is intentionally not persisted (session-only)
      partialize: (state) => ({
        currentView: state.currentView,
        projectSidebarCollapsed: state.projectSidebarCollapsed,
      }),
    }
  )
)
