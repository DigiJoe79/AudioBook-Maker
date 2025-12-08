/**
 * EnginesView - Engine Management Interface
 *
 * Displays three engine cards in a row (Text, TTS, STT), each card is a dropdown
 * to select the default engine for that type.
 *
 * Features:
 * - 3 engine cards in a row (Text Processing, TTS, STT)
 * - Each card shows current default engine
 * - Click card to open dropdown with other engines
 * - Settings icon opens engine configuration dialog
 * - Enable/disable engines from dropdown
 *
 * @param embedded - When true, renders without ViewContainer/ViewHeader (for MonitoringView tabs)
 */

import React, { useCallback, useState, useEffect } from 'react'
import {
  Box,
  Grid,
  CircularProgress,
  Alert,
  Paper,
  Typography,
  Divider,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useAllEnginesStatus, useSetDefaultEngine, useClearDefaultEngine } from '@hooks/useEnginesQuery'
import { useSetEngineEnabled } from '@hooks/useTTSQuery'
import { useSettings, useUpdateSettings } from '@hooks/useSettings'
import { useAppStore } from '@store/appStore'
import { useError } from '@hooks/useError'
import { translateBackendError } from '@utils/translateBackendError'
import { logger } from '@utils/logger'
import { ViewContainer, ViewHeader, ViewContent } from '@components/layout/ViewComponents'
import { SettingsToggle, SettingsNumberToggle, SettingsOptionToggle } from '@components/settings/SettingsComponents'
import EngineDropdownCard from '@components/engines/EngineDropdownCard'
import SingleEngineSelector from '@components/engines/SingleEngineSelector'
import EngineSettingsDialog from '@components/engines/EngineSettingsDialog'
import GlobalEngineSettingsCard from '@components/engines/GlobalEngineSettingsCard'
import type { EngineType, EngineStatusInfo } from '@/types/engines'

export interface EnginesViewProps {
  embedded?: boolean
}

export default function EnginesView({ embedded = false }: EnginesViewProps) {
  const { t } = useTranslation()
  const { showError, ErrorDialog } = useError()

  // Dialog state
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [selectedEngine, setSelectedEngine] = useState<EngineStatusInfo | null>(null)

  // Global engine settings state
  const [timeoutMinutes, setTimeoutMinutes] = useState(5)
  const [autostart, setAutostart] = useState(true)

  // Queries and mutations
  const { data: allEnginesData, isLoading, error } = useAllEnginesStatus()
  const setDefaultEngineMutation = useSetDefaultEngine()
  const setEngineEnabledMutation = useSetEngineEnabled()
  const { refetch: refetchSettings } = useSettings()
  const updateSettingsMutation = useUpdateSettings()

  // Default engines from settings
  const defaultTtsEngine = useAppStore((state) => state.getDefaultTtsEngine())
  const defaultSttEngine = useAppStore((state) => state.getDefaultSttEngine())
  const defaultTextEngine = useAppStore((state) => state.getDefaultTextEngine())
  const defaultAudioEngine = useAppStore((state) => state.getDefaultAudioEngine())
  const settings = useAppStore((state) => state.settings)

  // Quality settings from store
  const qualitySettings = settings?.quality

  // Initialize global engine settings from store
  useEffect(() => {
    if (settings?.engines) {
      setTimeoutMinutes(settings.engines.inactivityTimeoutMinutes ?? 5)
      setAutostart(settings.engines.autostartKeepRunning ?? true)
    }
  }, [settings?.engines])

  // Clear default engine mutation
  const clearDefaultEngineMutation = useClearDefaultEngine()

  // Handle default engine change (for TTS - multi-engine)
  const handleDefaultEngineChange = useCallback(async (engineType: EngineType, engineName: string) => {
    try {
      await setDefaultEngineMutation.mutateAsync({
        engineType,
        engineName,
      })
      logger.info(`[EnginesView] Default ${engineType} engine changed to ${engineName}`)
    } catch (err) {
      logger.error('[EnginesView] Failed to change default engine:', err)
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('engines.setDefaultEngineError'),
        t
      )
      await showError(t('engines.setDefaultEngineErrorTitle'), errorMessage)
    }
  }, [setDefaultEngineMutation, t, showError])

  // Handle active engine change for single-engine types (STT, Audio, Text)
  // Empty string = deactivate
  const handleSingleEngineChange = useCallback(async (engineType: Exclude<EngineType, 'tts'>, engineName: string) => {
    try {
      if (engineName === '') {
        // Deactivate - clear the default
        await clearDefaultEngineMutation.mutateAsync({ engineType })
        logger.info(`[EnginesView] ${engineType} engine deactivated`)
      } else {
        // Activate - set as default
        await setDefaultEngineMutation.mutateAsync({ engineType, engineName })
        logger.info(`[EnginesView] ${engineType} engine set to ${engineName}`)
      }
    } catch (err) {
      logger.error(`[EnginesView] Failed to change ${engineType} engine:`, err)
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('engines.setDefaultEngineError'),
        t
      )
      await showError(t('engines.setDefaultEngineErrorTitle'), errorMessage)
    }
  }, [setDefaultEngineMutation, clearDefaultEngineMutation, t, showError])

  // Handle settings icon click
  const handleSettingsClick = useCallback((engine: EngineStatusInfo) => {
    setSelectedEngine(engine)
    setSettingsDialogOpen(true)
  }, [])

  // Handle settings dialog close
  const handleSettingsClose = useCallback(() => {
    setSettingsDialogOpen(false)
    setSelectedEngine(null)
  }, [])

  // Handle quality setting change
  const updateQualitySetting = useCallback(async (key: keyof NonNullable<typeof qualitySettings>, value: boolean | number) => {
    if (!settings?.quality) return

    try {
      const updatedQuality = { ...settings.quality, [key]: value }
      await updateSettingsMutation.mutateAsync({
        category: 'quality',
        value: updatedQuality
      })
      await refetchSettings()
    } catch (err) {
      logger.error('[EnginesView] Failed to update quality setting:', err)
    }
  }, [settings?.quality, updateSettingsMutation, refetchSettings])

  // Handle language selection change
  const updateAllowedLanguages = useCallback(async (languages: string[]) => {
    if (!settings?.languages) return

    try {
      const updatedLanguages = { ...settings.languages, allowedLanguages: languages }
      await updateSettingsMutation.mutateAsync({
        category: 'languages',
        value: updatedLanguages
      })
      // Note: No refetchSettings() needed - mutation updates the store directly
    } catch (err) {
      logger.error('[EnginesView] Failed to update allowed languages:', err)
    }
  }, [settings?.languages, updateSettingsMutation])

  // Handle global engine settings changes
  const updateEnginesSetting = useCallback(async (key: keyof NonNullable<typeof settings>['engines'], value: number | boolean) => {
    if (!settings?.engines) {
      logger.warn('[EnginesView] settings.engines is undefined, cannot update')
      return
    }

    try {
      const updatedEngines = { ...settings.engines, [key]: value }
      logger.info(`[EnginesView] Updating engine setting: ${key} = ${value}`, updatedEngines)
      await updateSettingsMutation.mutateAsync({
        category: 'engines',
        value: updatedEngines
      })
      await refetchSettings()
      logger.info(`[EnginesView] Engine setting ${key} updated successfully`)
    } catch (err) {
      logger.error('[EnginesView] Failed to update engine settings:', err)
    }
  }, [settings?.engines, updateSettingsMutation, refetchSettings])

  // Get all unique languages from TTS engines (unfiltered for Settings UI)
  const availableLanguages = React.useMemo(() => {
    if (!allEnginesData?.tts) return []
    return Array.from(
      new Set(allEnginesData.tts.flatMap(engine =>
        // Use allSupportedLanguages if available, fallback to supportedLanguages
        engine.allSupportedLanguages ?? engine.supportedLanguages ?? []
      ))
    ).sort()
  }, [allEnginesData?.tts])

  const allowedLanguages = settings?.languages?.allowedLanguages || ['de', 'en']

  // Handle enable/disable toggle
  const handleToggleEnabled = useCallback(async (engineName: string, enabled: boolean) => {
    // Find the engine to get its type
    const engine = allEnginesData?.tts?.find(e => e.name === engineName)
      || allEnginesData?.stt?.find(e => e.name === engineName)
      || allEnginesData?.text?.find(e => e.name === engineName)
      || allEnginesData?.audio?.find(e => e.name === engineName)

    if (!engine) {
      logger.error('[EnginesView] Engine not found for toggle:', engineName)
      return
    }

    try {
      await setEngineEnabledMutation.mutateAsync({
        engineType: engine.engineType,
        engineName,
        enabled,
      })
      logger.info(`[EnginesView] Engine ${engineName} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      logger.error('[EnginesView] Failed to toggle engine enabled:', err)
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('engines.toggleEnabledError'),
        t
      )
      await showError(t('engines.toggleEnabledErrorTitle'), errorMessage)
    }
  }, [allEnginesData, setEngineEnabledMutation, t, showError])

  // Content (shared between embedded and standalone)
  const content = (
    <>
      <ErrorDialog />
      {/* Generic EngineSettingsDialog for all engine types */}
      <EngineSettingsDialog
        open={settingsDialogOpen}
        onClose={handleSettingsClose}
        engine={selectedEngine}
      />
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error" sx={{ m: 2 }}>
          {t('engines.loadError')}: {error.message}
        </Alert>
      ) : (
        <>
          {/* Global Engine Settings Card */}
          {availableLanguages.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <GlobalEngineSettingsCard
                timeoutMinutes={timeoutMinutes}
                onTimeoutChange={(value) => {
                  setTimeoutMinutes(value)
                  updateEnginesSetting('inactivityTimeoutMinutes', value)
                }}
                autostart={autostart}
                onAutostartChange={(value) => {
                  setAutostart(value)
                  updateEnginesSetting('autostartKeepRunning', value)
                }}
                availableLanguages={availableLanguages}
                selectedLanguages={allowedLanguages}
                onSelectionChange={updateAllowedLanguages}
              />
            </Box>
          )}

          <Grid container spacing={3}>
          {/* TTS Engine - Multi-engine support (uses EngineDropdownCard) */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <EngineDropdownCard
              engineType="tts"
              title={t('engines.types.tts')}
              engines={allEnginesData?.tts || []}
              currentDefault={defaultTtsEngine}
              onDefaultChange={(name) => handleDefaultEngineChange('tts', name)}
              isChangingDefault={setDefaultEngineMutation.isPending}
              onSettingsClick={handleSettingsClick}
              onEngineSettingsClick={handleSettingsClick}
              onToggleEnabled={handleToggleEnabled}
              isTogglingEnabled={setEngineEnabledMutation.isPending}
            />
          </Grid>

          {/* Text Processing Engine - Single engine (uses SingleEngineSelector) */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <SingleEngineSelector
              engineType="text"
              title={t('engines.types.text')}
              engines={allEnginesData?.text || []}
              currentActive={defaultTextEngine}
              onActiveChange={(name) => handleSingleEngineChange('text', name)}
              isChanging={setDefaultEngineMutation.isPending || clearDefaultEngineMutation.isPending}
              onSettingsClick={handleSettingsClick}
            />
          </Grid>

          {/* STT Engine - Single engine (uses SingleEngineSelector) */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <SingleEngineSelector
              engineType="stt"
              title={t('engines.types.stt')}
              engines={allEnginesData?.stt || []}
              currentActive={defaultSttEngine}
              onActiveChange={(name) => handleSingleEngineChange('stt', name)}
              isChanging={setDefaultEngineMutation.isPending || clearDefaultEngineMutation.isPending}
              onSettingsClick={handleSettingsClick}
            />
          </Grid>

          {/* Audio Analysis Engine - Single engine (uses SingleEngineSelector) */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <SingleEngineSelector
              engineType="audio"
              title={t('engines.types.audio')}
              engines={allEnginesData?.audio || []}
              currentActive={defaultAudioEngine}
              onActiveChange={(name) => handleSingleEngineChange('audio', name)}
              isChanging={setDefaultEngineMutation.isPending || clearDefaultEngineMutation.isPending}
              onSettingsClick={handleSettingsClick}
            />
          </Grid>
        </Grid>
        </>
      )}

      {/* Quality Analysis Settings */}
      {qualitySettings && (
        <Paper
          sx={{
            mt: (theme) => theme.custom.spacing.lg,
            p: (theme) => theme.custom.spacing.md,
            borderRadius: (theme) => theme.custom.borderRadius.lg,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" gutterBottom>
            {t('settings.quality.title', 'Quality Analysis Settings')}
          </Typography>
          <Divider sx={{ mb: (theme) => theme.custom.spacing.sm }} />

          <Grid container spacing={3}>
            {/* Left Column: Auto-Analyze */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                {t('settings.quality.analyzeSection', 'Automatische Analyse')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: (theme) => theme.custom.spacing.xs }}>
                <SettingsToggle
                  label={t('settings.quality.autoAnalyzeSegment', 'Nach Segment-Generierung')}
                  checked={qualitySettings.autoAnalyzeSegment}
                  onChange={(checked) => updateQualitySetting('autoAnalyzeSegment', checked)}
                />
                <SettingsToggle
                  label={t('settings.quality.autoAnalyzeChapter', 'Nach Kapitel-Generierung')}
                  checked={qualitySettings.autoAnalyzeChapter}
                  onChange={(checked) => updateQualitySetting('autoAnalyzeChapter', checked)}
                />
              </Box>
            </Grid>

            {/* Right Column: Auto-Regenerate */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                {t('settings.quality.regenerateSection', 'Automatische Regenerierung')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: (theme) => theme.custom.spacing.xs }}>
                <SettingsOptionToggle
                  label={t('settings.quality.autoRegenerateDefects', 'Defekte neu generieren')}
                  value={qualitySettings.autoRegenerateDefects}
                  onChange={(value) => updateQualitySetting('autoRegenerateDefects', value)}
                  options={[
                    { value: 0, label: t('settings.quality.regenerateMode.disabled', 'Deaktiviert') },
                    { value: 1, label: t('settings.quality.regenerateMode.bundled', 'Gebündelt') },
                    { value: 2, label: t('settings.quality.regenerateMode.individual', 'Einzeln') },
                  ]}
                />
                <SettingsNumberToggle
                  label={t('settings.quality.maxRegenerateAttempts', 'Max. Versuche')}
                  value={qualitySettings.maxRegenerateAttempts}
                  onChange={(value) => updateQualitySetting('maxRegenerateAttempts', value)}
                  options={[1, 2, 3, 4, 5]}
                  disabled={qualitySettings.autoRegenerateDefects === 0}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}
    </>
  )

  // Embedded mode: render content directly (no ViewContainer, no padding - parent handles it)
  if (embedded) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {content}
      </Box>
    )
  }

  // Standalone mode: render with ViewContainer
  return (
    <ViewContainer>
      <ViewHeader title={t('engines.title')} />
      <ViewContent>{content}</ViewContent>
    </ViewContainer>
  )
}
