/**
 * App - Root Component with Routing
 *
 * Sets up React Router with two main routes:
 * - / (StartPage): Backend connection & profile management
 * - /app (MainApp): Protected main application (requires backend connection)
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { ThemeProvider, CssBaseline, GlobalStyles } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, type Theme } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'
import StartPage from './pages/StartPage'
import MainApp from './pages/MainApp'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettings } from './hooks/useSettings'
import { useUISettingsStore } from './store/uiSettingsStore'
import { logger } from './utils/logger'
import { createExtendedTheme } from './theme'

function App() {
  // Window reference for theme management
  const windowRef = useRef(getCurrentWindow())
  const { i18n } = useTranslation()

  // Load backend settings (React Query) - only when connected
  useSettings()

  // Use UI settings from local store (always available)
  const uiSettings = useUISettingsStore((state) => state.settings)

  // Detect system theme preference using Tauri's native API
  const [prefersDarkMode, setPrefersDarkMode] = useState(false)

  // Get initial theme and listen for changes
  useEffect(() => {
    const checkTheme = async () => {
      try {
        const currentTheme = await windowRef.current.theme()
        const isDark = currentTheme === 'dark'

        logger.group(
          '🎨 Theme Detection',
          'System theme detected via Tauri API',
          {
            'Tauri Theme': currentTheme,
            'Is Dark Mode': isDark,
            'Source': 'Tauri window.theme()'
          },
          '#9C27B0' // Purple for theme detection
        )

        setPrefersDarkMode(isDark)
      } catch (err) {
        logger.warn('[App] Failed to get theme:', err)

        // Fallback to media query
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        logger.group(
          '⚠️ Theme Detection Fallback',
          'Using media query fallback',
          {
            'Media Query Result': isDark ? 'dark' : 'light',
            'Source': 'window.matchMedia()',
            'Reason': 'Tauri API failed'
          },
          '#FF9800' // Orange for warning/fallback
        )

        setPrefersDarkMode(isDark)
      }
    }

    // Initial check
    checkTheme()

    // Listen for theme changes using Tauri's event system
    let unlisten: (() => void) | undefined

    const setupListener = async () => {
      try {
        unlisten = await windowRef.current.onThemeChanged((event) => {
          logger.group(
            '🔄 Theme Change',
            'System theme changed',
            {
              'New Theme': event.payload,
              'Is Dark Mode': event.payload === 'dark',
              'Source': 'Tauri theme change event'
            },
            '#2196F3' // Blue for events
          )

          setPrefersDarkMode(event.payload === 'dark')
        })
      } catch (err) {
        logger.warn('[App] Could not setup theme listener:', err)
        // Fallback to polling
        const pollInterval = setInterval(checkTheme, 5000)
        unlisten = () => clearInterval(pollInterval)
      }
    }

    setupListener()

    return () => {
      unlisten?.()
    }
  }, [])

  // Determine effective theme mode
  const themeMode = useMemo(() => {
    // Use UI settings (always available from localStorage)
    const themeSetting = uiSettings.theme
    const resultingMode = themeSetting === 'system'
      ? (prefersDarkMode ? 'dark' : 'light')
      : themeSetting

    logger.group(
      '⚙️ Theme Calculation',
      'Computing effective theme mode',
      {
        'User Setting': themeSetting,
        'System Prefers Dark': prefersDarkMode,
        'Resulting Mode': resultingMode
      },
      '#607D8B' // Gray for computation
    )

    return resultingMode
  }, [uiSettings.theme, prefersDarkMode])

  // Create extended theme based on mode
  const theme = useMemo(() => {
    logger.group(
      '🎨 Theme Creation',
      'Building Extended Material-UI theme with View Pattern System',
      {
        'Mode': themeMode,
        'Primary Color': '#1976d2',
        'View Pattern Integration': 'Enabled',
        'Form Control Overrides': 'Applied',
        'Dark BG': themeMode === 'dark' ? '#1a1a1a' : '#fafafa',
        'Paper BG': themeMode === 'dark' ? '#242424' : '#ffffff'
      },
      '#9C27B0' // Purple for theme creation
    )

    return createExtendedTheme(themeMode)
  }, [themeMode])

  // Sync i18n language with UI settings
  useEffect(() => {
    i18n.changeLanguage(uiSettings.uiLanguage)
  }, [uiSettings.uiLanguage, i18n])

  // Sync Tauri window theme with app theme
  useEffect(() => {
    if (uiSettings.theme === 'system') {
      // Reset to system theme (null = follow OS)
      logger.group(
        '🔄 Window Theme Sync',
        'Resetting to system theme',
        {
          'Action': 'setTheme(null)',
          'Mode': 'Follow OS',
          'User Setting': 'system'
        },
        '#2196F3' // Blue for sync operations
      )

      windowRef.current.setTheme(null).catch((err) => {
        logger.error('[App] Failed to reset window theme:', err)
      })
    } else {
      // Set explicit theme
      const tauriTheme: Theme = themeMode === 'dark' ? 'dark' : 'light'

      logger.group(
        '🔄 Window Theme Sync',
        'Setting explicit window theme',
        {
          'Action': `setTheme('${tauriTheme}')`,
          'Theme Mode': themeMode,
          'User Setting': uiSettings.theme
        },
        '#2196F3' // Blue for sync operations
      )

      windowRef.current.setTheme(tauriTheme).catch((err) => {
        logger.error('[App] Failed to set window theme:', err)
      })
    }
  }, [themeMode, uiSettings.theme])

  // Show window when React is fully loaded and ready
  useEffect(() => {
    logger.group(
      '🚀 App Initialization',
      'React fully loaded, showing window',
      {
        'Action': 'invoke(show_main_window)',
        'Delay': '50ms',
        'Reason': 'Ensure all components are mounted'
      },
      '#4CAF50' // Green for success/initialization
    )

    // Small delay to ensure all components are mounted
    const timer = setTimeout(() => {
      invoke('show_main_window').catch((err) => {
        logger.error('[App] Failed to show window:', err)
      })
    }, 50)

    return () => clearTimeout(timer)
  }, [])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          '*::-webkit-scrollbar': {
            width: '12px',
            height: '12px',
          },
          '*::-webkit-scrollbar-track': {
            background: theme.palette.mode === 'dark' ? '#1e1e1e' : '#f1f1f1',
          },
          '*::-webkit-scrollbar-thumb': {
            background: theme.palette.mode === 'dark' ? '#555' : '#888',
            borderRadius: '6px',
          },
          '*::-webkit-scrollbar-thumb:hover': {
            background: theme.palette.mode === 'dark' ? '#777' : '#555',
          },
        }}
      />
      <BrowserRouter>
        <Routes>
          {/* Start Page - Backend Connection */}
          <Route
            path="/"
            element={
              <ErrorBoundary context="StartPage" critical={true}>
                <StartPage />
              </ErrorBoundary>
            }
          />

          {/* Main App - Protected (requires backend connection) */}
          <Route
            path="/app"
            element={
              <ErrorBoundary context="MainApp" critical={true}>
                <ProtectedRoute>
                  <MainApp />
                </ProtectedRoute>
              </ErrorBoundary>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
