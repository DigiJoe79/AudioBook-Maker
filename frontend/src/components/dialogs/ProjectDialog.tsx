import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Tabs,
  Tab,
  Box,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
} from '@mui/material';
import { Upload, Description } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { projectApi } from '../../services/api';

interface ProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string }) => Promise<void>;
  onImportSuccess?: (project: any) => void;
  initialData?: { title: string; description: string };
  mode: 'create' | 'edit';
}

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  open,
  onClose,
  onSave,
  onImportSuccess,
  initialData,
  mode,
}) => {
  const { t } = useTranslation();

  const [tabIndex, setTabIndex] = useState(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const currentEngine = useAppStore((state) => state.getCurrentEngine());
  const currentModelName = useAppStore((state) => state.getCurrentModelName());
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage());
  const currentSpeaker = useAppStore((state) => state.getCurrentSpeaker());

  const [engine, setEngine] = useState(currentEngine);
  const [modelName, setModelName] = useState(currentModelName);
  const [language, setLanguage] = useState(currentLanguage);
  const [speakerName, setSpeakerName] = useState(currentSpeaker || '');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialData?.title || '');
      setDescription(initialData?.description || '');
      setTabIndex(0);
      setImportFile(null);
      setError(null);

      setEngine(currentEngine);
      setModelName(currentModelName);
      setLanguage(currentLanguage);
      setSpeakerName(currentSpeaker || '');
    }
  }, [open, initialData, currentEngine, currentModelName, currentLanguage, currentSpeaker]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError(t('projects.import.fileTooLarge'));
        return;
      }

      if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
        setError(t('projects.import.invalidFileType'));
        return;
      }

      setImportFile(file);
      setError(null);
    }
  };

  const handleSave = async () => {
    if (tabIndex === 0) {
      if (!title.trim()) return;

      try {
        setSaving(true);
        await onSave({ title, description });
        onClose();
      } catch (err) {
        console.error('Failed to save project:', err);
        setError(t('projects.messages.error'));
      } finally {
        setSaving(false);
      }
    } else {
      if (!importFile) {
        setError(t('projects.import.noFileSelected'));
        return;
      }

      try {
        setImporting(true);
        setError(null);

        const result = await projectApi.importFromMarkdown(importFile, {
          engine,
          modelName,
          language,
          speakerName: speakerName || undefined,
        });

        if (onImportSuccess) {
          onImportSuccess(result.project);
        }

        onClose();
      } catch (err: any) {
        console.error('Import failed:', err);
        setError(err.message || t('projects.import.failed'));
      } finally {
        setImporting(false);
      }
    }
  };

  const isLoading = saving || importing;
  const canSave = tabIndex === 0 ? title.trim() : !!importFile;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'create' ? t('projects.createTitle') : t('projects.edit')}
      </DialogTitle>

      <DialogContent>
        {mode === 'create' && (
          <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
            <Tab label={t('projects.create.manual')} />
            <Tab label={t('projects.create.importMarkdown')} />
          </Tabs>
        )}

        <Box>
          {(mode === 'edit' || tabIndex === 0) && (
            <Stack spacing={2} sx={{ mt: mode === 'create' ? 0 : 1 }}>
              <TextField
                label={t('projects.projectTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                required
                autoFocus
              />
              <TextField
                label={t('common.description')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                rows={3}
              />
            </Stack>
          )}

          {mode === 'create' && tabIndex === 1 && (
            <Stack spacing={2}>
              <Button
                component="label"
                variant="outlined"
                startIcon={importFile ? <Description /> : <Upload />}
                fullWidth
                sx={{ justifyContent: 'flex-start', py: 1.5 }}
              >
                {importFile ? importFile.name : t('projects.import.selectFile')}
                <input
                  type="file"
                  accept=".md,.markdown"
                  hidden
                  onChange={handleFileSelect}
                />
              </Button>

              <FormHelperText>
                {t('projects.import.helpText')}
              </FormHelperText>

              <Alert severity="info">
                <Typography variant="body2" fontWeight="bold">
                  {t('projects.import.format.title')}
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                  • <code>#</code> {t('projects.import.format.projectTitle')}<br />
                  • <code>##</code> {t('projects.import.format.ignored')}<br />
                  • <code>###</code> {t('projects.import.format.chapter')}<br />
                  • <code>***</code> {t('projects.import.format.divider')}
                </Typography>
              </Alert>

              {importFile && (
                <>
                  <Typography variant="subtitle2" sx={{ mt: 2 }}>
                    {t('projects.create.ttsSettings')}
                  </Typography>

                  <FormControl fullWidth>
                    <InputLabel>{t('tts.engine')}</InputLabel>
                    <Select value={engine} onChange={(e) => setEngine(e.target.value)}>
                      <MenuItem value="dummy">Dummy</MenuItem>
                      <MenuItem value="xtts">XTTS</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>{t('tts.model')}</InputLabel>
                    <Select value={modelName} onChange={(e) => setModelName(e.target.value)}>
                      <MenuItem value="dummy">Dummy</MenuItem>
                      <MenuItem value="v2.0.2">v2.0.2</MenuItem>
                      <MenuItem value="v2.0.3">v2.0.3</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>{t('tts.language')}</InputLabel>
                    <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <MenuItem value="de">Deutsch</MenuItem>
                      <MenuItem value="en">English</MenuItem>
                    </Select>
                  </FormControl>

                  <TextField
                    label={t('tts.speaker')}
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    fullWidth
                    placeholder={t('tts.speakerOptional')}
                    helperText={t('tts.speakerOptional')}
                  />
                </>
              )}
            </Stack>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave || isLoading}
          startIcon={isLoading && <CircularProgress size={16} />}
        >
          {isLoading
            ? importing
              ? t('projects.import.importing')
              : t('common.saving')
            : mode === 'create'
            ? t('common.create')
            : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
