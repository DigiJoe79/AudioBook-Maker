/**
 * Edit Segment Settings Dialog
 *
 * Allows editing of TTS settings for a segment:
 * - Engine
 * - Model
 * - Language
 * - Speaker
 *
 * IMPORTANT: Correctly handles empty/invalid values by showing empty dropdown
 * instead of auto-selecting first valid value.
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import { Settings } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useError } from '@hooks/useError';
import { useQuery } from '@tanstack/react-query';
import { useAllEnginesStatus } from '@hooks/useEnginesQuery';
import { fetchSpeakers } from '@services/settingsApi';
import { queryKeys } from '@services/queryKeys';
import type { Segment } from '@types';
import { logger } from '@utils/logger';

interface EditSegmentSettingsDialogProps {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
  onSave: (segmentId: string, updates: {
    ttsEngine?: string;
    ttsModelName?: string;
    language?: string;
    ttsSpeakerName?: string | null;
  }) => Promise<void>;
}

export const EditSegmentSettingsDialog: React.FC<EditSegmentSettingsDialogProps> = ({
  open,
  segment,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const { showError, ErrorDialog } = useError();

  // Local state - IMPORTANT: Use empty string for invalid/missing values
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Load available engines and models (only enabled engines)
  const { data: enginesStatus, isLoading: enginesLoading } = useAllEnginesStatus();
  const availableEngines = (enginesStatus?.tts ?? []).filter(e => e.isEnabled);
  const selectedEngineInfo = availableEngines.find(e => e.variantId === selectedEngine);
  const availableModels = selectedEngineInfo?.availableModels ?? [];

  // Load available speakers
  const { data: allSpeakers = [], isLoading: speakersLoading } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
  });

  // Only show active speakers
  const availableSpeakers = allSpeakers.filter(s => s.isActive);

  // Get supported languages for selected engine (filtered by allowedLanguages in backend)
  const supportedLanguages = selectedEngineInfo?.supportedLanguages ?? [];

  // Initialize local state from segment when dialog opens
  useEffect(() => {
    if (segment && open) {
      // Check if engine is valid
      const engineExists = availableEngines.some(e => e.variantId === segment.ttsEngine);
      setSelectedEngine(engineExists ? segment.ttsEngine : '');

      // Check if model is valid (will be validated when models load)
      setSelectedModel(segment.ttsModelName || '');

      // Check if language is valid (will be validated when engine loads)
      setSelectedLanguage(segment.language || '');

      // Check if speaker exists and is active
      const speakerExists = availableSpeakers.some(s => s.name === segment.ttsSpeakerName);
      setSelectedSpeaker((segment.ttsSpeakerName && speakerExists) ? segment.ttsSpeakerName : '');
    }
  }, [segment, open, availableEngines.length, availableSpeakers.length]);

  // Validate model when models load or engine changes
  useEffect(() => {
    if (availableModels.length > 0 && selectedModel) {
      const modelExists = availableModels.includes(selectedModel);
      if (!modelExists) {
        setSelectedModel(''); // Clear invalid model
      }
    }
  }, [availableModels, selectedModel]);

  // Validate language when engine changes
  useEffect(() => {
    if (supportedLanguages.length > 0 && selectedLanguage) {
      const languageExists = supportedLanguages.includes(selectedLanguage);
      if (!languageExists) {
        setSelectedLanguage(''); // Clear invalid language
      }
    }
  }, [supportedLanguages, selectedLanguage]);

  // Auto-select model when engine changes: use per-engine default if available, otherwise first model
  useEffect(() => {
    if (selectedEngine && availableModels.length > 0) {
      const modelExists = availableModels.includes(selectedModel);

      // If current model is invalid or empty, select best available model
      if (!modelExists || !selectedModel) {
        // Try per-variant default model from engine status (Single Source of Truth)
        const perEngineDefault = selectedEngineInfo?.defaultModelName;
        const perEngineModelAvailable = perEngineDefault && availableModels.includes(perEngineDefault);

        if (perEngineModelAvailable) {
          setSelectedModel(perEngineDefault);

          logger.group(
            '🔄 Engine Model Auto-Select',
            'Using per-engine default model from engine status',
            {
              'Engine': selectedEngine,
              'Auto-Selected Model': perEngineDefault,
              'Previous Model': selectedModel || '(none)',
              'Source': 'selectedEngineInfo.defaultModelName'
            },
            '#4CAF50'
          );
        } else {
          // Fallback to first available model
          const firstModel = availableModels[0];
          setSelectedModel(firstModel);

          logger.group(
            '🔄 Engine Model Auto-Select',
            'Using first available model (no per-engine default)',
            {
              'Engine': selectedEngine,
              'Auto-Selected Model': firstModel,
              'Previous Model': selectedModel || '(none)',
              'Per-Engine Default': perEngineDefault || 'none'
            },
            '#FF9800'
          );
        }
      }
    }
  }, [selectedEngine, availableModels, selectedEngineInfo]);

  // Auto-select default language when engine changes
  useEffect(() => {
    if (selectedEngine && supportedLanguages.length > 0) {
      // ALWAYS set default language when engine changes (not just when invalid)
      // Get default language from engine status (Single Source of Truth)
      const defaultLanguage = selectedEngineInfo?.defaultLanguage;

      // Use default if valid, otherwise use first supported language
      if (defaultLanguage && supportedLanguages.includes(defaultLanguage)) {
        setSelectedLanguage(defaultLanguage);

        logger.group(
          '🌍 Engine Language Auto-Select',
          'Automatically selected default language from engine status',
          {
            'Engine': selectedEngine,
            'Auto-Selected Language': defaultLanguage,
            'Previous Language': selectedLanguage || '(none)',
            'Source': 'selectedEngineInfo.defaultLanguage'
          },
          '#4CAF50'
        );
      } else if (supportedLanguages.length > 0) {
        // Fallback to first supported language
        setSelectedLanguage(supportedLanguages[0]);

        logger.group(
          '🌍 Engine Language Auto-Select',
          'Using first supported language (no default found)',
          {
            'Engine': selectedEngine,
            'Auto-Selected Language': supportedLanguages[0],
            'Previous Language': selectedLanguage || '(none)',
            'Source': 'First in supportedLanguages'
          },
          '#FF9800'
        );
      }
    }
  }, [selectedEngine, supportedLanguages, selectedEngineInfo]);

  const handleSave = async () => {
    if (!segment) return;

    // Validation: All fields must be filled (including speaker)
    if (!selectedEngine || !selectedModel || !selectedLanguage || !selectedSpeaker) {
      await showError(
        t('segments.settings.title'),
        t('segments.settings.validation.allFieldsRequired')
      );
      return;
    }

    setSaving(true);
    try {
      logger.group(
        '📝 Segment Settings Save',
        'Updating segment TTS settings',
        {
          'Segment ID': segment.id,
          'Engine': selectedEngine,
          'Model': selectedModel,
          'Language': selectedLanguage,
          'Speaker': selectedSpeaker
        },
        '#2196F3'
      );

      await onSave(segment.id, {
        ttsEngine: selectedEngine,
        ttsModelName: selectedModel,
        language: selectedLanguage,
        ttsSpeakerName: selectedSpeaker,
      });
      onClose();
    } catch (err) {
      logger.error('[EditSegmentSettingsDialog] Failed to update segment settings:', err);
      await showError(
        t('segments.settings.title'),
        t('segments.settings.messages.error')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    // State will be reset when dialog opens again (see useEffect Line 93-109)
    onClose();
  };

  const isLoading = enginesLoading || speakersLoading;
  const canSave = selectedEngine && selectedModel && selectedLanguage && selectedSpeaker;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="segment-settings-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Settings />
          <Typography variant="h6">{t('segments.settings.title')}</Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        {isLoading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={3}>
            {/* Info Alert */}
            <Alert severity="info">
              {t('segments.settings.description')}
            </Alert>

            {/* Engine & Model Row */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {/* Engine Selection */}
              <FormControl fullWidth>
                <InputLabel>{t('segments.settings.engine')}</InputLabel>
                <Select
                  value={selectedEngine}
                  onChange={(e) => setSelectedEngine(e.target.value)}
                  label={t('segments.settings.engine')}
                  displayEmpty={false}
                >
                  {availableEngines.map((engine) => (
                    <MenuItem key={engine.variantId} value={engine.variantId}>
                      {engine.displayName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Model Selection */}
              <FormControl fullWidth disabled={!selectedEngine}>
                <InputLabel>{t('segments.settings.model')}</InputLabel>
                <Select
                  value={availableModels.includes(selectedModel) ? selectedModel : ''}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  label={t('segments.settings.model')}
                  displayEmpty={false}
                >
                  {availableModels.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Speaker & Language Row */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {/* Speaker Selection */}
              <FormControl fullWidth>
                <InputLabel>{t('segments.settings.speaker')}</InputLabel>
                <Select
                  value={availableSpeakers.some(s => s.name === selectedSpeaker) ? selectedSpeaker : ''}
                  onChange={(e) => setSelectedSpeaker(e.target.value)}
                  label={t('segments.settings.speaker')}
                  data-testid="segment-settings-speaker-select"
                >
                  {availableSpeakers.map((speaker) => (
                    <MenuItem key={speaker.id} value={speaker.name}>
                      {speaker.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Language Selection */}
              <FormControl fullWidth disabled={!selectedEngine}>
                <InputLabel>{t('segments.settings.language')}</InputLabel>
                <Select
                  value={supportedLanguages.includes(selectedLanguage) ? selectedLanguage : ''}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  label={t('segments.settings.language')}
                  displayEmpty={false}
                >
                  {supportedLanguages.map((lang) => (
                    <MenuItem key={lang} value={lang}>
                      {t(`languages.${lang}`, lang.toUpperCase())}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Validation Warning */}
            {!canSave && (
              <Alert severity="warning">
                {t('segments.settings.validation.allFieldsRequired')}
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave || saving}
        >
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  );
};
