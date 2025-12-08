/**
 * EngineSettingsDialog - Modal dialog for engine-specific settings
 *
 * Shows settings for a specific engine:
 * - Default Model (for TTS/STT with multiple models)
 * - Default Language
 * - Engine-specific parameters (temperature, speed, etc.)
 */

import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Divider,
  CircularProgress,
  Stack,
} from '@mui/material'
import { SettingsToggle } from '@components/settings/SettingsComponents'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useEngineSchema, useSettings, useUpdateSettings } from '@hooks/useSettings'
import { useAppStore } from '@store/appStore'
import { queryKeys } from '@services/queryKeys'
import type { EngineStatusInfo } from '@/types/engines'
import SpeechRatioSlider, { hasSpeechRatioParams, extractSpeechRatioValues } from './SpeechRatioSlider'
import { logger } from '@/utils/logger'
import { engineApi } from '@services/api'

export interface EngineSettingsDialogProps {
  open: boolean
  onClose: () => void
  engine: EngineStatusInfo | null
}

// Whisper model display names (hard-coded since STT doesn't have a models API)
const WHISPER_MODEL_DISPLAY_NAMES: Record<string, string> = {
  'tiny': 'Tiny (39 MB) - Fastest',
  'base': 'Base (74 MB) - Fast',
  'small': 'Small (244 MB) - Balanced',
  'medium': 'Medium (769 MB) - Accurate',
  'large': 'Large (1550 MB) - Most Accurate',
}

const EngineSettingsDialog = memo(({ open, onClose, engine }: EngineSettingsDialogProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppStore((state) => state.settings)
  const { refetch: refetchSettings } = useSettings()
  const updateSettingsMutation = useUpdateSettings()

  // Local state for settings
  const [localSettings, setLocalSettings] = useState<{
    defaultModelName: string
    defaultLanguage: string
    parameters: Record<string, any>
  } | null>(null)
  const [keepRunning, setKeepRunning] = useState(false)
  const isInitializedRef = useRef(false)

  // Reset local settings when dialog closes
  useEffect(() => {
    if (!open) {
      setLocalSettings(null)
      setKeepRunning(false)
      isInitializedRef.current = false
    }
  }, [open])

  // Fetch engine schema for parameters (use engineType for generic endpoint)
  const { data: engineSchema, isLoading: schemaLoading } = useEngineSchema(
    engine?.name || '',
    engine?.engineType || 'tts'
  )

  // Get allowed languages from settings
  const allowedLanguages = useMemo(() => {
    return settings?.languages?.allowedLanguages || ['de', 'en']
  }, [settings])

  // Calculate available languages for this engine
  const availableLanguages = useMemo(() => {
    if (!engine) return []
    const engineLanguages = engine.supportedLanguages || []
    return engineLanguages.filter(lang => allowedLanguages.includes(lang)).sort()
  }, [engine, allowedLanguages])

  // Get available models from engine status (already populated by /api/engines/status)
  const availableModels = useMemo(() => {
    if (!engine) return []
    // Use availableModels from engine status for both TTS and STT
    return (engine.availableModels || []).map(m => ({
      name: m,
      displayName: engine.engineType === 'stt' ? (WHISPER_MODEL_DISPLAY_NAMES[m] || m) : m
    }))
  }, [engine])

  // Initialize local settings when dialog opens (only once per open cycle)
  useEffect(() => {
    if (open && engine && settings && !isInitializedRef.current) {
      isInitializedRef.current = true
      const engineType = engine.engineType

      // Initialize keepRunning from engine
      setKeepRunning(engine.keepRunning ?? false)

      // Get engine config based on type
      let defaultLanguage = availableLanguages[0] || 'en'
      let parameters: Record<string, any> = {}
      let defaultModelName = ''

      if (engineType === 'tts') {
        const ttsConfig = settings.tts?.engines?.[engine.name]
        defaultLanguage = ttsConfig?.defaultLanguage || defaultLanguage
        parameters = ttsConfig?.parameters || {}
        // Use saved model or engine default, but validate against available models
        const savedModel = ttsConfig?.defaultModelName || engine.defaultModelName || ''
        const isValidModel = availableModels.some(m => m.name === savedModel)
        defaultModelName = isValidModel ? savedModel : (availableModels[0]?.name || '')
      } else if (engineType === 'stt') {
        // For STT, get defaultModelName and parameters from settings
        const sttConfig = settings.stt?.engines?.[engine.name]
        const savedModel = sttConfig?.defaultModelName || engine.defaultModelName || ''
        const isValidModel = availableModels.some(m => m.name === savedModel)
        defaultModelName = isValidModel ? savedModel : (availableModels[0]?.name || '')
        parameters = sttConfig?.parameters || {}
      } else if (engineType === 'audio') {
        // For Audio engines, get parameters (including speechRatio thresholds)
        const audioConfig = settings.audio?.engines?.[engine.name]
        parameters = audioConfig?.parameters || {}
        const savedModel = audioConfig?.defaultModelName || engine.defaultModelName || ''
        const isValidModel = availableModels.some(m => m.name === savedModel)
        defaultModelName = isValidModel ? savedModel : (availableModels[0]?.name || '')
      } else if (engineType === 'text') {
        // For Text engines
        const textConfig = settings.text?.engines?.[engine.name]
        parameters = textConfig?.parameters || {}
      }

      setLocalSettings({
        defaultModelName,
        defaultLanguage,
        parameters,
      })
    }
  }, [open, engine, settings, availableLanguages, availableModels])

  // Auto-select first model if current model is invalid
  useEffect(() => {
    if (localSettings && availableModels.length > 0) {
      const isValidModel = availableModels.some(m => m.name === localSettings.defaultModelName)
      if (!isValidModel) {
        setLocalSettings(prev => prev ? { ...prev, defaultModelName: availableModels[0].name } : prev)
      }
    }
  }, [availableModels, localSettings?.defaultModelName])

  // Update a local setting
  const updateLocalSetting = useCallback((key: string, value: string | number | boolean | number[]) => {
    setLocalSettings(prev => {
      if (!prev) return prev
      if (key === 'defaultModelName' || key === 'defaultLanguage') {
        return { ...prev, [key]: value }
      }
      return {
        ...prev,
        parameters: { ...prev.parameters, [key]: value }
      }
    })
  }, [])

  // Save all settings via unified settings API
  const handleSave = useCallback(async () => {
    if (!engine || !localSettings || !settings) return

    const engineType = engine.engineType

    try {
      // First, save keepRunning via dedicated API endpoint
      try {
        await engineApi.setKeepRunning(engineType, engine.name, keepRunning)
        logger.info(`[EngineSettingsDialog] Set keepRunning=${keepRunning} for ${engine.name}`)
      } catch (err) {
        logger.error('[EngineSettingsDialog] Failed to set keepRunning:', err)
        throw err
      }
      if (engineType === 'tts') {
        // Deep clone TTS settings and update engine config
        const updatedTtsSettings = JSON.parse(JSON.stringify(settings.tts))
        if (!updatedTtsSettings.engines) updatedTtsSettings.engines = {}
        if (!updatedTtsSettings.engines[engine.name]) updatedTtsSettings.engines[engine.name] = {}

        const engineConfig = updatedTtsSettings.engines[engine.name]
        engineConfig.defaultModelName = localSettings.defaultModelName
        engineConfig.defaultLanguage = localSettings.defaultLanguage
        engineConfig.parameters = localSettings.parameters
        engineConfig.keepRunning = keepRunning

        await updateSettingsMutation.mutateAsync({
          category: 'tts',
          value: updatedTtsSettings
        })
      } else if (engineType === 'stt') {
        // Deep clone STT settings and update engine config
        const updatedSttSettings = JSON.parse(JSON.stringify(settings.stt))
        if (!updatedSttSettings.engines) updatedSttSettings.engines = {}
        if (!updatedSttSettings.engines[engine.name]) updatedSttSettings.engines[engine.name] = {}

        const engineConfig = updatedSttSettings.engines[engine.name]
        engineConfig.defaultModelName = localSettings.defaultModelName
        engineConfig.parameters = localSettings.parameters
        engineConfig.keepRunning = keepRunning

        await updateSettingsMutation.mutateAsync({
          category: 'stt',
          value: updatedSttSettings
        })
      } else if (engineType === 'audio') {
        // Deep clone Audio settings and update engine config
        const updatedAudioSettings = JSON.parse(JSON.stringify(settings.audio))
        if (!updatedAudioSettings.engines) updatedAudioSettings.engines = {}
        if (!updatedAudioSettings.engines[engine.name]) updatedAudioSettings.engines[engine.name] = {}

        const engineConfig = updatedAudioSettings.engines[engine.name]
        engineConfig.defaultModelName = localSettings.defaultModelName
        engineConfig.parameters = localSettings.parameters
        engineConfig.keepRunning = keepRunning

        await updateSettingsMutation.mutateAsync({
          category: 'audio',
          value: updatedAudioSettings
        })
      } else if (engineType === 'text') {
        // Deep clone Text settings and update engine config
        const updatedTextSettings = JSON.parse(JSON.stringify(settings.text))
        if (!updatedTextSettings.engines) updatedTextSettings.engines = {}
        if (!updatedTextSettings.engines[engine.name]) updatedTextSettings.engines[engine.name] = {}

        const engineConfig = updatedTextSettings.engines[engine.name]
        engineConfig.parameters = localSettings.parameters
        engineConfig.keepRunning = keepRunning

        await updateSettingsMutation.mutateAsync({
          category: 'text',
          value: updatedTextSettings
        })
      }

      // Refetch settings to update store
      await refetchSettings()
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })

      onClose()
    } catch (error) {
      logger.error('[EngineSettingsDialog] Failed to save engine settings', { error })
    }
  }, [engine, localSettings, settings, keepRunning, updateSettingsMutation, refetchSettings, queryClient, onClose])

  const isSaving = updateSettingsMutation.isPending

  if (!engine) return null

  const showModelSelector = (engine.engineType === 'tts' || engine.engineType === 'stt')
    && availableModels.length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { maxHeight: '80vh' }
      }}
    >
      <DialogTitle>
        {t('engines.settingsDialogTitle', { engine: engine.displayName })}
      </DialogTitle>

      <DialogContent dividers>
        {!localSettings ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={3} sx={{ pt: 1 }}>
            {/* Keep Running Toggle */}
            <SettingsToggle
              label={t('engines.keepRunning')}
              description={t('engines.keepRunningDescription')}
              checked={keepRunning}
              onChange={setKeepRunning}
              sx={{ p: 0 }}
            />

            {/* Default Model */}
            {showModelSelector && (
              <FormControl fullWidth size="small">
                <InputLabel>{t('engines.defaultModel')}</InputLabel>
                <Select
                  value={localSettings.defaultModelName}
                  onChange={(e) => updateLocalSetting('defaultModelName', e.target.value)}
                  label={t('engines.defaultModel')}
                >
                  {availableModels.map((model) => (
                    <MenuItem key={model.name} value={model.name}>
                      {model.displayName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* Default Language (only for TTS) */}
            {engine.engineType === 'tts' && availableLanguages.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>{t('settings.tts.defaultLanguage')}</InputLabel>
                <Select
                  value={localSettings.defaultLanguage}
                  onChange={(e) => updateLocalSetting('defaultLanguage', e.target.value)}
                  label={t('settings.tts.defaultLanguage')}
                >
                  {availableLanguages.map((lang) => (
                    <MenuItem key={lang} value={lang}>
                      {t(`languages.${lang}`, lang.toUpperCase())}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* Engine Parameters */}
            {schemaLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : engineSchema && Object.keys(engineSchema).length > 0 ? (
              <>
                {/* Special SpeechRatio Widget for Audio Engines (has its own title) */}
                {hasSpeechRatioParams(engineSchema) && (
                  <SpeechRatioSlider
                    values={extractSpeechRatioValues(localSettings.parameters, engineSchema)}
                    onChange={(key, value) => updateLocalSetting(key, value)}
                  />
                )}

                {/* Show divider only if there's a SpeechRatio widget AND other parameters */}
                {hasSpeechRatioParams(engineSchema) && Object.keys(engineSchema).some(key =>
                  !(engineSchema[key] as any).readonly &&
                  !key.startsWith('speech_ratio_')
                ) && <Divider />}

                {Object.entries(engineSchema)
                  // Filter out speechRatio params if widget is shown, and readonly params
                  .filter(([key, schema]) => {
                    if ((schema as any).readonly) return false
                    // Skip speechRatio params - they are handled by the widget
                    if (hasSpeechRatioParams(engineSchema) && key.startsWith('speech_ratio_')) return false
                    return true
                  })
                  .map(([key, schema]) => {
                    const schemaTyped = schema as any
                    const currentValue = localSettings.parameters[key] ?? schemaTyped.default

                    if (schemaTyped.type === 'boolean') {
                      return (
                        <SettingsToggle
                          key={key}
                          label={t(schemaTyped.label)}
                          description={t(schemaTyped.description)}
                          checked={currentValue}
                          onChange={(checked) => updateLocalSetting(key, checked)}
                          sx={{ p: 0 }}
                        />
                      )
                    }

                    if (schemaTyped.type === 'float' || schemaTyped.type === 'int') {
                      const range = schemaTyped.max - schemaTyped.min
                      const useTextField = range > 1000

                      if (useTextField) {
                        return (
                          <TextField
                            key={key}
                            fullWidth
                            size="small"
                            type="number"
                            label={t(schemaTyped.label)}
                            value={currentValue}
                            onChange={(e) => {
                              const value = schemaTyped.type === 'int'
                                ? parseInt(e.target.value)
                                : parseFloat(e.target.value)
                              if (!isNaN(value)) {
                                updateLocalSetting(key, value)
                              }
                            }}
                            inputProps={{
                              min: schemaTyped.min,
                              max: schemaTyped.max,
                              step: schemaTyped.step
                            }}
                            helperText={t(schemaTyped.description)}
                          />
                        )
                      }

                      const showMarks = range <= 100

                      return (
                        <Box key={key}>
                          <Typography variant="body2" gutterBottom>
                            {t(schemaTyped.label)}: {currentValue}
                          </Typography>
                          <Slider
                            value={currentValue}
                            onChange={(_, value) => updateLocalSetting(key, value)}
                            min={schemaTyped.min}
                            max={schemaTyped.max}
                            step={schemaTyped.step}
                            marks={showMarks}
                            valueLabelDisplay="auto"
                            size="small"
                          />
                          <Typography variant="caption" color="text.secondary">
                            {t(schemaTyped.description)}
                          </Typography>
                        </Box>
                      )
                    }

                    if (schemaTyped.type === 'select' && schemaTyped.options) {
                      return (
                        <FormControl key={key} fullWidth size="small">
                          <InputLabel>{t(schemaTyped.label)}</InputLabel>
                          <Select
                            value={currentValue}
                            onChange={(e) => updateLocalSetting(key, e.target.value)}
                            label={t(schemaTyped.label)}
                          >
                            {schemaTyped.options.map((option: string) => (
                              <MenuItem key={option} value={option}>
                                {option}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )
                    }

                    return null
                  })}
              </>
            ) : null}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={isSaving || !localSettings}
        >
          {isSaving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
})

EngineSettingsDialog.displayName = 'EngineSettingsDialog'

export default EngineSettingsDialog
