/**
 * Navigation Types - Teams-Style Navigation System
 *
 * Defines types for the multi-view navigation sidebar with keyboard shortcuts.
 */

/**
 * Available view types in the application
 * - monitoring: Combined Jobs & Activity monitoring (with tabs)
 * - import: Markdown import view
 * - main: Main audiobook creation view (current ChapterView)
 * - settings: Application settings
 * - pronunciation: Pronunciation rules editor
 * - speakers: Speaker management
 */
export type ViewType = 'monitoring' | 'import' | 'main' | 'settings' | 'pronunciation' | 'speakers'

/**
 * Navigation state interface
 */
export interface NavigationState {
  /** Currently active view */
  currentView: ViewType
  /** Previous view for back navigation */
  previousView: ViewType | null
  /** Whether the project sidebar is collapsed (only applies to 'main' view) */
  projectSidebarCollapsed: boolean
}

/**
 * Keyboard shortcut mapping for navigation
 */
export interface NavigationShortcut {
  /** Keyboard key (1-6 for views, B for sidebar toggle, [ for back) */
  key: string
  /** Target view or action */
  action: ViewType | 'toggleSidebar' | 'goBack'
  /** Human-readable label for tooltips */
  label: string
  /** Modifier keys required (Cmd on Mac, Ctrl on Windows) */
  modifiers: {
    ctrlOrCmd: boolean
  }
}

/**
 * Predefined keyboard shortcuts
 */
export const NAVIGATION_SHORTCUTS: NavigationShortcut[] = [
  { key: '1', action: 'main', label: 'Ctrl+1', modifiers: { ctrlOrCmd: true } },
  { key: '2', action: 'import', label: 'Ctrl+2', modifiers: { ctrlOrCmd: true } },
  { key: '3', action: 'speakers', label: 'Ctrl+3', modifiers: { ctrlOrCmd: true } },
  { key: '4', action: 'pronunciation', label: 'Ctrl+4', modifiers: { ctrlOrCmd: true } },
  { key: '5', action: 'monitoring', label: 'Ctrl+5', modifiers: { ctrlOrCmd: true } },
  { key: '6', action: 'settings', label: 'Ctrl+6', modifiers: { ctrlOrCmd: true } },
  { key: 'b', action: 'toggleSidebar', label: 'Ctrl+B', modifiers: { ctrlOrCmd: true } },
  { key: '[', action: 'goBack', label: 'Ctrl+[', modifiers: { ctrlOrCmd: true } },
]
