import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Alert,
  CircularProgress,
  Box,
  Typography,
  Chip,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { Audiotrack } from '@mui/icons-material';
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery';
import { useQuery } from '@tanstack/react-query';
import { fetchSpeakers } from '../../services/settingsApi';
import { useAppStore } from '../../store/appStore';
import { useTranslation, Trans } from 'react-i18next';
import type { Chapter } from '../../types';
import { logger } from '../../utils/logger';

interface GenerateAudioDialogProps {
  open: boolean;
  chapter: Chapter | null;
  onClose: () => void;
  onGenerate: (config: {
    speaker: string;
    language: string;
    ttsEngine: string;
    ttsModelName: string;
    forceRegenerate: boolean;
  }) => Promise<void>;
}

export const GenerateAudioDialog: React.FC<GenerateAudioDialogProps> = ({
  open,
  chapter,
  onClose,
  onGenerate,
}) => {
  // ALL HOOKS FIRST (React Hook Rules!)
  const { t } = useTranslation();
  const { data: engines, isLoading: enginesLoading } = useTTSEngines();
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // TTS state from appStore (uses computed getters)
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine());
  const currentModelName = useAppStore((state) => state.getCurrentTtsModelName());
  const currentSpeaker = useAppStore((state) => state.getCurrentTtsSpeaker());
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());
  const setSessionOverride = useAppStore((state) => state.setSessionOverride);
  const settings = useAppStore((state) => state.settings);

  // Fetch models for current engine
  const { data: models, isLoading: modelsLoading } = useTTSModels(currentEngine);

  // Local state (initialized from appStore computed values)
  const [selectedSpeaker, setSelectedSpeaker] = useState(currentSpeaker);
  const [selectedLanguage, setSelectedLanguage] = useState(currentLanguage);
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Computed values
  const engineInfo = engines?.find((e) => e.name === currentEngine);
  const isLoading = enginesLoading || speakersLoading || modelsLoading;

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  // Calculate max text length for selected engine + language
  const maxLength =
    engineInfo?.constraints.maxTextLengthByLang?.[selectedLanguage] ??
    engineInfo?.constraints.maxTextLength ??
    250;

  const minLength = engineInfo?.constraints.minTextLength ?? 10;

  // Initialize state from appStore computed values when dialog opens
  useEffect(() => {
    if (open) {
      // Use current computed values as defaults
      setSelectedSpeaker(currentSpeaker);
      setSelectedLanguage(currentLanguage);
      setForceRegenerate(false);
      setIsGenerating(false);
    }
  }, [open, currentSpeaker, currentLanguage]);

  // Update selected language when engine changes - use engine's default language from settings
  useEffect(() => {
    if (engineInfo && engineInfo.supportedLanguages.length > 0) {
      // Get default language from engine settings
      const engineConfig = settings?.tts.engines[currentEngine];
      const defaultLanguage = engineConfig?.defaultLanguage;

      // Use default if valid, otherwise use first supported language
      if (defaultLanguage && engineInfo.supportedLanguages.includes(defaultLanguage)) {
        setSelectedLanguage(defaultLanguage);

        logger.group(
          '🌍 Language Auto-Select',
          'Using engine default language from settings',
          {
            'Engine': currentEngine,
            'Selected Language': defaultLanguage,
            'Source': 'settings.tts.engines.defaultLanguage'
          },
          '#4CAF50'
        );
      } else if (engineInfo.supportedLanguages.length > 0) {
        // Fallback to first supported language
        setSelectedLanguage(engineInfo.supportedLanguages[0]);

        logger.group(
          '🌍 Language Auto-Select',
          'Using first supported language (no default found)',
          {
            'Engine': currentEngine,
            'Selected Language': engineInfo.supportedLanguages[0],
            'Source': 'First in supportedLanguages'
          },
          '#FF9800'
        );
      }
    }
  }, [currentEngine, engineInfo, settings]);

  // Handlers
  const handleGenerate = async () => {
    if (!chapter) return;

    setIsGenerating(true);
    try {
      logger.group(
        '📝 Audio Generation Start',
        'Starting chapter audio generation',
        {
          'Chapter ID': chapter.id,
          'Chapter Title': chapter.title,
          'Engine': currentEngine,
          'Model': currentModelName,
          'Language': selectedLanguage,
          'Speaker': selectedSpeaker,
          'Force Regenerate': forceRegenerate,
          'Segments Count': audioSegments.length,
          'Pending Segments': pendingSegments,
          'Completed Segments': completedSegments
        },
        '#4CAF50'
      );

      // Update session overrides with selected values
      setSessionOverride('ttsSpeaker', selectedSpeaker);
      setSessionOverride('language', selectedLanguage);

      await onGenerate({
        speaker: selectedSpeaker,
        language: selectedLanguage,
        ttsEngine: currentEngine,
        ttsModelName: currentModelName,
        forceRegenerate: forceRegenerate,
      });
      onClose();
    } catch (err) {
      logger.error('[GenerateAudioDialog] Failed to start generation:', err);
      alert(t('audioGeneration.messages.failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (isGenerating) return; // Don't close during generation
    onClose();
  };

  // Early return for no chapter
  if (!chapter) {
    return null;
  }

  // Only count audio segments, not dividers (same as ChapterView)
  const audioSegments = chapter.segments.filter((s) => s.segmentType !== 'divider');
  const totalSegments = audioSegments.length;
  const pendingSegments = audioSegments.filter((s) => s.status === 'pending').length;
  const completedSegments = audioSegments.filter((s) => s.status === 'completed').length;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Audiotrack color="primary" />
          <Typography variant="h6">{t('audioGeneration.title')}</Typography>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {/* Loading State */}
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress />
            </Box>
          )}

          {/* No speakers warning */}
          {!isLoading && availableSpeakers.length === 0 && (
            <Alert severity="error">
              <Typography variant="body2">
                <strong>{t('audioGeneration.noSpeakers.title')}</strong>
              </Typography>
              <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                {t('audioGeneration.noSpeakers.description')}
              </Typography>
            </Alert>
          )}

          {/* Current Engine & Model Info */}
          {!isLoading && engineInfo && availableSpeakers.length > 0 && (
            <>
              <Alert severity="info">
                <Typography variant="body2">
                  <strong>{t('audioGeneration.usingEngine')}</strong> {engineInfo.displayName}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  <strong>{t('audioGeneration.usingModel')}</strong>{' '}
                  {models?.find((m) => m.modelName === currentModelName)?.displayName || currentModelName}
                </Typography>
                <Typography variant="caption" component="div">
                  {t('audioGeneration.textLimits', { min: minLength, max: maxLength, language: selectedLanguage.toUpperCase() })}
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                  {t('audioGeneration.changeEngineHint')}
                </Typography>
              </Alert>

              {/* Language Selection */}
              <FormControl fullWidth>
                <InputLabel>{t('audioGeneration.language')}</InputLabel>
                <Select
                  value={engineInfo?.supportedLanguages.includes(selectedLanguage) ? selectedLanguage : ''}
                  label={t('audioGeneration.language')}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  disabled={isGenerating}
                >
                  {engineInfo?.supportedLanguages.map((lang) => (
                    <MenuItem key={lang} value={lang}>
                      {lang.toUpperCase()}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {t('audioGeneration.languagesSupported', { count: engineInfo?.supportedLanguages.length || 0 })}
                </FormHelperText>
              </FormControl>

              {/* Speaker Selection */}
              <FormControl fullWidth>
                <InputLabel>{t('audioGeneration.speaker')}</InputLabel>
                <Select
                  value={selectedSpeaker}
                  label={t('audioGeneration.speaker')}
                  onChange={(e) => setSelectedSpeaker(e.target.value)}
                  disabled={isGenerating}
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

              {/* Regenerate Checkbox (only show if there are completed segments) */}
              {completedSegments > 0 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={forceRegenerate}
                      onChange={(e) => setForceRegenerate(e.target.checked)}
                      disabled={isGenerating}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {t('audioGeneration.regenerateCompleted', { count: completedSegments })}
                    </Typography>
                  }
                />
              )}

              {/* Warning when force_regenerate is enabled */}
              {forceRegenerate && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  <strong>{t('common.warning')}:</strong> {t('audioGeneration.forceRegenerateWarning')}
                </Alert>
              )}

              {/* Generation Summary */}
              <Alert severity="warning">
                <Typography variant="body2" component="div">
                  <Trans
                    i18nKey="audioGeneration.willGenerate"
                    values={{
                      count: forceRegenerate ? totalSegments : pendingSegments,
                      total: totalSegments,
                      engine: engineInfo?.displayName || ''
                    }}
                    components={{ strong: <strong /> }}
                  />
                </Typography>
                {forceRegenerate && completedSegments > 0 && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    {t('audioGeneration.regenerateWarning')}
                  </Typography>
                )}
                {!forceRegenerate && totalSegments > 0 && pendingSegments === 0 && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    {t('audioGeneration.allCompleted')}
                  </Typography>
                )}
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isGenerating || isLoading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleGenerate}
          variant="contained"
          disabled={isGenerating || isLoading || !engineInfo || !selectedSpeaker || availableSpeakers.length === 0}
          startIcon={isGenerating ? <CircularProgress size={16} /> : <Audiotrack />}
        >
          {isGenerating ? t('audioGeneration.starting') : t('audioGeneration.generate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
