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
  Chip,
  FormHelperText,
} from '@mui/material';
import { Settings } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery';
import { fetchSpeakers } from '../../services/settingsApi';
import type { Segment } from '../../types';
import { logger } from '../../utils/logger';
import { useAppStore } from '../../store/appStore';

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

  // Get settings for default language
  const settings = useAppStore(state => state.settings);

  // Local state - IMPORTANT: Use empty string for invalid/missing values
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Load available engines
  const { data: availableEngines = [], isLoading: enginesLoading } = useTTSEngines();

  // Load available models for selected engine
  const { data: availableModels = [], isLoading: modelsLoading } = useTTSModels(
    selectedEngine || null
  );

  // Load available speakers
  const { data: allSpeakers = [], isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  });

  // Only show active speakers
  const availableSpeakers = allSpeakers.filter(s => s.isActive);

  // Get supported languages for selected engine
  const supportedLanguages = availableEngines.find(e => e.name === selectedEngine)?.supportedLanguages || [];

  // Initialize local state from segment when dialog opens
  useEffect(() => {
    if (segment && open) {
      // Check if engine is valid
      const engineExists = availableEngines.some(e => e.name === segment.ttsEngine);
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
      const modelExists = availableModels.some(m => m.modelName === selectedModel);
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

  // Auto-select first model when engine changes
  useEffect(() => {
    if (selectedEngine && availableModels.length > 0) {
      const modelExists = availableModels.some(m => m.modelName === selectedModel);

      // If current model is invalid or empty, select first available model
      if (!modelExists || !selectedModel) {
        const firstModel = availableModels[0].modelName;
        setSelectedModel(firstModel);

        logger.group(
          '🔄 Engine Model Auto-Select',
          'Automatically selected first model after engine change',
          {
            'Engine': selectedEngine,
            'Auto-Selected Model': firstModel,
            'Previous Model': selectedModel || '(none)'
          },
          '#FF9800'
        );
      }
    }
  }, [selectedEngine, availableModels]);

  // Auto-select default language when engine changes
  useEffect(() => {
    if (selectedEngine && supportedLanguages.length > 0) {
      // ALWAYS set default language when engine changes (not just when invalid)
      // Get default language from engine settings
      const engineConfig = settings?.tts.engines[selectedEngine];
      const defaultLanguage = engineConfig?.defaultLanguage;

      // Use default if valid, otherwise use first supported language
      if (defaultLanguage && supportedLanguages.includes(defaultLanguage)) {
        setSelectedLanguage(defaultLanguage);

        logger.group(
          '🌍 Engine Language Auto-Select',
          'Automatically selected default language from settings',
          {
            'Engine': selectedEngine,
            'Auto-Selected Language': defaultLanguage,
            'Previous Language': selectedLanguage || '(none)',
            'Source': 'settings.tts.engines.defaultLanguage'
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
  }, [selectedEngine, supportedLanguages, settings]);

  const handleSave = async () => {
    if (!segment) return;

    // Validation: All fields must be filled (including speaker)
    if (!selectedEngine || !selectedModel || !selectedLanguage || !selectedSpeaker) {
      alert(t('segments.settings.validation.allFieldsRequired'));
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
      alert(t('segments.settings.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    // Reset to original values
    if (segment) {
      const engineExists = availableEngines.some(e => e.name === segment.ttsEngine);
      setSelectedEngine(engineExists ? segment.ttsEngine : '');
      setSelectedModel(segment.ttsModelName || '');
      setSelectedLanguage(segment.language || '');
      const speakerExists = availableSpeakers.some(s => s.name === segment.ttsSpeakerName);
      setSelectedSpeaker((segment.ttsSpeakerName && speakerExists) ? segment.ttsSpeakerName : '');
    }
    onClose();
  };

  const isLoading = enginesLoading || modelsLoading || speakersLoading;
  const canSave = selectedEngine && selectedModel && selectedLanguage && selectedSpeaker;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Settings />
          {t('segments.settings.title')}
        </Box>
      </DialogTitle>

      <DialogContent>
        {isLoading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Info Alert */}
            <Alert severity="info" sx={{ mb: 1 }}>
              {t('segments.settings.description')}
            </Alert>

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
                  <MenuItem key={engine.name} value={engine.name}>
                    {engine.displayName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Model Selection */}
            <FormControl fullWidth disabled={!selectedEngine || modelsLoading}>
              <InputLabel>{t('segments.settings.model')}</InputLabel>
              <Select
                value={availableModels.some(m => m.modelName === selectedModel) ? selectedModel : ''}
                onChange={(e) => setSelectedModel(e.target.value)}
                label={t('segments.settings.model')}
                displayEmpty={false}
              >
                {availableModels.map((model) => (
                  <MenuItem key={model.modelName} value={model.modelName}>
                    {model.displayName || model.modelName}
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
                    {lang}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Speaker Selection */}
            <FormControl fullWidth>
              <InputLabel>{t('segments.settings.speaker')}</InputLabel>
              <Select
                value={availableSpeakers.some(s => s.name === selectedSpeaker) ? selectedSpeaker : ''}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                label={t('segments.settings.speaker')}
              >
                {availableSpeakers.map((speaker) => (
                  <MenuItem key={speaker.id} value={speaker.name}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                      <Typography>{speaker.name}</Typography>
                      {speaker.samples.length > 0 && (
                        <Chip
                          label={`${speaker.samples.length} ${speaker.samples.length === 1 ? 'sample' : 'samples'}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                      {speaker.gender && (
                        <Chip
                          label={speaker.gender}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {availableSpeakers.length} speaker(s) available
              </FormHelperText>
            </FormControl>

            {/* Validation Warning */}
            {!canSave && (
              <Alert severity="warning">
                {t('segments.settings.validation.allFieldsRequired')}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
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
    </Dialog>
  );
};
