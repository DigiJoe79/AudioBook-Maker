
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
} from '@mui/material';
import { Settings } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery';
import { fetchSpeakers } from '../../services/settingsApi';
import type { Segment } from '../../types';

interface EditSegmentSettingsDialogProps {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
  onSave: (segmentId: string, updates: {
    engine?: string;
    modelName?: string;
    language?: string;
    speakerName?: string | null;
  }) => Promise<void>;
}

export const EditSegmentSettingsDialog: React.FC<EditSegmentSettingsDialogProps> = ({
  open,
  segment,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();

  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const { data: availableEngines = [], isLoading: enginesLoading } = useTTSEngines();

  const { data: availableModels = [], isLoading: modelsLoading } = useTTSModels(
    selectedEngine || null
  );

  const { data: allSpeakers = [], isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  });

  const availableSpeakers = allSpeakers.filter(s => s.isActive);

  const supportedLanguages = availableEngines.find(e => e.name === selectedEngine)?.supportedLanguages || [];

  useEffect(() => {
    if (segment && open) {
      const engineExists = availableEngines.some(e => e.name === segment.engine);
      setSelectedEngine(engineExists ? segment.engine : '');

      setSelectedModel(segment.modelName || '');

      setSelectedLanguage(segment.language || '');

      const speakerExists = availableSpeakers.some(s => s.name === segment.speakerName);
      setSelectedSpeaker((segment.speakerName && speakerExists) ? segment.speakerName : '');
    }
  }, [segment, open, availableEngines.length, availableSpeakers.length]);

  useEffect(() => {
    if (availableModels.length > 0 && selectedModel) {
      const modelExists = availableModels.some(m => m.modelName === selectedModel);
      if (!modelExists) {
        setSelectedModel('');
      }
    }
  }, [availableModels, selectedModel]);

  useEffect(() => {
    if (supportedLanguages.length > 0 && selectedLanguage) {
      const languageExists = supportedLanguages.includes(selectedLanguage);
      if (!languageExists) {
        setSelectedLanguage('');
      }
    }
  }, [supportedLanguages, selectedLanguage]);

  useEffect(() => {
    if (selectedEngine && availableModels.length > 0) {
      const modelExists = availableModels.some(m => m.modelName === selectedModel);
      if (!modelExists) {
        setSelectedModel('');
      }
    }

    if (selectedEngine && supportedLanguages.length > 0) {
      const languageExists = supportedLanguages.includes(selectedLanguage);
      if (!languageExists) {
        setSelectedLanguage('');
      }
    }
  }, [selectedEngine]);

  const handleSave = async () => {
    if (!segment) return;

    if (!selectedEngine || !selectedModel || !selectedLanguage) {
      alert(t('segments.settings.validation.allFieldsRequired'));
      return;
    }

    setSaving(true);
    try {
      await onSave(segment.id, {
        engine: selectedEngine,
        modelName: selectedModel,
        language: selectedLanguage,
        speakerName: selectedSpeaker || null,
      });
      onClose();
    } catch (err) {
      console.error('Failed to update segment settings:', err);
      alert(t('segments.settings.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (segment) {
      const engineExists = availableEngines.some(e => e.name === segment.engine);
      setSelectedEngine(engineExists ? segment.engine : '');
      setSelectedModel(segment.modelName || '');
      setSelectedLanguage(segment.language || '');
      const speakerExists = availableSpeakers.some(s => s.name === segment.speakerName);
      setSelectedSpeaker((segment.speakerName && speakerExists) ? segment.speakerName : '');
    }
    onClose();
  };

  const isLoading = enginesLoading || modelsLoading || speakersLoading;
  const canSave = selectedEngine && selectedModel && selectedLanguage;

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
            <Alert severity="info" sx={{ mb: 1 }}>
              {t('segments.settings.description')}
            </Alert>

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

            <FormControl fullWidth disabled={!selectedEngine}>
              <InputLabel>{t('segments.settings.model')}</InputLabel>
              <Select
                value={selectedModel}
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

            <FormControl fullWidth disabled={!selectedEngine}>
              <InputLabel>{t('segments.settings.language')}</InputLabel>
              <Select
                value={selectedLanguage}
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

            <FormControl fullWidth>
              <InputLabel>{t('segments.settings.speaker')}</InputLabel>
              <Select
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                label={t('segments.settings.speaker')}
                displayEmpty
              >
                <MenuItem value="">
                  <em>{t('segments.settings.noSpeaker')}</em>
                </MenuItem>
                {availableSpeakers.map((speaker) => (
                  <MenuItem key={speaker.id} value={speaker.name}>
                    {speaker.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

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
