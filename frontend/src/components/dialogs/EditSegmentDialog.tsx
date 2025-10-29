import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
} from '@mui/material';
import { Edit } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { useSegmentLimits } from '../../hooks/useSettings';

interface Segment {
  id: string;
  text: string;
  engine?: string;
  language?: string;
}

interface EditSegmentDialogProps {
  open: boolean;
  segment: Segment | null;
  onClose: () => void;
  onSave: (segmentId: string, newText: string) => Promise<void>;
}

const DEFAULT_MAX_LENGTH = 250;

export const EditSegmentDialog: React.FC<EditSegmentDialogProps> = ({
  open,
  segment,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const currentEngine = useAppStore((state) => state.getCurrentEngine());

  const { data: limits } = useSegmentLimits(currentEngine);

  const maxSegmentLength = limits?.effectiveLimit || DEFAULT_MAX_LENGTH;

  useEffect(() => {
    if (segment) {
      setText(segment.text);
    }
  }, [segment]);

  const handleSave = async () => {
    if (!segment || !text.trim()) return;

    setSaving(true);
    try {
      await onSave(segment.id, text.trim());
      onClose();
    } catch (err) {
      console.error('Failed to update segment:', err);
      alert(t('segments.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (segment) {
      setText(segment.text);
    }
    onClose();
  };

  const isTextValid = text.trim().length > 0 && text.trim().length <= maxSegmentLength;
  const remainingChars = maxSegmentLength - text.length;
  const isOverLimit = text.length > maxSegmentLength;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Edit />
          {t('segments.editText')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('segments.description', { maxLength: maxSegmentLength })}
          </Typography>

          <TextField
            label={t('segments.segmentText')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            fullWidth
            multiline
            rows={6}
            placeholder={t('segments.placeholder')}
            error={!isTextValid}
            helperText={
              isOverLimit
                ? t('segments.textTooLong', { count: -remainingChars })
                : text.trim().length === 0
                ? t('segments.textEmpty')
                : `${text.length}/${maxSegmentLength} ${t('segments.characters')}`
            }
            sx={{ mt: 2 }}
            inputProps={{
              maxLength: maxSegmentLength + 50,
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!isTextValid || saving}
        >
          {saving ? t('common.saving') : t('segments.messages.saveChanges')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
