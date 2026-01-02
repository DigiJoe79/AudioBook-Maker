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
import { useEngineSchema } from '@hooks/useSettings'
import { useAppStore } from '@store/appStore'
import { queryKeys } from '@services/queryKeys'
import type { EngineStatusInfo } from '@/types/engines'
import SpeechRatioSlider, { hasSpeechRatioParams, extractSpeechRatioValues } from './SpeechRatioSlider'
import { logger } from '@/utils/logger'
import { engineApi } from '@services/api'
import { useError } from '@hooks/useError'

interface EngineSettingsDialogProps {
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
  const { showError, ErrorDialog } = useError()
  const settings = useAppStore((state) => state.settings)

  // Local state for settings
  const [localSettings, setLocalSettings] = useState<{
    defaultModelName: string
    defaultLanguage: string
    parameters: Record<string, any>
  } | null>(null)
  const [keepRunning, setKeepRunning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
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
    engine?.variantId || '',
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
  // Settings now come from engine prop (Single Source of Truth: engines table)
  useEffect(() => {
    if (open && engine && !isInitializedRef.current) {
      isInitializedRef.current = true

      // Initialize keepRunning from engine
      setKeepRunning(engine.keepRunning ?? false)

      // Get settings from engine prop (populated from engines table via /api/engines/status)
      const savedModel = engine.defaultModelName || ''
      const isValidModel = availableModels.some(m => m.name === savedModel)
      const defaultModelName = isValidModel ? savedModel : (availableModels[0]?.name || '')

      // Default language from engine, fallback to first available or 'en'
      const defaultLanguage = engine.defaultLanguage || availableLanguages[0] || 'en'

      // Load saved parameters from engine (populated from engines table via /api/engines/status)
      const parameters: Record<string, any> = engine.parameters || {}

      setLocalSettings({
        defaultModelName,
        defaultLanguage,
        parameters,
      })
    }
  }, [open, engine, availableLanguages, availableModels])

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

  // Save all settings via engines API (Single Source of Truth)
  const handleSave = useCallback(async () => {
    if (!engine || !localSettings) return

    const engineType = engine.engineType
    const variantId = engine.variantId

    setIsSaving(true)
    try {
      // 1. Save keepRunning via dedicated API endpoint
      await engineApi.setKeepRunning(engineType, variantId, keepRunning)
      logger.info(`[EngineSettingsDialog] Set keepRunning=${keepRunning} for ${variantId}`)

      // 2. Save engine settings (model, language, parameters) via new API
      // This writes directly to the engines table (Single Source of Truth)
      await engineApi.updateSettings(engineType, variantId, {
        defaultModelName: localSettings.defaultModelName,
        defaultLanguage: localSettings.defaultLanguage,
        parameters: localSettings.parameters,
      })
      logger.info(`[EngineSettingsDialog] Updated settings for ${variantId}`)

      // 3. Invalidate engines query to refetch updated data
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })

      onClose()
    } catch (error) {
      logger.error('[EngineSettingsDialog] Failed to save engine settings', { error })
      showError(t('common.error', 'Error'), t('engines.settingsSaveError', 'Failed to save engine settings'))
    } finally {
      setIsSaving(false)
    }
  }, [engine, localSettings, keepRunning, queryClient, onClose, t, showError])

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
      <ErrorDialog />
    </Dialog>
  )
})

EngineSettingsDialog.displayName = 'EngineSettingsDialog'

export default EngineSettingsDialog
