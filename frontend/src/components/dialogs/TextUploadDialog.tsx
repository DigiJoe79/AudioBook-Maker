import React, { useState, useEffect } from 'react';
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
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  FormHelperText,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import { Upload } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchSpeakers } from '../../services/settingsApi';
import { useAppStore } from '../../store/appStore';
import type { Segment } from '../../types';
import { logger } from '../../utils/logger';

interface SegmentationPreview {
  success: boolean;
  message: string;
  segments: Segment[]; // Full segment objects when autoCreate=true
  preview?: Array<{ text: string; orderIndex: number }>; // Preview when autoCreate=false
  segmentCount: number;
  ttsEngine: string;
  constraints: Record<string, number>;
}

interface TextUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (data: {
    text: string;
    method: 'sentences' | 'paragraphs' | 'smart' | 'length';
    language: string;
    speaker: string;
    autoCreate: boolean;
  }) => Promise<SegmentationPreview | undefined>;
}

export const TextUploadDialog: React.FC<TextUploadDialogProps> = ({
  open,
  onClose,
  onUpload,
}) => {
  const { t } = useTranslation();

  // Get current settings from store
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());
  const currentSpeaker = useAppStore((state) => state.getCurrentTtsSpeaker());

  // Fetch speakers
  const { data: speakers, isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // Filter speakers - only show active speakers (those with samples)
  const availableSpeakers = speakers?.filter(speaker => speaker.isActive) || [];

  const [text, setText] = useState('');
  const [method, setMethod] = useState<'sentences' | 'paragraphs' | 'smart' | 'length'>('smart');
  const [language, setLanguage] = useState(currentLanguage);
  const [speaker, setSpeaker] = useState(currentSpeaker);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<SegmentationPreview | null>(null);

  // Update speaker when dialog opens or currentSpeaker changes
  useEffect(() => {
    if (open) {
      setSpeaker(currentSpeaker);
      setLanguage(currentLanguage);
    }
  }, [open, currentSpeaker, currentLanguage]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setText(content);
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!text.trim()) return;

    setUploading(true);
    try {
      logger.group(
        '📤 Upload',
        'Previewing segmentation',
        {
          'Text Length': text.trim().length,
          'Method': method,
          'Language': language,
          'Speaker': speaker
        },
        '#FF9800'  // Orange badge color
      )

      const result = await onUpload({
        text,
        method,
        language,
        speaker,
        autoCreate: false, // Preview mode
      });
      setPreview(result || null);
    } catch (err) {
      logger.error('[TextUploadDialog] Failed to preview segmentation:', err);
      alert(t('textUpload.messages.failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!text.trim()) return;

    setUploading(true);
    try {
      logger.group(
        '📤 Upload',
        'Creating segments from text',
        {
          'Text Length': text.trim().length,
          'Method': method,
          'Language': language,
          'Speaker': speaker,
          'Expected Segments': preview?.segmentCount || 'Unknown'
        },
        '#FF9800'  // Orange badge color
      )

      await onUpload({
        text,
        method,
        language,
        speaker,
        autoCreate: true, // Create segments
      });
      onClose();
      // Reset state
      setText('');
      setPreview(null);
    } catch (err) {
      logger.error('[TextUploadDialog] Failed to create segments:', err);
      alert(t('textUpload.messages.error'));
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setText('');
    setPreview(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('textUpload.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* File Upload */}
          <Box>
            <Button
              variant="outlined"
              component="label"
              startIcon={<Upload />}
              fullWidth
            >
              {t('textUpload.upload')}
              <input
                type="file"
                accept=".txt"
                hidden
                onChange={handleFileUpload}
              />
            </Button>
          </Box>

          {/* Text Input */}
          <TextField
            label={t('textUpload.textContent')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            fullWidth
            multiline
            rows={8}
            placeholder={t('textUpload.placeholder')}
          />

          {/* Loading State */}
          {speakersLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress />
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

          {/* Segmentation Options */}
          {!speakersLoading && availableSpeakers.length > 0 && (
            <>
              <Stack direction="row" spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>{t('textUpload.segmentationMethod')}</InputLabel>
                  <Select
                    value={method}
                    label={t('textUpload.segmentationMethod')}
                    onChange={(e) => setMethod(e.target.value as 'sentences' | 'paragraphs' | 'smart' | 'length')}
                    disabled={uploading}
                  >
                    <MenuItem value="smart">{t('textUpload.methods.smart')}</MenuItem>
                    <MenuItem value="sentences">{t('textUpload.methods.sentences')}</MenuItem>
                    <MenuItem value="paragraphs">{t('textUpload.methods.paragraphs')}</MenuItem>
                    <MenuItem value="length">{t('textUpload.methods.length')}</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>{t('textUpload.language')}</InputLabel>
                  <Select
                    value={language}
                    label={t('textUpload.language')}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={uploading}
                  >
                    <MenuItem value="de">{t('textUpload.languages.de')}</MenuItem>
                    <MenuItem value="en">{t('textUpload.languages.en')}</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              {/* Speaker Selection */}
              <FormControl fullWidth>
                <InputLabel>{t('audioGeneration.speaker')}</InputLabel>
                <Select
                  value={speaker}
                  label={t('audioGeneration.speaker')}
                  onChange={(e) => setSpeaker(e.target.value)}
                  disabled={uploading}
                >
                  {availableSpeakers.map((spk) => (
                    <MenuItem key={spk.id} value={spk.name}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                        <Typography>{spk.name}</Typography>
                        {spk.samples.length > 0 && (
                          <Chip
                            label={t('audioGeneration.samplesCount', { count: spk.samples.length })}
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {spk.gender && (
                          <Chip
                            label={spk.gender}
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
            </>
          )}

          {/* Preview Results */}
          {preview && (
            <Paper elevation={2} sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('textUpload.previewCount', { count: preview.segmentCount })}
              </Typography>
              <Divider sx={{ my: 1 }} />
              <List sx={{ maxHeight: 200, overflow: 'auto' }}>
                {(preview.preview || preview.segments).slice(0, 5).map((seg, idx: number) => (
                  <ListItem key={idx} dense>
                    <ListItemText
                      primary={t('textUpload.segmentNumber', { number: seg.orderIndex + 1 })}
                      secondary={seg.text.substring(0, 100) + (seg.text.length > 100 ? '...' : '')}
                    />
                  </ListItem>
                ))}
                {(preview.preview || preview.segments).length > 5 && (
                  <ListItem dense>
                    <ListItemText
                      secondary={t('textUpload.andMore', { count: (preview.preview || preview.segments).length - 5 })}
                    />
                  </ListItem>
                )}
              </List>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handlePreview}
          disabled={!text.trim() || uploading || speakersLoading || availableSpeakers.length === 0}
        >
          {uploading ? t('textUpload.processing') : t('textUpload.preview')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!text.trim() || uploading || speakersLoading || availableSpeakers.length === 0}
        >
          {uploading ? t('textUpload.creating') : t('textUpload.createSegments')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
