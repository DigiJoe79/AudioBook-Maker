import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { MenuBook as ProjectIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { logger } from '@utils/logger';
import { useError } from '@hooks/useError';

interface ProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string }) => Promise<void>;
  initialData?: { title: string; description: string };
  mode: 'create' | 'edit';
}

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  open,
  onClose,
  onSave,
  initialData,
  mode,
}) => {
  const { t } = useTranslation();
  const { showError, ErrorDialog } = useError();

  // State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Only initialize when dialog opens (not when initialData changes from cache updates)
    if (open && !initialized) {
      // Reset state when dialog opens
      setTitle(initialData?.title || '');
      setDescription(initialData?.description || '');
      setInitialized(true);
    }
    // Reset initialization flag when dialog closes
    if (!open && initialized) {
      setInitialized(false);
    }
  }, [open, initialData, initialized]);

  const handleSave = async () => {
    if (!title.trim()) return;

    setSaving(true);
    logger.group(
      '📝 Project Save',
      'Saving project',
      {
        'Title': title,
        'Description': description || '(none)',
        'Mode': mode
      },
      '#2196F3'
    );

    try {
      await onSave({ title, description });
      onClose();
    } catch (err) {
      logger.error('[ProjectDialog] Failed to save project:', err);
      await showError(
        mode === 'create' ? t('projects.createTitle') : t('projects.edit'),
        t('projects.messages.error')
      );
    } finally {
      setSaving(false);
    }
  };

  const canSave = title.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="project-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <ProjectIcon />
          <Typography variant="h6">
            {mode === 'create' ? t('projects.createTitle') : t('projects.edit')}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Stack spacing={2}>
          <TextField
            label={t('projects.projectTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            autoFocus
            data-testid="project-title-input"
          />
          <TextField
            label={t('common.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
            data-testid="project-description-input"
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={onClose} disabled={saving} data-testid="project-cancel-button">
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave || saving}
          startIcon={saving && <CircularProgress size={16} />}
          data-testid="project-save-button"
        >
          {saving
            ? t('common.saving')
            : mode === 'create'
            ? t('common.create')
            : t('common.save')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  );
};
