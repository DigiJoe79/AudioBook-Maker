/**
 * Material-UI Theme Configuration
 *
 * Extended theme with Dark + Light mode support for View Pattern System.
 * Integrates Tauri 2.0 theming and provides consistent styling across all components.
 *
 * Features:
 * - Dark Mode: Professional dark palette (#1a1a1a, #242424, #2a2a2a)
 * - Light Mode: Clean light palette with sufficient contrast
 * - Form Control Overrides: Unified TextField, Select, Button styling
 * - Custom Properties: View Pattern tokens (spacing, heights, etc.)
 * - Typography System: Consistent font sizes and weights
 */

import { createTheme, type ThemeOptions, type Theme } from '@mui/material/styles'
import type {} from '@mui/material/themeCssVarsAugmentation'

// Import non-color tokens from viewPatterns
import { spacing, heights, borderRadius, typography, transitions, zIndex, breakpoints } from './viewPatterns'

/**
 * Custom Theme Properties (TypeScript augmentation)
 *
 * Extends MUI Theme with View Pattern tokens.
 */
declare module '@mui/material/styles' {
  interface Theme {
    custom: {
      spacing: typeof spacing
      heights: typeof heights
      borderRadius: typeof borderRadius
      typography: typeof typography
      transitions: typeof transitions
      zIndex: typeof zIndex
      breakpoints: typeof breakpoints
    }
  }
  interface ThemeOptions {
    custom?: {
      spacing?: typeof spacing
      heights?: typeof heights
      borderRadius?: typeof borderRadius
      typography?: typeof typography
      transitions?: typeof transitions
      zIndex?: typeof zIndex
      breakpoints?: typeof breakpoints
    }
  }
}

/**
 * Dark Mode Palette
 *
 * Based on viewPatterns.ts colors for consistency.
 */
const darkPalette = {
  mode: 'dark' as const,

  // Primary Colors
  primary: {
    main: '#1976d2',      // Accent blue (buttons, links)
    light: '#90caf9',     // Accent light blue (headers, highlights)
    dark: '#1565c0',      // Accent dark blue (hover states)
    contrastText: '#fff',
  },

  // Secondary Colors
  secondary: {
    main: '#dc004e',
    contrastText: '#fff',
  },

  // Background Colors
  background: {
    default: '#1a1a1a',   // Main background
    paper: '#242424',     // View/Card background
  },

  // Text Colors
  text: {
    primary: '#e0e0e0',   // Primary text
    secondary: '#b0b0b0', // Secondary text
    disabled: '#888',     // Disabled/Hint text
  },

  // Divider
  divider: '#3a3a3a',

  // Status Colors
  success: {
    main: '#388e3c',
    contrastText: '#fff',
  },
  warning: {
    main: '#f57c00',
    contrastText: '#fff',
  },
  error: {
    main: '#d32f2f',
    contrastText: '#fff',
  },
  info: {
    main: '#1976d2',
    contrastText: '#fff',
  },

  // Action States
  action: {
    active: '#90caf9',
    hover: 'rgba(255, 255, 255, 0.08)',
    hoverOpacity: 0.08,
    selected: 'rgba(144, 202, 249, 0.16)',
    selectedOpacity: 0.16,
    disabled: '#888',
    disabledBackground: 'rgba(255, 255, 255, 0.12)',
    disabledOpacity: 0.38,
    focus: 'rgba(144, 202, 249, 0.12)',
    focusOpacity: 0.12,
  },
}

/**
 * Light Mode Palette
 *
 * Clean, professional light theme with sufficient contrast.
 */
const lightPalette = {
  mode: 'light' as const,

  // Primary Colors
  primary: {
    main: '#1976d2',      // Same blue for consistency
    light: '#42a5f5',
    dark: '#1565c0',
    contrastText: '#fff',
  },

  // Secondary Colors
  secondary: {
    main: '#dc004e',
    contrastText: '#fff',
  },

  // Background Colors
  background: {
    default: '#fafafa',   // Light gray background
    paper: '#ffffff',     // White cards/views
  },

  // Text Colors
  text: {
    primary: '#212121',   // Dark gray text
    secondary: '#757575', // Medium gray text
    disabled: '#bdbdbd',  // Light gray disabled
  },

  // Divider
  divider: '#e0e0e0',

  // Status Colors
  success: {
    main: '#388e3c',
    contrastText: '#fff',
  },
  warning: {
    main: '#f57c00',
    contrastText: '#fff',
  },
  error: {
    main: '#d32f2f',
    contrastText: '#fff',
  },
  info: {
    main: '#1976d2',
    contrastText: '#fff',
  },

  // Action States
  action: {
    active: '#1976d2',
    hover: 'rgba(0, 0, 0, 0.04)',
    hoverOpacity: 0.04,
    selected: 'rgba(25, 118, 210, 0.08)',
    selectedOpacity: 0.08,
    disabled: '#bdbdbd',
    disabledBackground: 'rgba(0, 0, 0, 0.12)',
    disabledOpacity: 0.38,
    focus: 'rgba(25, 118, 210, 0.12)',
    focusOpacity: 0.12,
  },
}

/**
 * Component Overrides
 *
 * Unified styling for form controls and UI components.
 */
const getComponentOverrides = (mode: 'light' | 'dark'): ThemeOptions['components'] => ({
  // TextField - Consistent sizing and styling
  MuiTextField: {
    defaultProps: {
      variant: 'outlined',
      size: 'small',
    },
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': {
          borderRadius: borderRadius.md,
          backgroundColor: mode === 'dark' ? '#2a2a2a' : '#fff',

          '& fieldset': {
            borderColor: mode === 'dark' ? '#3a3a3a' : '#e0e0e0',
          },

          '&:hover fieldset': {
            borderColor: mode === 'dark' ? '#4a4a4a' : '#bdbdbd',
          },

          '&.Mui-focused fieldset': {
            borderColor: '#1976d2',
            borderWidth: '2px',
          },
        },
      },
    },
  },

  // Select - Match TextField styling
  MuiSelect: {
    defaultProps: {
      variant: 'outlined',
      size: 'small',
    },
    styleOverrides: {
      root: {
        borderRadius: borderRadius.md,
        backgroundColor: mode === 'dark' ? '#2a2a2a' : '#fff',
      },
    },
  },

  // FormControl - Consistent sizing
  MuiFormControl: {
    defaultProps: {
      variant: 'outlined',
      size: 'small',
    },
  },

  // OutlinedInput - Base input styling
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: borderRadius.md,
        backgroundColor: mode === 'dark' ? '#2a2a2a' : '#fff',

        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: mode === 'dark' ? '#3a3a3a' : '#e0e0e0',
        },

        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: mode === 'dark' ? '#4a4a4a' : '#bdbdbd',
        },

        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: '#1976d2',
          borderWidth: '2px',
        },
      },
      input: {
        padding: '10px 12px',
      },
    },
  },

  // InputLabel - Consistent positioning
  MuiInputLabel: {
    styleOverrides: {
      root: {
        '&.MuiInputLabel-outlined': {
          transform: 'translate(14px, 11px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, -9px) scale(0.75)',
          },
        },
      },
    },
  },

  // Button - Consistent sizing and styling
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: borderRadius.md,
        textTransform: 'none',
        fontWeight: 500,
      },
      sizeSmall: {
        padding: '4px 12px',
        fontSize: '13px',
      },
      sizeMedium: {
        padding: '8px 16px',
        fontSize: '14px',
      },
      sizeLarge: {
        padding: '12px 24px',
        fontSize: '15px',
      },
    },
  },

  // IconButton - Consistent hover states
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: borderRadius.sm,
        '&:hover': {
          backgroundColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
        },
      },
    },
  },

  // Paper - Consistent elevation
  MuiPaper: {
    styleOverrides: {
      root: {
        backgroundImage: 'none', // Remove default gradient
      },
      outlined: {
        borderColor: mode === 'dark' ? '#3a3a3a' : '#e0e0e0',
      },
    },
  },

  // Chip - Consistent sizing
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: borderRadius.md,
      },
      sizeSmall: {
        height: '24px',
        fontSize: '12px',
      },
    },
  },

  // Tabs - Consistent styling
  MuiTab: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 500,
        fontSize: '14px',
        minHeight: '48px',
        '&.Mui-selected': {
          color: '#1976d2',
        },
      },
    },
  },

  // Switch - Consistent sizing
  MuiSwitch: {
    styleOverrides: {
      root: {
        width: '42px',
        height: '26px',
        padding: '0',
      },
      switchBase: {
        padding: '1px',
        '&.Mui-checked': {
          transform: 'translateX(16px)',
        },
      },
      thumb: {
        width: '24px',
        height: '24px',
      },
      track: {
        borderRadius: '13px',
      },
    },
  },
})

/**
 * Create Extended Theme
 *
 * @param mode - 'light' or 'dark'
 * @returns Complete MUI theme with View Pattern integration
 */
export const createExtendedTheme = (mode: 'light' | 'dark'): Theme => {
  const palette = mode === 'dark' ? darkPalette : lightPalette

  return createTheme({
    palette,

    // Custom View Pattern Tokens
    custom: {
      spacing,
      heights,
      borderRadius,
      typography,
      transitions,
      zIndex,
      breakpoints,
    },

    // Typography System
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),

      h5: {
        fontSize: typography.viewTitle.fontSize,
        fontWeight: typography.viewTitle.fontWeight,
      },

      h6: {
        fontSize: typography.sectionTitle.fontSize,
        fontWeight: typography.sectionTitle.fontWeight,
      },

      body1: {
        fontSize: typography.body.fontSize,
        fontWeight: typography.body.fontWeight,
      },

      body2: {
        fontSize: typography.small.fontSize,
        fontWeight: typography.small.fontWeight,
      },

      caption: {
        fontSize: typography.xs.fontSize,
        fontWeight: typography.xs.fontWeight,
      },
    },

    // Component Overrides
    components: getComponentOverrides(mode),
  })
}

/**
 * Helper: Get background color for elevated surfaces
 *
 * Returns appropriate background color for headers, toolbars, footers.
 */
export const getElevatedBackground = (theme: Theme): string => {
  return theme.palette.mode === 'dark' ? '#2a2a2a' : '#f5f5f5'
}

/**
 * Helper: Get secondary background color
 *
 * Returns appropriate background color for sidebars, secondary panels.
 */
export const getSecondaryBackground = (theme: Theme): string => {
  return theme.palette.mode === 'dark' ? '#282828' : '#fafafa'
}
