import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Tabs,
  Tab,
  Box,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Chip,
} from '@mui/material';
import { Upload, Description } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchSpeakers } from '../../services/settingsApi';
import { useAppStore } from '../../store/appStore';
import { projectApi } from '../../services/api';
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery';
import { logger } from '../../utils/logger';

interface ProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string }) => Promise<void>;
  onImportSuccess?: (project: any) => void;
  initialData?: { title: string; description: string };
  mode: 'create' | 'edit';
}

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  open,
  onClose,
  onSave,
  onImportSuccess,
  initialData,
  mode,
}) => {
  const { t } = useTranslation();

  // Tab state: 0 = manual, 1 = markdown import (only in create mode)
  const [tabIndex, setTabIndex] = useState(0);

  // Manual creation state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // TTS settings from appStore (for import)
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine());
  const currentModelName = useAppStore((state) => state.getCurrentTtsModelName());
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());
  const currentSpeaker = useAppStore((state) => state.getCurrentTtsSpeaker());
  const settings = useAppStore((state) => state.settings);

  // Fetch engines and models dynamically
  const { data: engines = [], isLoading: enginesLoading } = useTTSEngines();

  // Fetch speakers
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  const [engine, setEngine] = useState(currentEngine);
  const [modelName, setModelName] = useState(currentModelName);
  const [language, setLanguage] = useState(currentLanguage);
  const [speakerName, setSpeakerName] = useState(currentSpeaker || '');

  // Fetch models for selected engine
  const { data: models = [], isLoading: modelsLoading } = useTTSModels(engine);

  // Get engine info for selected engine
  const engineInfo = engines.find((e) => e.name === engine);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Only initialize when dialog opens (not when initialData changes from cache updates)
    if (open && !initialized) {
      // Reset state when dialog opens
      setTitle(initialData?.title || '');
      setDescription(initialData?.description || '');
      setTabIndex(0);
      setImportFile(null);
      setError(null);

      // Sync with appStore computed values
      setEngine(currentEngine);
      setModelName(currentModelName);
      setLanguage(currentLanguage);
      setSpeakerName(currentSpeaker || '');
      setInitialized(true);
    }
    // Reset initialization flag when dialog closes
    if (!open && initialized) {
      setInitialized(false);
    }
  }, [open, initialData, currentEngine, currentModelName, currentLanguage, currentSpeaker, initialized]);

  // Auto-select first model when engine changes
  useEffect(() => {
    if (engine && models.length > 0) {
      const modelExists = models.some(m => m.modelName === modelName);

      // If current model is invalid or empty, select first available model
      if (!modelExists || !modelName) {
        const firstModel = models[0].modelName;
        setModelName(firstModel);

        logger.group(
          '🔄 Engine Model Auto-Select',
          'Automatically selected first model after engine change',
          {
            'Engine': engine,
            'Auto-Selected Model': firstModel,
            'Previous Model': modelName || '(none)'
          },
          '#FF9800'
        );
      }
    }
  }, [engine, models]);

  // Auto-select default language when engine changes - use engine's default language from settings
  useEffect(() => {
    if (engineInfo && engineInfo.supportedLanguages.length > 0) {
      // Get default language from engine settings
      const engineConfig = settings?.tts.engines[engine];
      const defaultLanguage = engineConfig?.defaultLanguage;

      // Use default if valid, otherwise use first supported language
      if (defaultLanguage && engineInfo.supportedLanguages.includes(defaultLanguage)) {
        setLanguage(defaultLanguage);

        logger.group(
          '🌍 Language Auto-Select',
          'Using engine default language from settings',
          {
            'Engine': engine,
            'Selected Language': defaultLanguage,
            'Source': 'settings.tts.engines.defaultLanguage'
          },
          '#4CAF50'
        );
      } else if (engineInfo.supportedLanguages.length > 0) {
        // Fallback to first supported language
        setLanguage(engineInfo.supportedLanguages[0]);

        logger.group(
          '🌍 Language Auto-Select',
          'Using first supported language (no default found)',
          {
            'Engine': engine,
            'Selected Language': engineInfo.supportedLanguages[0],
            'Source': 'First in supportedLanguages'
          },
          '#FF9800'
        );
      }
    }
  }, [engine, engineInfo, settings]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size (max 10 MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(t('projects.import.fileTooLarge'));
        return;
      }

      // Validate file extension
      if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
        setError(t('projects.import.invalidFileType'));
        return;
      }

      setImportFile(file);
      setError(null);
    }
  };

  const handleSave = async () => {
    if (tabIndex === 0) {
      // Manual creation/edit
      if (!title.trim()) return;

      try {
        setSaving(true);
        logger.group(
          '📝 Project Save',
          'Saving project',
          {
            'Title': title,
            'Description': description || '(none)',
            'Mode': mode
          },
          '#2196F3'
        );
        await onSave({ title, description });
        onClose();
      } catch (err) {
        logger.error('[ProjectDialog] Failed to save project:', err);
        setError(t('projects.messages.error'));
      } finally {
        setSaving(false);
      }
    } else {
      // Markdown import
      if (!importFile) {
        setError(t('projects.import.noFileSelected'));
        return;
      }

      try {
        setImporting(true);
        setError(null);

        logger.group(
          '📝 Markdown Import',
          'Importing project from markdown file',
          {
            'File': importFile.name,
            'File Size': `${(importFile.size / 1024).toFixed(2)} KB`,
            'Engine': engine,
            'Model': modelName,
            'Language': language,
            'Speaker': speakerName || '(none)'
          },
          '#4CAF50'
        );

        const result = await projectApi.importFromMarkdown(importFile, {
          ttsEngine: engine,
          ttsModelName: modelName,
          language,
          ttsSpeakerName: speakerName || undefined,
        });

        if (onImportSuccess) {
          onImportSuccess(result.project);
        }

        onClose();
      } catch (err: any) {
        logger.error('[ProjectDialog] Import failed:', err);
        setError(err.message || t('projects.import.failed'));
      } finally {
        setImporting(false);
      }
    }
  };

  const isLoading = saving || importing;
  // For manual creation: title required
  // For import: file required AND speakers must be available (not loading, at least one available)
  const canSave = tabIndex === 0
    ? title.trim()
    : !!importFile && !speakersLoading && availableSpeakers.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'create' ? t('projects.createTitle') : t('projects.edit')}
      </DialogTitle>

      <DialogContent>
        {mode === 'create' && (
          <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
            <Tab label={t('projects.create.manual')} />
            <Tab label={t('projects.create.importMarkdown')} />
          </Tabs>
        )}

        <Box>
          {/* Manual Creation/Edit Tab */}
          {(mode === 'edit' || tabIndex === 0) && (
            <Stack spacing={2} sx={{ mt: mode === 'create' ? 0 : 1 }}>
              <TextField
                label={t('projects.projectTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                required
                autoFocus
              />
              <TextField
                label={t('common.description')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                rows={3}
              />
            </Stack>
          )}

          {/* Markdown Import Tab */}
          {mode === 'create' && tabIndex === 1 && (
            <Stack spacing={2}>
              <Button
                component="label"
                variant="outlined"
                startIcon={importFile ? <Description /> : <Upload />}
                fullWidth
                sx={{ justifyContent: 'flex-start', py: 1.5 }}
              >
                {importFile ? importFile.name : t('projects.import.selectFile')}
                <input
                  type="file"
                  accept=".md,.markdown"
                  hidden
                  onChange={handleFileSelect}
                />
              </Button>

              <FormHelperText>
                {t('projects.import.helpText')}
              </FormHelperText>

              <Alert severity="info">
                <Typography variant="body2" fontWeight="bold">
                  {t('projects.import.format.title')}
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                  • <code>#</code> {t('projects.import.format.projectTitle')}<br />
                  • <code>##</code> {t('projects.import.format.ignored')}<br />
                  • <code>###</code> {t('projects.import.format.chapter')}<br />
                  • <code>***</code> {t('projects.import.format.divider')}
                </Typography>
              </Alert>

              {importFile && (
                <>
                  <Typography variant="subtitle2" sx={{ mt: 2 }}>
                    {t('projects.create.ttsSettings')}
                  </Typography>

                  <FormControl fullWidth disabled={enginesLoading}>
                    <InputLabel>{t('tts.engine')}</InputLabel>
                    <Select
                      value={engines.some(e => e.name === engine) ? engine : ''}
                      onChange={(e) => setEngine(e.target.value)}
                      label={t('tts.engine')}
                    >
                      {engines.map((eng) => (
                        <MenuItem key={eng.name} value={eng.name}>
                          {eng.displayName}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth disabled={modelsLoading}>
                    <InputLabel>{t('tts.model')}</InputLabel>
                    <Select
                      value={models.some(m => m.modelName === modelName) ? modelName : ''}
                      onChange={(e) => setModelName(e.target.value)}
                      label={t('tts.model')}
                    >
                      {models.map((model) => (
                        <MenuItem key={model.modelName} value={model.modelName}>
                          {model.displayName}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth disabled={!engineInfo}>
                    <InputLabel>{t('tts.language')}</InputLabel>
                    <Select
                      value={engineInfo?.supportedLanguages.includes(language) ? language : ''}
                      onChange={(e) => setLanguage(e.target.value)}
                      label={t('tts.language')}
                    >
                      {engineInfo?.supportedLanguages.map((lang) => (
                        <MenuItem key={lang} value={lang}>
                          {lang.toUpperCase()}
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
                    <Alert severity="error">
                      <Typography variant="body2">
                        <strong>{t('audioGeneration.noSpeakers.title')}</strong>
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                        {t('audioGeneration.noSpeakers.description')}
                      </Typography>
                    </Alert>
                  )}

                  {/* Speaker Selection */}
                  {!speakersLoading && availableSpeakers.length > 0 && (
                    <FormControl fullWidth>
                      <InputLabel>{t('audioGeneration.speaker')}</InputLabel>
                      <Select
                        value={speakerName}
                        label={t('audioGeneration.speaker')}
                        onChange={(e) => setSpeakerName(e.target.value)}
                      >
                        {availableSpeakers.map((speaker) => (
                          <MenuItem key={speaker.id} value={speaker.name}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                              <Typography>{speaker.name}</Typography>
                              {speaker.samples.length > 0 && (
                                <Chip
                                  label={t('audioGeneration.samplesCount', { count: speaker.samples.length })}
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
                        {t('audioGeneration.speakersAvailable', { count: availableSpeakers.length })}
                      </FormHelperText>
                    </FormControl>
                  )}
                </>
              )}
            </Stack>
          )}

          {/* Error Message */}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave || isLoading}
          startIcon={isLoading && <CircularProgress size={16} />}
        >
          {isLoading
            ? importing
              ? t('projects.import.importing')
              : t('common.saving')
            : mode === 'create'
            ? t('common.create')
            : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
