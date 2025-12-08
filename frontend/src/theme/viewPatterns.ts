/**
 * View Pattern System - Design Tokens
 *
 * Non-color design tokens for all view components.
 * Based on 8px grid system from HTML mockups.
 *
 * NOTE: Colors are now managed by MUI Theme (theme/index.ts)
 * to support both Dark and Light modes.
 */

/**
 * Spacing Scale (8px grid system)
 *
 * All spacing, margins, paddings should use these values.
 */
export const spacing = {
  /** 8px - Minimal spacing */
  xs: '8px',
  /** 12px - Small spacing (gap between elements) */
  sm: '12px',
  /** 16px - Medium spacing (padding, toolbar, sections) */
  md: '16px',
  /** 24px - Large spacing (content padding, sections) */
  lg: '24px',
  /** 32px - Extra large spacing */
  xl: '32px',
  /** 48px - XXL spacing (major sections) */
  xxl: '48px',
} as const

/**
 * Component Heights (fixed values)
 *
 * All view components use these fixed heights for consistency.
 */
export const heights = {
  /** ViewHeader height */
  header: '72px',
  /** ViewToolbar height (filters) */
  toolbar: '56px',
  /** ViewToolbar height (tabs) */
  tabs: '48px',
  /** ViewFooter height */
  footer: '56px',
  /** Sidebar width */
  sidebar: '280px',
  /** AudioPlayer height */
  audioPlayer: '120px',
  /** Form control height (TextField, Select, etc.) */
  formControl: '58px',
} as const

/**
 * Border Radius
 */
export const borderRadius = {
  /** Small (4px) - badges, buttons */
  sm: '4px',
  /** Medium (6px) - list items */
  md: '6px',
  /** Large (8px) - cards, containers */
  lg: '8px',
  /** Extra large (12px) - count badges */
  xl: '8px',
} as const

/**
 * Typography
 */
export const typography = {
  /** View title */
  viewTitle: {
    fontSize: '20px',
    fontWeight: 500,
  },
  /** Section title */
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 500,
  },
  /** Body text */
  body: {
    fontSize: '14px',
    fontWeight: 400,
  },
  /** Small text (meta, hints) */
  small: {
    fontSize: '13px',
    fontWeight: 400,
  },
  /** Extra small (labels, badges) */
  xs: {
    fontSize: '12px',
    fontWeight: 500,
  },
  /** Tiny (count badges) */
  tiny: {
    fontSize: '11px',
    fontWeight: 600,
  },
} as const

/**
 * Transitions
 */
export const transitions = {
  /** Standard transition duration */
  duration: '200ms',
  /** Slow transition (collapse, sidebar) */
  slow: '300ms',
  /** Fast transition (hover) */
  fast: '150ms',
  /** Easing function */
  easing: 'ease',
} as const

/**
 * Z-Index Scale
 */
export const zIndex = {
  /** Annotations/labels */
  annotation: 10,
  /** Dropdowns */
  dropdown: 100,
  /** Modals/Dialogs */
  modal: 1000,
  /** Toasts/Notifications */
  toast: 1100,
  /** Tooltips */
  tooltip: 1200,
} as const

/**
 * Breakpoints (for responsive design)
 */
export const breakpoints = {
  /** Mobile (768px) */
  mobile: '768px',
  /** Tablet (900px) */
  tablet: '900px',
  /** Desktop (1200px) */
  desktop: '1200px',
} as const

