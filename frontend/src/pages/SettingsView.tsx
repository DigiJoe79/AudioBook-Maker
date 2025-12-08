/**
 * SettingsView - Application Settings
 *
 * Full-screen settings view.
 *
 * Tabs:
 * - General Settings (theme, language, text segmentation, audio export)
 * - Engines (engine management via embedded EnginesView, includes TTS languages)
 */

import React, { useState, memo, useCallback } from 'react'
import {
  Box,
  Tabs,
  Tab,
  Button,
  TextField,
  Slider,
  Typography,
  CircularProgress,
  Alert,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material'
import {
  RestartAlt as ResetIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useSettings, useUpdateSettings, useResetSettings } from '@hooks/useSettings'
import { SettingsSection } from '@components/settings/SettingsComponents'
import { useAppStore, type GlobalSettings } from '@store/appStore'
import { useUISettingsStore, type UISettings } from '@store/uiSettingsStore'
import { useConfirm } from '@hooks/useConfirm'
import { useSnackbar } from '@hooks/useSnackbar'
import { logger } from '@utils/logger'
import { translateBackendError } from '@utils/translateBackendError'
import { initializeDefaultProfile } from '@services/backendProfiles'
import {
  ViewContainer,
  ViewHeader,
  ViewToolbar,
  ViewContent,
} from '@components/layout/ViewComponents'
import EnginesView from './EnginesView'

// ============================================================================
// Tab Panel Component
// ============================================================================

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

const TabPanel = memo(({ children, value, index }: TabPanelProps) => (
  <Box hidden={value !== index} sx={{ py: 3, px: 2 }}>
    {value === index && children}
  </Box>
))

TabPanel.displayName = 'TabPanel'

// ============================================================================
// Main SettingsView Component
// ============================================================================

const SettingsView = memo(() => {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  const [activeTab, setActiveTab] = useState(0)

  // Use settings directly from stores (no local state - auto-save on change)
  const settings = useAppStore((state) => state.settings)
  const uiSettings = useUISettingsStore((state) => state.settings)
  const updateUISettings = useUISettingsStore((state) => state.updateSettings)
  const { isLoading, error } = useSettings()
  const updateMutation = useUpdateSettings()
  const resetMutation = useResetSettings()

  const handleTabChange = useCallback((_: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue)
  }, [])

  // Auto-save UI settings (theme, language) - stored in localStorage
  const handleUISettingChange = useCallback(<K extends keyof UISettings>(
    key: K,
    value: UISettings[K]
  ) => {
    updateUISettings({ [key]: value } as Partial<UISettings>)
  }, [updateUISettings])

  // Auto-save backend settings - stored in database
  const handleSettingChange = useCallback(async <K extends keyof GlobalSettings>(
    category: K,
    key: string,
    value: unknown
  ) => {
    if (!settings?.[category]) return

    try {
      const updatedCategory = { ...settings[category], [key]: value }
      await updateMutation.mutateAsync({
        category,
        value: updatedCategory,
      })
    } catch (err: unknown) {
      logger.error('[SettingsView] Failed to save setting:', err)
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('settings.messages.saveFailed'),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
    }
  }, [settings, updateMutation, showSnackbar, t])

  const handleReset = useCallback(async () => {
    const confirmed = await confirm(
      t('settings.actions.resetToDefaults'),
      t('settings.messages.resetConfirm'),
      {
        icon: <WarningIcon color="warning" />,
        confirmColor: 'warning',
      }
    )

    if (confirmed) {
      try {
        logger.debug('[SettingsView] Resetting all settings and localStorage')

        // 1. Reset backend settings via API
        await resetMutation.mutateAsync()

        // 2. Clear localStorage (frontend state)
        // Important: Preserve backend-profiles key by saving and restoring it
        const backendProfilesKey = 'audiobook-maker:backend-profiles'
        const backendProfiles = localStorage.getItem(backendProfilesKey)

        // Clear everything
        localStorage.clear()
        sessionStorage.clear()

        // Restore backend profiles if they existed, otherwise initialize default
        if (backendProfiles) {
          localStorage.setItem(backendProfilesKey, backendProfiles)
        } else {
          initializeDefaultProfile()
        }

        showSnackbar(t('settings.messages.reset'), { severity: 'success' })

        // 3. Reload page to reinitialize all stores with defaults
        setTimeout(() => {
          window.location.reload()
        }, 500)
      } catch (err: unknown) {
        logger.error('[SettingsView] Failed to reset settings:', err)
        const errorMessage = translateBackendError(
          err instanceof Error ? err.message : t('settings.messages.resetFailed'),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
      }
    }
  }, [confirm, t, resetMutation, showSnackbar])

  if (isLoading) {
    return (
      <ViewContainer>
        <ViewContent>
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <CircularProgress />
          </Box>
        </ViewContent>
      </ViewContainer>
    )
  }

  if (error || !settings) {
    return (
      <ViewContainer>
        <ViewContent>
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Alert severity="error">{t('settings.messages.error')}</Alert>
          </Box>
        </ViewContent>
      </ViewContainer>
    )
  }

  return (
    <ViewContainer>
      {/* Header */}
      <ViewHeader
        title={t('settings.title')}
        actions={
          <Button onClick={handleReset} color="warning" startIcon={<ResetIcon />} size="small">
            {t('settings.actions.reset')}
          </Button>
        }
      />

      {/* Tabs */}
      <ViewToolbar variant="tabs">
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab label={t('settings.tabs.general')} />
          <Tab label={t('settings.tabs.engines')} />
        </Tabs>
      </ViewToolbar>

      {/* Tab Content - Scrollable */}
      <ViewContent>
        {/* General Tab */}
        <TabPanel value={activeTab} index={0}>
          <Grid container spacing={3}>
            {/* Row 1: Interface + Text */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <SettingsSection title={t('settings.general.interfaceSection')} sx={{ height: '100%' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Theme */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {t('settings.general.theme')}
                    </Typography>
                    <ToggleButtonGroup
                      value={uiSettings.theme}
                      exclusive
                      onChange={(_, val) => val && handleUISettingChange('theme', val)}
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          minWidth: 70,
                          px: 1.5,
                          py: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'none',
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&.Mui-selected': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            '&:hover': { bgcolor: 'primary.dark' },
                          },
                        },
                      }}
                    >
                      <ToggleButton value="light">{t('settings.general.themeLight')}</ToggleButton>
                      <ToggleButton value="dark">{t('settings.general.themeDark')}</ToggleButton>
                      <ToggleButton value="system">{t('settings.general.themeSystem')}</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  {/* Language */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {t('settings.general.uiLanguage')}
                    </Typography>
                    <ToggleButtonGroup
                      value={uiSettings.uiLanguage}
                      exclusive
                      onChange={(_, val) => val && handleUISettingChange('uiLanguage', val)}
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          minWidth: 105,
                          px: 1.5,
                          py: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'none',
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&.Mui-selected': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            '&:hover': { bgcolor: 'primary.dark' },
                          },
                        },
                      }}
                    >
                      <ToggleButton value="de">{t('languages.de')}</ToggleButton>
                      <ToggleButton value="en">{t('languages.en')}</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                </Box>
              </SettingsSection>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <SettingsSection title={t('settings.text.segmentationSection')} sx={{ height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      {t('settings.text.preferredMaxSegmentLength')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.text.preferredMaxSegmentLengthDesc')}
                    </Typography>
                  </Box>
                  <TextField
                    type="number"
                    size="small"
                    value={settings.text.preferredMaxSegmentLength}
                    onChange={(e) => handleSettingChange('text', 'preferredMaxSegmentLength', parseInt(e.target.value))}
                    sx={{
                      width: 100,
                      '& .MuiInputBase-root': { height: 36 },
                      '& .MuiInputBase-input': { textAlign: 'center', fontWeight: 600 },
                    }}
                  />
                </Box>
              </SettingsSection>
            </Grid>

            {/* Row 2: Audio Format + Pauses */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <SettingsSection title={t('settings.audio.exportSettingsSection')} sx={{ height: '100%' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Format */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {t('settings.audio.defaultFormat')}
                    </Typography>
                    <ToggleButtonGroup
                      value={settings.audio.defaultFormat}
                      exclusive
                      onChange={(_, val) => val && handleSettingChange('audio', 'defaultFormat', val)}
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          minWidth: 70,
                          px: 1.5,
                          py: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&.Mui-selected': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            '&:hover': { bgcolor: 'primary.dark' },
                          },
                        },
                      }}
                    >
                      <ToggleButton value="mp3">MP3</ToggleButton>
                      <ToggleButton value="m4a">M4A</ToggleButton>
                      <ToggleButton value="wav">WAV</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  {/* Quality */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {t('settings.audio.defaultQuality')}
                    </Typography>
                    <ToggleButtonGroup
                      value={settings.audio.defaultQuality}
                      exclusive
                      onChange={(_, val) => val && handleSettingChange('audio', 'defaultQuality', val)}
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          minWidth: 70,
                          px: 1.5,
                          py: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'none',
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&.Mui-selected': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            '&:hover': { bgcolor: 'primary.dark' },
                          },
                        },
                      }}
                    >
                      <ToggleButton value="low">{t('settings.audio.qualityLow')}</ToggleButton>
                      <ToggleButton value="medium">{t('settings.audio.qualityMedium')}</ToggleButton>
                      <ToggleButton value="high">{t('settings.audio.qualityHigh')}</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                </Box>
              </SettingsSection>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <SettingsSection title={t('settings.audio.pausesSection')} sx={{ height: '100%' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* Pause between segments */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {t('settings.audio.pauseBetweenSegments')}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} color="primary.main" sx={{ minWidth: 45, textAlign: 'right' }}>
                        {(settings.audio.pauseBetweenSegments / 1000).toFixed(1)}s
                      </Typography>
                    </Box>
                    <Slider
                      value={settings.audio.pauseBetweenSegments}
                      onChangeCommitted={(_, val) => handleSettingChange('audio', 'pauseBetweenSegments', val as number)}
                      min={0}
                      max={5000}
                      step={100}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(val) => `${(val / 1000).toFixed(1)}s`}
                      size="small"
                    />
                  </Box>

                  {/* Divider duration */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {t('settings.audio.defaultDividerDuration')}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} color="primary.main" sx={{ minWidth: 45, textAlign: 'right' }}>
                        {(settings.audio.defaultDividerDuration / 1000).toFixed(1)}s
                      </Typography>
                    </Box>
                    <Slider
                      value={settings.audio.defaultDividerDuration}
                      onChangeCommitted={(_, val) => handleSettingChange('audio', 'defaultDividerDuration', val as number)}
                      min={0}
                      max={10000}
                      step={500}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(val) => `${(val / 1000).toFixed(1)}s`}
                      size="small"
                    />
                  </Box>
                </Box>
              </SettingsSection>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Engines Tab */}
        <TabPanel value={activeTab} index={1}>
          <EnginesView embedded />
        </TabPanel>
      </ViewContent>

      <ConfirmDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </ViewContainer>
  )
})

SettingsView.displayName = 'SettingsView'

export default SettingsView
