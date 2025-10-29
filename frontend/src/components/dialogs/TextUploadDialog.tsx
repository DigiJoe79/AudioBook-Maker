import React, { useState } from 'react';
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
} from '@mui/material';
import { Upload } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import type { Segment } from '../../types';

interface SegmentationPreview {
  success: boolean;
  message: string;
  segments: Segment[];
  preview?: Array<{ text: string; orderIndex: number }>;
  segmentCount: number;
  engine: string;
  constraints: Record<string, number>;
}

interface TextUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (data: {
    text: string;
    method: 'sentences' | 'paragraphs' | 'smart' | 'length';
    language: string;
    autoCreate: boolean;
  }) => Promise<SegmentationPreview | undefined>;
}

export const TextUploadDialog: React.FC<TextUploadDialogProps> = ({
  open,
  onClose,
  onUpload,
}) => {
  const { t } = useTranslation();

  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());

  const [text, setText] = useState('');
  const [method, setMethod] = useState<'sentences' | 'paragraphs' | 'smart' | 'length'>('smart');
  const [language, setLanguage] = useState(currentLanguage);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<SegmentationPreview | null>(null);

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
      const result = await onUpload({
        text,
        method,
        language,
        autoCreate: false,
      });
      setPreview(result || null);
    } catch (err) {
      console.error('Failed to preview segmentation:', err);
      alert(t('textUpload.messages.failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!text.trim()) return;

    setUploading(true);
    try {
      await onUpload({
        text,
        method,
        language,
        autoCreate: true,
      });
      onClose();
      setText('');
      setPreview(null);
    } catch (err) {
      console.error('Failed to create segments:', err);
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

          <TextField
            label={t('textUpload.textContent')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            fullWidth
            multiline
            rows={8}
            placeholder={t('textUpload.placeholder')}
          />

          <Stack direction="row" spacing={2}>
            <FormControl fullWidth>
              <InputLabel>{t('textUpload.segmentationMethod')}</InputLabel>
              <Select
                value={method}
                label={t('textUpload.segmentationMethod')}
                onChange={(e) => setMethod(e.target.value as 'sentences' | 'paragraphs' | 'smart' | 'length')}
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
              >
                <MenuItem value="de">{t('textUpload.languages.de')}</MenuItem>
                <MenuItem value="en">{t('textUpload.languages.en')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>

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
        <Button onClick={handlePreview} disabled={!text.trim() || uploading}>
          {uploading ? t('textUpload.processing') : t('textUpload.preview')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!text.trim() || uploading}
        >
          {uploading ? t('textUpload.creating') : t('textUpload.createSegments')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
