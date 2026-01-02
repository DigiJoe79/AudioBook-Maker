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

