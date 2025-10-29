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

  useEffect(() => {
    if (open) {
      setTitle(initialData?.title || '');
      setOrderIndex(initialData?.orderIndex ?? nextOrderIndex);
    }
  }, [open, initialData, nextOrderIndex]);

  const handleSave = async () => {
    if (!title.trim()) return;

    try {
      setSaving(true);
      await onSave({ title, orderIndex });
      onClose();
    } catch (err) {
      console.error('Failed to save chapter:', err);
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
