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
  Alert,
  CircularProgress,
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { Audiotrack } from '@mui/icons-material';
import { useAllEnginesStatus } from '@hooks/useEnginesQuery';
import { useQuery } from '@tanstack/react-query';
import { fetchSpeakers } from '@services/settingsApi';
import { queryKeys } from '@services/queryKeys';
import { useAppStore } from '@store/appStore';
import { useDefaultSpeaker } from '@hooks/useSpeakersQuery';
import { useTranslation, Trans } from 'react-i18next';
import { useError } from '@hooks/useError';
import type { Chapter } from '@types';
import { logger } from '@utils/logger';

interface GenerateAudioDialogProps {
  open: boolean;
  chapter: Chapter | null;
  onClose: () => void;
  onGenerate: (config: {
    speaker?: string;
    language?: string;
    ttsEngine?: string;
    ttsModelName?: string;
    forceRegenerate: boolean;
    overrideSegmentSettings?: boolean;
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
  const { showError, ErrorDialog } = useError();
  const { data: enginesStatus, isLoading: enginesLoading } = useAllEnginesStatus();
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // TTS state from appStore (DB defaults)
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine());
  const settings = useAppStore((state) => state.settings);

  // Default speaker from speakers table (single source of truth)
  const { data: defaultSpeakerData } = useDefaultSpeaker();
  const defaultSpeaker = defaultSpeakerData?.name || '';

  // Extract TTS engines and models from unified status (only enabled engines)
  const engines = (enginesStatus?.tts ?? []).filter(e => e.isEnabled);

  // Get default engine info for default model/language (Single Source of Truth)
  const defaultEngineInfo = engines.find((e) => e.variantId === defaultEngine);
  const defaultModelName = defaultEngineInfo?.defaultModelName || '';
  const defaultLanguage = defaultEngineInfo?.defaultLanguage || 'de';

  // Local state (initialized from engine info - Single Source of Truth)
  const [overrideSettings, setOverrideSettings] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState(defaultEngine);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState(defaultSpeaker);
  const [selectedLanguage, setSelectedLanguage] = useState('de');
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Get active engine info (for override mode)
  const activeEngine = overrideSettings ? selectedEngine : defaultEngine;
  const engineInfo = engines.find((e) => e.variantId === activeEngine);
  const models = engineInfo?.availableModels ?? [];
  const isLoading = enginesLoading || speakersLoading;

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  // Calculate available languages: supportedLanguages + defaultLanguage from engine (if not already included)
  const availableLanguages = React.useMemo(() => {
    if (!engineInfo) return [];

    const supported = engineInfo.supportedLanguages || [];
    // Get default language directly from engine status (Single Source of Truth)
    const dbDefaultLanguage = engineInfo.defaultLanguage;

    // Add DB default language if it's not already in supported languages
    if (dbDefaultLanguage && !supported.includes(dbDefaultLanguage)) {
      return [dbDefaultLanguage, ...supported];
    }

    return supported;
  }, [engineInfo]);

  // Note: constraints removed from EngineStatusInfo - using defaults
  const maxLength = 250;
  const minLength = 10;

  // Initialize state when dialog opens
  useEffect(() => {
    if (open) {
      setOverrideSettings(false);
      setSelectedEngine(defaultEngine);
      setSelectedSpeaker(defaultSpeaker);
      setForceRegenerate(false);
      setIsGenerating(false);
      // Model and language will be set by the defaultEngineInfo useEffect below
    }
  }, [open, defaultEngine, defaultSpeaker]);

  // Update model and language from defaultEngineInfo when it loads (async data)
  useEffect(() => {
    if (open && defaultEngineInfo) {
      if (defaultEngineInfo.defaultModelName && !selectedModel) {
        setSelectedModel(defaultEngineInfo.defaultModelName);
      }
      if (defaultEngineInfo.defaultLanguage && selectedLanguage === 'de') {
        setSelectedLanguage(defaultEngineInfo.defaultLanguage);
      }
    }
  }, [open, defaultEngineInfo, selectedModel, selectedLanguage]);

  // Update selected language and model when selected engine changes
  useEffect(() => {
    if (overrideSettings && engineInfo && availableLanguages.length > 0) {
      // Get default language from engine status (Single Source of Truth)
      const dbDefaultLanguage = engineInfo.defaultLanguage;

      // Use default if available, otherwise use first available language
      if (dbDefaultLanguage && availableLanguages.includes(dbDefaultLanguage)) {
        setSelectedLanguage(dbDefaultLanguage);

        logger.group(
          '🌍 Language Auto-Select',
          'Using engine default language from engine status',
          {
            'Engine': selectedEngine,
            'Selected Language': dbDefaultLanguage,
            'Source': 'engineInfo.defaultLanguage',
            'Available Languages': availableLanguages
          },
          '#4CAF50'
        );
      } else if (availableLanguages.length > 0) {
        // Fallback to first available language
        setSelectedLanguage(availableLanguages[0]);

        logger.group(
          '🌍 Language Auto-Select',
          'Using first available language',
          {
            'Engine': selectedEngine,
            'Selected Language': availableLanguages[0],
            'Source': 'First in availableLanguages',
            'Available Languages': availableLanguages
          },
          '#FF9800'
        );
      }

      // Select model: use per-variant default if available, otherwise use first model
      if (models.length > 0) {
        // Try per-variant default model from engine status (Single Source of Truth)
        const perEngineDefaultModel = engineInfo.defaultModelName;
        const perEngineModelAvailable = perEngineDefaultModel && models.includes(perEngineDefaultModel);

        if (perEngineModelAvailable) {
          setSelectedModel(perEngineDefaultModel);

          logger.group(
            '🔧 Model Auto-Select',
            'Using per-engine default model from engine status',
            {
              'Engine': selectedEngine,
              'Selected Model': perEngineDefaultModel,
              'Source': 'engineInfo.defaultModelName',
              'Available Models': models
            },
            '#4CAF50'
          );
        } else {
          setSelectedModel(models[0]);

          logger.group(
            '🔧 Model Auto-Select',
            'Using first available model',
            {
              'Engine': selectedEngine,
              'Selected Model': models[0],
              'Source': 'First in models list',
              'Available Models': models,
              'Per-Engine Default': perEngineDefaultModel || 'none'
            },
            '#FF9800'
          );
        }
      }
    }
  }, [selectedEngine, engineInfo, settings, models, overrideSettings, availableLanguages]);

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
          'Override Settings': overrideSettings,
          'Engine': overrideSettings ? selectedEngine : '(from segments)',
          'Model': overrideSettings ? selectedModel : '(from segments)',
          'Language': overrideSettings ? selectedLanguage : '(from segments)',
          'Speaker': overrideSettings ? selectedSpeaker : '(from segments)',
          'Force Regenerate': forceRegenerate,
          'Segments Count': audioSegments.length,
          'Pending Segments': pendingSegments,
          'Completed Segments': completedSegments,
          'Frozen Segments': frozenSegments,
          'Will Generate': segmentsToGenerate
        },
        '#4CAF50'
      );

      await onGenerate({
        speaker: overrideSettings ? selectedSpeaker : undefined,
        language: overrideSettings ? selectedLanguage : undefined,
        ttsEngine: overrideSettings ? selectedEngine : undefined,
        ttsModelName: overrideSettings ? selectedModel : undefined,
        forceRegenerate: forceRegenerate,
        overrideSegmentSettings: overrideSettings,
      });
      onClose();
    } catch (err) {
      logger.error('[GenerateAudioDialog] Failed to start generation:', err);
      await showError(
        t('audioGeneration.title'),
        t('audioGeneration.messages.failed')
      );
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
  const frozenSegments = audioSegments.filter((s) => s.isFrozen).length;

  // Calculate segments that will be generated (excluding frozen)
  const segmentsToGenerate = forceRegenerate
    ? audioSegments.filter((s) => !s.isFrozen).length
    : audioSegments.filter((s) => s.status === 'pending' && !s.isFrozen).length;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="generate-audio-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Audiotrack color="primary" />
          <Typography variant="h6">{t('audioGeneration.title')}</Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Stack spacing={3}>
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

          {/* Content when engines/speakers are loaded */}
          {!isLoading && engineInfo && availableSpeakers.length > 0 && (
            <>
              {/* Override Settings Checkbox */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={overrideSettings}
                    onChange={(e) => setOverrideSettings(e.target.checked)}
                    disabled={isGenerating}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">
                      {t('audioGeneration.overrideSettings')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {overrideSettings
                        ? t('audioGeneration.overrideSettingsEnabled')
                        : t('audioGeneration.overrideSettingsDisabled')}
                    </Typography>
                  </Box>
                }
              />

              {/* Frozen Segments Warning (only show if override=true and frozen segments exist) */}
              {overrideSettings && frozenSegments > 0 && (
                <Alert severity="info">
                  <Typography variant="caption">
                    {t(`audioGeneration.frozenSegmentsInfo`, { count: frozenSegments })}
                  </Typography>
                </Alert>
              )}

              {/* TTS Parameters Selection (only show when override=true) */}
              {overrideSettings && (
                <Stack spacing={2}>
                  {/* Engine & Model Row */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {/* Engine Selection */}
                    <FormControl fullWidth>
                      <InputLabel>{t('tts.engine')}</InputLabel>
                      <Select
                        value={engines.some((e) => e.variantId === selectedEngine) ? selectedEngine : ''}
                        label={t('tts.engine')}
                        onChange={(e) => setSelectedEngine(e.target.value)}
                        disabled={isGenerating}
                      >
                        {engines.map((engine) => (
                          <MenuItem key={engine.variantId} value={engine.variantId}>
                            {engine.displayName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    {/* Model Selection */}
                    <FormControl fullWidth>
                      <InputLabel>{t('tts.model')}</InputLabel>
                      <Select
                        value={models.includes(selectedModel) ? selectedModel : ''}
                        label={t('tts.model')}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={isGenerating || models.length === 0}
                      >
                        {models.map((model) => (
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
                      <InputLabel>{t('audioGeneration.speaker')}</InputLabel>
                      <Select
                        value={availableSpeakers.some((s) => s.name === selectedSpeaker) ? selectedSpeaker : ''}
                        label={t('audioGeneration.speaker')}
                        onChange={(e) => setSelectedSpeaker(e.target.value)}
                        disabled={isGenerating}
                      >
                        {availableSpeakers.map((speaker) => (
                          <MenuItem key={speaker.id} value={speaker.name}>
                            {speaker.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    {/* Language Selection */}
                    <FormControl fullWidth>
                      <InputLabel>{t('audioGeneration.language')}</InputLabel>
                      <Select
                        value={availableLanguages.includes(selectedLanguage) ? selectedLanguage : ''}
                        label={t('audioGeneration.language')}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        disabled={isGenerating}
                      >
                        {availableLanguages.map((lang) => (
                          <MenuItem key={lang} value={lang}>
                            {t(`languages.${lang}`, lang.toUpperCase())}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                </Stack>
              )}

              {/* Regenerate Checkbox (only show if there are completed segments) */}
              {completedSegments > 0 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      data-testid="generate-audio-regenerate"
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

              {/* Generation Summary */}
              <Alert severity={forceRegenerate ? "warning" : "success"}>
                <Typography variant="body2" component="div">
                  <Trans
                    i18nKey="audioGeneration.willGenerate"
                    values={{
                      count: segmentsToGenerate,
                      total: totalSegments,
                      engine: engineInfo?.displayName || ''
                    }}
                    components={{ strong: <strong /> }}
                  />
                </Typography>
                {forceRegenerate && (completedSegments - frozenSegments) > 0 && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    {t('audioGeneration.regenerateWithFrozen', {
                      completed: completedSegments - frozenSegments,
                      completedPlural: (completedSegments - frozenSegments) === 1 ? t('common.segment') : t('common.segments'),
                      frozen: frozenSegments,
                      frozenPlural: frozenSegments === 1 ? t('common.segment') : t('common.segments')
                    })}
                  </Typography>
                )}
                {!forceRegenerate && totalSegments > 0 && pendingSegments === 0 && frozenSegments === 0 && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    {t('audioGeneration.allCompleted')}
                  </Typography>
                )}
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button
          onClick={handleClose}
          disabled={isGenerating || isLoading}
          data-testid="generate-audio-cancel"
        >
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleGenerate}
          variant="contained"
          data-testid="generate-audio-submit"
          disabled={
            isGenerating ||
            isLoading ||
            !engineInfo ||
            (overrideSettings && (!selectedEngine || !selectedModel || !selectedSpeaker)) || // Require all params if override=true
            availableSpeakers.length === 0 ||
            segmentsToGenerate === 0
          }
          startIcon={isGenerating ? <CircularProgress size={16} /> : <Audiotrack />}
        >
          {isGenerating ? t('audioGeneration.starting') : t('audioGeneration.generate')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  );
};
