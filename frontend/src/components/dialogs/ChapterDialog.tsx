import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Box,
  Typography,
} from '@mui/material';
import { Description as ChapterIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useError } from '@hooks/useError';
import { logger } from '@utils/logger';

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
  const { showError, ErrorDialog } = useError();
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
      await showError(
        mode === 'create' ? t('chapters.create') : t('chapters.edit'),
        t('chapters.messages.error')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="chapter-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <ChapterIcon />
          <Typography variant="h6">
            {mode === 'create' ? t('chapters.create') : t('chapters.edit')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Stack spacing={2}>
          <TextField
            label={t('chapters.chapterTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            autoFocus
            data-testid="chapter-title-input"
          />
          <TextField
            label={t('chapters.orderIndex')}
            type="number"
            value={orderIndex}
            onChange={(e) => setOrderIndex(parseInt(e.target.value) || 0)}
            fullWidth
            data-testid="chapter-order-input"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={onClose} disabled={saving} data-testid="chapter-cancel-button">
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!title.trim() || saving}
          data-testid="chapter-save-button"
        >
          {saving ? t('common.saving') : mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  );
};
