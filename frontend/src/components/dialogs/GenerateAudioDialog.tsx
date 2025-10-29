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

interface GenerateAudioDialogProps {
  open: boolean;
  chapter: Chapter | null;
  onClose: () => void;
  onGenerate: (config: {
    speaker: string;
    language: string;
    engine: string;
    modelName: string;
    forceRegenerate: boolean;
  }) => Promise<void>;
}

export const GenerateAudioDialog: React.FC<GenerateAudioDialogProps> = ({
  open,
  chapter,
  onClose,
  onGenerate,
}) => {
  const { t } = useTranslation();
  const { data: engines, isLoading: enginesLoading } = useTTSEngines();
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000,
  });

  const currentEngine = useAppStore((state) => state.getCurrentEngine());
  const currentModelName = useAppStore((state) => state.getCurrentModelName());
  const currentSpeaker = useAppStore((state) => state.getCurrentSpeaker());
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());
  const setSessionOverride = useAppStore((state) => state.setSessionOverride);
  const startGeneration = useAppStore((state) => state.startGeneration);

  const { data: models, isLoading: modelsLoading } = useTTSModels(currentEngine);

  const [selectedSpeaker, setSelectedSpeaker] = useState(currentSpeaker);
  const [selectedLanguage, setSelectedLanguage] = useState(currentLanguage);
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const engineInfo = engines?.find((e) => e.name === currentEngine);
  const isLoading = enginesLoading || speakersLoading || modelsLoading;

  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  const maxLength =
    engineInfo?.constraints.maxTextLengthByLang?.[selectedLanguage] ??
    engineInfo?.constraints.maxTextLength ??
    250;

  const minLength = engineInfo?.constraints.minTextLength ?? 10;

  useEffect(() => {
    if (open) {
      setSelectedSpeaker(currentSpeaker);
      setSelectedLanguage(currentLanguage);
      setForceRegenerate(false);
      setIsGenerating(false);
    }
  }, [open, currentSpeaker, currentLanguage]);

  useEffect(() => {
    if (engineInfo && !engineInfo.supportedLanguages.includes(selectedLanguage)) {
      setSelectedLanguage(engineInfo.supportedLanguages[0] || 'en');
    }
  }, [currentEngine, engineInfo, selectedLanguage]);

  const handleGenerate = async () => {
    if (!chapter) return;

    setIsGenerating(true);
    try {
      setSessionOverride('speaker', selectedSpeaker);
      setSessionOverride('language', selectedLanguage);

      startGeneration(chapter.id);

      await onGenerate({
        speaker: selectedSpeaker,
        language: selectedLanguage,
        engine: currentEngine,
        modelName: currentModelName,
        forceRegenerate: forceRegenerate,
      });
      onClose();
    } catch (err) {
      console.error('Failed to start generation:', err);
      alert(t('audioGeneration.messages.failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (isGenerating) return;
    onClose();
  };

  if (!chapter) {
    return null;
  }

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
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress />
            </Box>
          )}

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

              <FormControl fullWidth>
                <InputLabel>{t('audioGeneration.language')}</InputLabel>
                <Select
                  value={selectedLanguage}
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
