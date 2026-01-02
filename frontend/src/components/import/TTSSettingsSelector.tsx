/**
 * TTSSettingsSelector - TTS Configuration Component for Import
 *
 * Provides dropdowns for selecting TTS settings (engine, model, language, speaker)
 * that will be used when importing markdown projects.
 *
 * Features:
 * - Auto-select first model when engine changes
 * - Auto-select default language from engine settings
 * - Filter active speakers only
 * - Handle loading states
 * - Validate engine/model existence
 */

import React, { useEffect } from 'react'
import {
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Box,
  Alert,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchSpeakers } from '@services/settingsApi'
import { queryKeys } from '@services/queryKeys'
import { useAllEnginesStatus } from '@hooks/useEnginesQuery'
import { logger } from '@utils/logger'

interface TTSSettingsSelectorProps {
  engine: string
  onEngineChange: (engine: string) => void
  modelName: string
  onModelChange: (modelName: string) => void
  language: string
  onLanguageChange: (language: string) => void
  speakerName: string
  onSpeakerChange: (speakerName: string) => void
}

const TTSSettingsSelector: React.FC<TTSSettingsSelectorProps> = ({
  engine,
  onEngineChange,
  modelName,
  onModelChange,
  language,
  onLanguageChange,
  speakerName,
  onSpeakerChange,
}) => {
  const { t } = useTranslation()

  // Fetch engines dynamically (only enabled engines)
  const { data: enginesStatus, isLoading: enginesLoading } = useAllEnginesStatus()
  const engines = (enginesStatus?.tts ?? []).filter(e => e.isEnabled)

  // Get engine info and models for selected engine
  const engineInfo = engines.find((e) => e.variantId === engine)
  const models = engineInfo?.availableModels ?? []

  // Fetch speakers
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  })

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter((speaker) => speaker.isActive) || []

  // Calculate available languages: supportedLanguages + defaultLanguage from engine (if not already included)
  const availableLanguages = React.useMemo(() => {
    if (!engineInfo) return []

    const supported = engineInfo.supportedLanguages || []
    // Get default language directly from engine status (Single Source of Truth)
    const dbDefaultLanguage = engineInfo.defaultLanguage

    // Add DB default language if it's not already in supported languages
    if (dbDefaultLanguage && !supported.includes(dbDefaultLanguage)) {
      return [dbDefaultLanguage, ...supported]
    }

    return supported
  }, [engineInfo])

  // Auto-select model when engine changes: use per-engine default if available, otherwise first model
  useEffect(() => {
    if (engine && models.length > 0) {
      const modelExists = models.includes(modelName)

      // If current model is invalid or empty, select best available model
      if (!modelExists || !modelName) {
        // Try per-variant default model from engine status (Single Source of Truth)
        const perEngineDefaultModel = engineInfo?.defaultModelName
        const perEngineModelAvailable = perEngineDefaultModel && models.includes(perEngineDefaultModel)

        if (perEngineModelAvailable) {
          onModelChange(perEngineDefaultModel)

          logger.group(
            '🔧 Import TTS - Model Auto-Select',
            'Using per-engine default model from engine status',
            {
              'Engine': engine,
              'Selected Model': perEngineDefaultModel,
              'Source': 'engineInfo.defaultModelName',
              'Available Models': models
            },
            '#4CAF50'
          )
        } else {
          const firstModel = models[0]
          onModelChange(firstModel)

          logger.group(
            '🔧 Import TTS - Model Auto-Select',
            'Using first available model',
            {
              'Engine': engine,
              'Selected Model': firstModel,
              'Source': 'First in models list',
              'Available Models': models,
              'Per-Engine Default': perEngineDefaultModel || 'none'
            },
            '#FF9800'
          )
        }
      }
    }
  }, [engine, models, modelName, onModelChange, engineInfo])

  // Auto-select language when engine changes: use default if available, otherwise use first language
  useEffect(() => {
    if (engineInfo && availableLanguages.length > 0) {
      // Get default language from engine status (Single Source of Truth)
      const dbDefaultLanguage = engineInfo.defaultLanguage

      // Use default if available, otherwise use first available language
      if (dbDefaultLanguage && availableLanguages.includes(dbDefaultLanguage)) {
        onLanguageChange(dbDefaultLanguage)

        logger.group(
          '🌍 Import TTS - Language Auto-Select',
          'Using engine default language from engine status',
          {
            'Engine': engine,
            'Selected Language': dbDefaultLanguage,
            'Source': 'engineInfo.defaultLanguage',
            'Available Languages': availableLanguages
          },
          '#4CAF50'
        )
      } else if (availableLanguages.length > 0) {
        // Fallback to first available language
        onLanguageChange(availableLanguages[0])

        logger.group(
          '🌍 Import TTS - Language Auto-Select',
          'Using first available language',
          {
            'Engine': engine,
            'Selected Language': availableLanguages[0],
            'Source': 'First in availableLanguages',
            'Available Languages': availableLanguages
          },
          '#FF9800'
        )
      }
    }
  }, [engine, engineInfo, onLanguageChange, availableLanguages])

  return (
    <Stack spacing={2} data-testid="tts-settings-selector">
      {/* Engine Selection */}
      <FormControl fullWidth disabled={enginesLoading}>
        <InputLabel>{t('tts.engine')}</InputLabel>
        <Select
          value={engines.some((e) => e.variantId === engine) ? engine : ''}
          onChange={(e) => onEngineChange(e.target.value)}
          label={t('tts.engine')}
          data-testid="tts-engine-select"
        >
          {engines.map((eng) => (
            <MenuItem key={eng.variantId} value={eng.variantId}>
              {eng.displayName}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Model Selection */}
      <FormControl fullWidth>
        <InputLabel>{t('tts.model')}</InputLabel>
        <Select
          value={models.includes(modelName) ? modelName : ''}
          onChange={(e) => onModelChange(e.target.value)}
          label={t('tts.model')}
          data-testid="tts-model-select"
        >
          {models.map((model) => (
            <MenuItem key={model} value={model}>
              {model}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Loading State for Speakers */}
      {speakersLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* No speakers warning */}
      {!speakersLoading && availableSpeakers.length === 0 && (
        <Alert severity="warning">
          <Typography variant="body2">
            <strong>{t('import.tts.noSpeakers')}</strong>
          </Typography>
          <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
            {t('audioGeneration.noSpeakers.description')}
          </Typography>
        </Alert>
      )}

      {/* Speaker Selection */}
      {!speakersLoading && availableSpeakers.length > 0 && (
        <FormControl fullWidth>
          <InputLabel>{t('import.tts.speaker')}</InputLabel>
          <Select
            value={speakerName}
            label={t('import.tts.speaker')}
            onChange={(e) => onSpeakerChange(e.target.value)}
            data-testid="tts-speaker-select"
          >
            {availableSpeakers.map((speaker) => (
              <MenuItem key={speaker.id} value={speaker.name}>
                {speaker.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* Language Selection */}
      <FormControl fullWidth disabled={!engineInfo}>
        <InputLabel>{t('tts.language')}</InputLabel>
        <Select
          value={availableLanguages.includes(language) ? language : ''}
          onChange={(e) => onLanguageChange(e.target.value)}
          label={t('tts.language')}
          data-testid="tts-language-select"
        >
          {availableLanguages.map((lang) => (
            <MenuItem key={lang} value={lang}>
              {t(`languages.${lang}`, lang.toUpperCase())}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  )
}

export default TTSSettingsSelector
