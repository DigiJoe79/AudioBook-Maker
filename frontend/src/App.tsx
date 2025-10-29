
import { useEffect, useRef, useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
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

function App() {
  const windowRef = useRef(getCurrentWindow())
  const { i18n } = useTranslation()

  useSettings()

  const uiSettings = useUISettingsStore((state) => state.settings)

  const [prefersDarkMode, setPrefersDarkMode] = useState(false)

  useEffect(() => {
    const checkTheme = async () => {
      try {
        const currentTheme = await windowRef.current.theme()
        const isDark = currentTheme === 'dark'
        logger.debug('[App] Tauri theme detection:', {
          theme: currentTheme,
          isDark
        })
        setPrefersDarkMode(isDark)
      } catch (err) {
        logger.warn('[App] Failed to get theme:', err)
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        logger.debug('[App] Fallback to media query:', isDark ? 'dark' : 'light')
        setPrefersDarkMode(isDark)
      }
    }

    checkTheme()

    let unlisten: (() => void) | undefined

    const setupListener = async () => {
      try {
        unlisten = await windowRef.current.onThemeChanged((event) => {
          logger.debug('[App] System theme changed (Tauri event):', event.payload)
          setPrefersDarkMode(event.payload === 'dark')
        })
      } catch (err) {
        logger.warn('[App] Could not setup theme listener:', err)
        const pollInterval = setInterval(checkTheme, 5000)
        unlisten = () => clearInterval(pollInterval)
      }
    }

    setupListener()

    return () => {
      unlisten?.()
    }
  }, [])

  const themeMode = useMemo(() => {
    const themeSetting = uiSettings.theme
    logger.debug('[App] Theme calculation:', {
      themeSetting,
      prefersDarkMode,
      resultingMode: themeSetting === 'system' ? (prefersDarkMode ? 'dark' : 'light') : themeSetting
    })
    if (themeSetting === 'system') {
      return prefersDarkMode ? 'dark' : 'light'
    }
    return themeSetting
  }, [uiSettings.theme, prefersDarkMode])

  const theme = useMemo(() => {
    logger.debug('[App] Creating theme with mode:', themeMode)
    return createTheme({
      palette: {
        mode: themeMode,
        primary: {
          main: '#1976d2',
        },
        secondary: {
          main: '#dc004e',
        },
        ...(themeMode === 'dark' && {
          background: {
            default: '#121212',
            paper: '#1e1e1e',
          },
        }),
      },
    })
  }, [themeMode])

  useEffect(() => {
    i18n.changeLanguage(uiSettings.uiLanguage)
  }, [uiSettings.uiLanguage, i18n])

  useEffect(() => {
    if (uiSettings.theme === 'system') {
      logger.debug('[App] Resetting to system theme')
      windowRef.current.setTheme(null).catch((err) => {
        logger.error('[App] Failed to reset window theme:', err)
      })
    } else {
      const tauriTheme: Theme = themeMode === 'dark' ? 'dark' : 'light'
      logger.debug('[App] Setting Tauri window theme:', tauriTheme)
      windowRef.current.setTheme(tauriTheme).catch((err) => {
        logger.error('[App] Failed to set window theme:', err)
      })
    }
  }, [themeMode, uiSettings.theme])

  useEffect(() => {
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
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <ErrorBoundary context="StartPage" critical={true}>
                <StartPage />
              </ErrorBoundary>
            }
          />

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
