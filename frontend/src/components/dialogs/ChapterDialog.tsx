import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';

interface ChapterDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { title: string; orderIndex: number }) => Promise<void>;
  initialData?: { title: string; orderIndex: number };
  mode: 'create' | 'edit';
  nextOrderIndex?: number;
}

export const ChapterDialog: React.FC<ChapterDialogProps> = ({
  open,
  onClose,
  onSave,
  initialData,
  mode,
  nextOrderIndex = 0,
}) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [orderIndex, setOrderIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Only initialize when dialog opens (not when initialData changes from cache updates)
    if (open && !initialized) {
      setTitle(initialData?.title || '');
      setOrderIndex(initialData?.orderIndex ?? nextOrderIndex);
      setInitialized(true);
    }
    // Reset initialization flag when dialog closes
    if (!open && initialized) {
      setInitialized(false);
    }
  }, [open, initialData, nextOrderIndex, initialized]);

  const handleSave = async () => {
    if (!title.trim()) return;

    try {
      setSaving(true);
      await onSave({ title, orderIndex });
      onClose();
    } catch (err) {
      logger.error('[ChapterDialog] Failed to save chapter:', err);
      alert(t('chapters.messages.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'create' ? t('chapters.create') : t('chapters.edit')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('chapters.chapterTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label={t('chapters.orderIndex')}
            type="number"
            value={orderIndex}
            onChange={(e) => setOrderIndex(parseInt(e.target.value) || 0)}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!title.trim() || saving}
        >
          {saving ? t('common.saving') : mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
