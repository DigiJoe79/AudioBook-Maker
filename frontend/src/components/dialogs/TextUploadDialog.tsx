import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Box,
  Divider,
  FormHelperText,
  Alert,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Upload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
  Segment as SegmentIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useError } from '@hooks/useError';
import { useQuery } from '@tanstack/react-query';
import { fetchSpeakers } from '@services/settingsApi';
import { queryKeys } from '@services/queryKeys';
import { useAppStore } from '@store/appStore';
import { useAllEnginesStatus } from '@hooks/useEnginesQuery';
import { useTextEngineLanguages } from '@hooks/useTextEngineLanguages';
import { useDefaultSpeaker } from '@hooks/useSpeakersQuery';
import type { Segment } from '@types';
import { logger } from '@utils/logger';
import TextFileUploadArea from './TextFileUploadArea';

interface SegmentationResult {
  success: boolean;
  message: string;
  segments: Segment[];
  segmentCount: number;
  ttsEngine: string;
  constraints: Record<string, number>;
}

interface TextUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (data: {
    text: string;
    textLanguage: string;
    ttsEngine: string;
    ttsModelName: string;
    ttsLanguage: string;
    speaker: string;
  }) => Promise<SegmentationResult | undefined>;
}

export const TextUploadDialog: React.FC<TextUploadDialogProps> = ({
  open,
  onClose,
  onUpload,
}) => {
  const { t } = useTranslation();
  const { showError, ErrorDialog } = useError();

  // Get default settings from store (DB)
  const getDefaultTtsEngine = useAppStore((state) => state.getDefaultTtsEngine);
  const getDefaultTtsModel = useAppStore((state) => state.getDefaultTtsModel);
  const getDefaultLanguage = useAppStore((state) => state.getDefaultLanguage);
  const settings = useAppStore((state) => state.settings);

  // Default speaker from speakers table (single source of truth)
  const { data: defaultSpeakerData } = useDefaultSpeaker();

  // Load available text engine languages from engines status
  const { languages: textLanguages, isLoading: textLanguagesLoading } = useTextEngineLanguages();

  // Fetch TTS engines (only enabled engines)
  const { data: enginesStatus, isLoading: enginesLoading } = useAllEnginesStatus();
  const engines = (enginesStatus?.tts ?? []).filter(e => e.isEnabled);

  // Fetch speakers
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  // State for file upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [text, setText] = useState('');

  // State for segmentation
  const [textLanguage, setTextLanguage] = useState<string>('');

  // State for TTS settings (initialized from DB defaults)
  const defaultEngine = getDefaultTtsEngine();
  const [ttsEngine, setTtsEngine] = useState<string>(defaultEngine);
  const [ttsModelName, setTtsModelName] = useState<string>(getDefaultTtsModel(defaultEngine));
  const [language, setLanguage] = useState<string>(getDefaultLanguage());
  const [speaker, setSpeaker] = useState(defaultSpeakerData?.name || '');

  // State for accordion
  const [expandedSection, setExpandedSection] = useState<'segmentation' | 'tts' | null>('segmentation');

  // State for upload
  const [uploading, setUploading] = useState(false);

  // Get engine info for selected engine
  const engineInfo = engines.find((e) => e.name === ttsEngine);
  const models = engineInfo?.availableModels ?? [];

  // Calculate available languages: supportedLanguages + defaultLanguage from DB (if not already included)
  const availableLanguages = React.useMemo(() => {
    if (!engineInfo) return [];

    const supported = engineInfo.supportedLanguages || [];
    const engineConfig = settings?.tts.engines[ttsEngine];
    const dbDefaultLanguage = engineConfig?.defaultLanguage;

    // Add DB default language if it's not already in supported languages
    if (dbDefaultLanguage && !supported.includes(dbDefaultLanguage)) {
      return [dbDefaultLanguage, ...supported];
    }

    return supported;
  }, [engineInfo, settings, ttsEngine]);

  // Initialize text language when languages are loaded
  useEffect(() => {
    if (!textLanguagesLoading && textLanguages && textLanguages.length > 0 && !textLanguage) {
      // Use first available language
      setTextLanguage(textLanguages[0]);
    }
  }, [textLanguages, textLanguagesLoading, textLanguage]);

  // Update TTS settings when dialog opens or default settings change
  useEffect(() => {
    if (open) {
      const engine = getDefaultTtsEngine();
      setTtsEngine(engine);
      setTtsModelName(getDefaultTtsModel(engine));
      setLanguage(getDefaultLanguage());
      setSpeaker(defaultSpeakerData?.name || '');
    }
  }, [open, getDefaultTtsEngine, getDefaultTtsModel, getDefaultLanguage, defaultSpeakerData]);

  // Auto-select model when engine changes: use DB default if available, otherwise use first model
  useEffect(() => {
    if (ttsEngine && models.length > 0) {
      const modelExists = models.includes(ttsModelName);

      // If current model is invalid or empty, select best available model
      if (!modelExists || !ttsModelName) {
        // Get per-engine default model
        const dbDefaultModel = getDefaultTtsModel(ttsEngine);
        const defaultModelAvailable = models.includes(dbDefaultModel);

        if (dbDefaultModel && defaultModelAvailable) {
          setTtsModelName(dbDefaultModel);

          logger.group(
            '🔧 Text Upload - Model Auto-Select',
            'Using default model from DB settings',
            {
              'Engine': ttsEngine,
              'Selected Model': dbDefaultModel,
              'Source': 'settings.tts.engines.{engine}.defaultModelName',
              'Available Models': models
            },
            '#4CAF50'
          );
        } else {
          const firstModel = models[0];
          setTtsModelName(firstModel);

          logger.group(
            '🔧 Text Upload - Model Auto-Select',
            'Using first available model',
            {
              'Engine': ttsEngine,
              'Selected Model': firstModel,
              'Source': 'First in models list',
              'Available Models': models,
              'DB Default': dbDefaultModel || 'none'
            },
            '#FF9800'
          );
        }
      }
    }
  }, [ttsEngine, models, ttsModelName, getDefaultTtsModel]);

  // Auto-select language when engine changes: use DB default if available, otherwise use first language
  useEffect(() => {
    if (engineInfo && availableLanguages.length > 0) {
      // Get default language from engine settings
      const engineConfig = settings?.tts.engines[ttsEngine];
      const dbDefaultLanguage = engineConfig?.defaultLanguage;

      // Use DB default if available, otherwise use first available language
      if (dbDefaultLanguage && availableLanguages.includes(dbDefaultLanguage)) {
        setLanguage(dbDefaultLanguage);

        logger.group(
          '🌍 Text Upload - Language Auto-Select',
          'Using engine default language from DB settings',
          {
            'Engine': ttsEngine,
            'Selected Language': dbDefaultLanguage,
            'Source': 'settings.tts.engines.defaultLanguage',
            'Available Languages': availableLanguages
          },
          '#4CAF50'
        );
      } else if (availableLanguages.length > 0) {
        // Fallback to first available language
        setLanguage(availableLanguages[0]);

        logger.group(
          '🌍 Text Upload - Language Auto-Select',
          'Using first available language',
          {
            'Engine': ttsEngine,
            'Selected Language': availableLanguages[0],
            'Source': 'First in availableLanguages',
            'Available Languages': availableLanguages
          },
          '#FF9800'
        );
      }
    }
  }, [ttsEngine, engineInfo, settings, availableLanguages]);

  // Reset text and file after dialog closes (after animation completes)
  useEffect(() => {
    if (!open) {
      // Wait for closing animation to complete (300ms)
      const timer = setTimeout(() => {
        setText('');
        setSelectedFile(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Handle file selection
  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setText(content);
      };
      reader.readAsText(file);
    } else {
      setText('');
    }
  }, []);

  // Handle accordion change
  const handleAccordionChange = useCallback((panel: 'segmentation' | 'tts') =>
    (_event: React.SyntheticEvent, isExpanded: boolean) => {
      setExpandedSection(isExpanded ? panel : null);
    }, []);

  const handleUpload = async () => {
    if (!text.trim()) return;

    setUploading(true);
    try {
      logger.group(
        '📤 Upload',
        'Creating segments from text',
        {
          'Text Length': text.trim().length,
          'Text Language': textLanguage,
          'TTS Engine': ttsEngine,
          'TTS Model': ttsModelName,
          'TTS Language': language,
          'TTS Speaker': speaker
        },
        '#FF9800'  // Orange badge color
      );

      await onUpload({
        text,
        textLanguage,
        ttsEngine,
        ttsModelName,
        ttsLanguage: language,
        speaker,
      });
      onClose();
      // Reset state
      setText('');
      setSelectedFile(null);
    } catch (err) {
      logger.error('[TextUploadDialog] Failed to create segments:', err);
      await showError(
        t('textUpload.title'),
        t('textUpload.messages.error')
      );
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    // State will be reset after successful upload (see handleUpload Line 295-296)
    onClose();
  };

  // Check if upload is enabled
  const isUploadEnabled =
    text.trim().length > 0 &&
    !uploading &&
    !textLanguagesLoading &&
    textLanguages &&
    textLanguages.length > 0 &&
    textLanguage.length > 0 &&
    availableSpeakers.length > 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      data-testid="text-upload-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          height: '80vh',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <UploadIcon />
          <Typography variant="h6">{t('textUpload.title')}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent
        sx={{
          bgcolor: 'background.default',
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Split-View Layout */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' },
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Left Panel - Settings (1/3) */}
          <Box
            sx={{
              height: '100%',
              borderRight: { xs: 'none', md: '1px solid' },
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Scrollable Settings */}
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                p: (theme) => theme.custom.spacing.md,
                '&::-webkit-scrollbar': {
                  width: (theme) => theme.custom.spacing.xs,
                },
                '&::-webkit-scrollbar-track': {
                  background: 'transparent',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'divider',
                  borderRadius: (theme) => theme.custom.borderRadius.sm,
                  '&:hover': {
                    backgroundColor: 'text.disabled',
                  },
                },
              }}
            >
              <Stack spacing={2}>
                {/* Segmentation Settings Accordion */}
                <Accordion
                  expanded={expandedSection === 'segmentation'}
                  onChange={handleAccordionChange('segmentation')}
                  sx={{
                    bgcolor: 'action.hover',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: (theme) => theme.custom.borderRadius.sm,
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                    margin: 0,
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      minHeight: (theme) => theme.custom.heights.tabs,
                      '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                      '& .MuiAccordionSummary-content': {
                        my: 1,
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SegmentIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          color: 'text.secondary',
                        }}
                      >
                        {t('textUpload.segmentation.title')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                    <Stack spacing={2}>
                      {/* Text Language Selector */}
                      <FormControl fullWidth size="small" disabled={textLanguagesLoading}>
                        <InputLabel>{t('textUpload.segmentation.textLanguage')}</InputLabel>
                        <Select
                          value={textLanguage}
                          label={t('textUpload.segmentation.textLanguage')}
                          onChange={(e) => setTextLanguage(e.target.value)}
                        >
                          {textLanguages?.map((code) => (
                            <MenuItem key={code} value={code}>
                              {t(`languages.${code}`, code.toUpperCase())}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {/* Warning if no text models available */}
                      {!textLanguagesLoading && (!textLanguages || textLanguages.length === 0) && (
                        <Alert severity="error">
                          {t('textUpload.segmentation.noTextModels')}
                        </Alert>
                      )}

                    </Stack>
                  </AccordionDetails>
                </Accordion>

                {/* TTS Settings Accordion (Optional) */}
                <Accordion
                  expanded={expandedSection === 'tts'}
                  onChange={handleAccordionChange('tts')}
                  data-testid="text-upload-tts-accordion"
                  sx={{
                    bgcolor: 'action.hover',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: (theme) => theme.custom.borderRadius.sm,
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                    margin: 0,
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      minHeight: (theme) => theme.custom.heights.tabs,
                      '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                      '& .MuiAccordionSummary-content': {
                        my: 1,
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SettingsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          color: 'text.secondary',
                        }}
                      >
                        {t('textUpload.tts.title')}
                      </Typography>
                      <Chip
                        label={t('common.optional')}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.65rem',
                          bgcolor: 'action.selected',
                        }}
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                    <Stack spacing={2}>
                      {/* Engine Selection */}
                      <FormControl fullWidth disabled={enginesLoading}>
                        <InputLabel>{t('tts.engine')}</InputLabel>
                        <Select
                          value={engines.some((e) => e.name === ttsEngine) ? ttsEngine : ''}
                          onChange={(e) => setTtsEngine(e.target.value)}
                          label={t('tts.engine')}
                        >
                          {engines.map((eng) => (
                            <MenuItem key={eng.name} value={eng.name}>
                              {eng.displayName}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {/* Model Selection */}
                      <FormControl fullWidth>
                        <InputLabel>{t('tts.model')}</InputLabel>
                        <Select
                          value={models.includes(ttsModelName) ? ttsModelName : ''}
                          onChange={(e) => setTtsModelName(e.target.value)}
                          label={t('tts.model')}
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
                            value={speaker}
                            label={t('audioGeneration.speaker')}
                            onChange={(e) => setSpeaker(e.target.value)}
                            disabled={uploading}
                            data-testid="text-upload-speaker-select"
                          >
                            {availableSpeakers.map((spk) => (
                              <MenuItem key={spk.id} value={spk.name}>
                                {spk.name}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}

                      {/* TTS Language Selection */}
                      <FormControl fullWidth disabled={!engineInfo}>
                        <InputLabel>{t('tts.language')}</InputLabel>
                        <Select
                          value={availableLanguages.includes(language) ? language : ''}
                          onChange={(e) => setLanguage(e.target.value)}
                          label={t('tts.language')}
                        >
                          {availableLanguages.map((lang) => (
                            <MenuItem key={lang} value={lang}>
                              {t(`languages.${lang}`, lang.toUpperCase())}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            </Box>
          </Box>

          {/* Right Panel - Upload & Text (2/3) */}
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Upload & Text Content */}
            <Box
              sx={{
                flex: 1,
                overflow: 'hidden',
                p: (theme) => theme.custom.spacing.md,
                display: 'flex',
                flexDirection: 'column',
                gap: (theme) => theme.custom.spacing.md,
              }}
            >
              {/* File Upload Area */}
              <TextFileUploadArea
                onFileSelect={handleFileSelect}
                selectedFile={selectedFile}
              />

              {/* Or Divider */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Divider sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {t('textUpload.fileUpload.or')}
                </Typography>
                <Divider sx={{ flex: 1 }} />
              </Box>

              {/* Text Input */}
              <TextField
                value={text}
                onChange={(e) => setText(e.target.value)}
                fullWidth
                multiline
                placeholder={t('textUpload.placeholder')}
                minRows={1}
                maxRows={1}
                data-testid="text-upload-text-input"
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  '& .MuiInputBase-root': {
                    flex: 1,
                    alignItems: 'flex-start',
                    padding: '0 0 14px 0', // Padding unten, damit Scrollbar nicht bis zum Rand geht
                  },
                  '& textarea': {
                    overflow: 'auto !important',
                    height: '100% !important',
                    padding: '14px 8px 0 14px', // top, right, bottom, left - kein bottom padding (ist im Root)
                  },
                }}
              />
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={handleClose} disabled={uploading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={!isUploadEnabled || uploading}
          startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
          data-testid="text-upload-submit-button"
        >
          {uploading ? t('textUpload.creating') : t('textUpload.createSegments')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  );
};
