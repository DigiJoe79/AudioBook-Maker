
import React, { useState } from 'react';
import {
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Box,
  Typography,
  Divider,
  Button,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSpeakers,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
  uploadSpeakerSample,
  deleteSpeakerSample,
  setDefaultSpeaker
} from '../../services/settingsApi';
import { useConfirm } from '../../hooks/useConfirm';
import type { Speaker, SpeakerSample } from '../../types';

interface SpeakerFormData {
  name: string;
  description: string;
  gender: 'male' | 'female' | 'neutral' | '';
  tags: string[];
}

interface SampleToUpload {
  file: File;
  id: string;
}

export default function SpeakerManagerContent() {
  const { t } = useTranslation();
  const { confirm, ConfirmDialog } = useConfirm();
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedSpeakers, setExpandedSpeakers] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState<SpeakerFormData>({
    name: '',
    description: '',
    gender: '',
    tags: []
  });
  const [samplesToUpload, setSamplesToUpload] = useState<SampleToUpload[]>([]);
  const [currentSpeakerSamples, setCurrentSpeakerSamples] = useState<SpeakerSample[]>([]);

  const { data: speakers, isLoading, error } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers
  });

  const createMutation = useMutation({
    mutationFn: createSpeaker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
      setIsCreating(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Speaker> }) =>
      updateSpeaker(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
      setEditingId(null);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSpeaker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
    }
  });

  const uploadSampleMutation = useMutation({
    mutationFn: ({
      speakerId,
      file,
      transcript
    }: {
      speakerId: string;
      file: File;
      transcript?: string;
    }) => uploadSpeakerSample(speakerId, file, transcript),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
    }
  });

  const deleteSampleMutation = useMutation({
    mutationFn: ({ speakerId, sampleId }: { speakerId: string; sampleId: string }) =>
      deleteSpeakerSample(speakerId, sampleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
    }
  });

  const setDefaultMutation = useMutation({
    mutationFn: (speakerId: string) => setDefaultSpeaker(speakerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    }
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      gender: '',
      tags: []
    });
    setSamplesToUpload([]);
    setCurrentSpeakerSamples([]);
  };

  const handleCreate = () => {
    setIsCreating(true);
    resetForm();
  };

  const handleEdit = (speaker: Speaker) => {
    setEditingId(speaker.id);
    setFormData({
      name: speaker.name,
      description: speaker.description || '',
      gender: speaker.gender || '',
      tags: speaker.tags
    });
    setCurrentSpeakerSamples(speaker.samples);
    setSamplesToUpload([]);
  };

  const handleSave = async () => {
    if (!formData.name) return;

    const data = {
      name: formData.name,
      description: formData.description || undefined,
      gender: formData.gender || undefined,
      tags: formData.tags
    };

    try {
      let speakerId: string;

      if (isCreating) {
        const speakerData: Omit<Speaker, 'id' | 'isActive' | 'isDefault' | 'createdAt' | 'updatedAt' | 'samples'> = {
          name: data.name,
          description: data.description,
          gender: data.gender,
          languages: [],
          tags: data.tags,
        };
        const newSpeaker = await createMutation.mutateAsync(speakerData);
        speakerId = newSpeaker.id;
      } else if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data });
        speakerId = editingId;
      } else {
        return;
      }

      for (const sampleToUpload of samplesToUpload) {
        await uploadSampleMutation.mutateAsync({
          speakerId,
          file: sampleToUpload.file
        });
      }

      setIsCreating(false);
      setEditingId(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['speakers'] });
    } catch (error) {
      console.error('Error saving speaker:', error);
    }
  };

  const handleDelete = async (speaker: Speaker) => {
    const confirmed = await confirm(
      t('speakers.delete'),
      t('speakers.messages.deleteConfirm')
    );

    if (confirmed) {
      await deleteMutation.mutateAsync(speaker.id);
    }
  };

  const handleAddSamplesToDialog = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,.mp3';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      const newSamples: SampleToUpload[] = Array.from(files).map((file) => ({
        file,
        id: `temp-${Date.now()}-${Math.random()}`
      }));

      setSamplesToUpload((prev) => [...prev, ...newSamples]);
    };
    input.click();
  };

  const handleRemoveSampleFromDialog = (sampleId: string) => {
    setSamplesToUpload((prev) => prev.filter((s) => s.id !== sampleId));
  };

  const handleDeleteExistingSample = async (sampleId: string) => {
    if (!editingId) return;

    const confirmed = await confirm(
      t('speakers.deleteSample'),
      t('speakers.messages.deleteSampleConfirm')
    );

    if (confirmed) {
      await deleteSampleMutation.mutateAsync({ speakerId: editingId, sampleId });
      setCurrentSpeakerSamples((prev) => prev.filter((s) => s.id !== sampleId));
    }
  };

  const handleSetDefault = async (speakerId: string) => {
    await setDefaultMutation.mutateAsync(speakerId);
  };

  const toggleSpeakerExpanded = (speakerId: string) => {
    setExpandedSpeakers((prev) => {
      const next = new Set(prev);
      if (next.has(speakerId)) {
        next.delete(speakerId);
      } else {
        next.add(speakerId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{t('speakers.messages.error')}</Alert>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">{t('speakers.list')}</Typography>
        <Button
          startIcon={<AddIcon />}
          onClick={handleCreate}
          variant="contained"
          size="small"
        >
          {t('speakers.add')}
        </Button>
      </Box>

      {(isCreating || editingId) && (
        <Box mb={2} p={2} border={1} borderColor="divider" borderRadius={1}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="subtitle1">
              {isCreating ? t('speakers.add') : t('speakers.edit')}
            </Typography>
            <IconButton
              size="small"
              onClick={() => {
                setIsCreating(false);
                setEditingId(null);
                resetForm();
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('speakers.name')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
              size="small"
            />

            <TextField
              label={t('speakers.description')}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
              size="small"
            />

            <FormControl fullWidth size="small">
              <InputLabel>{t('speakers.gender')}</InputLabel>
              <Select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'male' | 'female' | 'neutral' | '' })}
                label={t('speakers.gender')}
              >
                <MenuItem value="">{t('speakers.genderNeutral')}</MenuItem>
                <MenuItem value="male">{t('speakers.genderMale')}</MenuItem>
                <MenuItem value="female">{t('speakers.genderFemale')}</MenuItem>
                <MenuItem value="neutral">{t('speakers.genderNeutral')}</MenuItem>
              </Select>
            </FormControl>

            <Box mt={2}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="subtitle2">{t('speakers.audioSamples')}</Typography>
                <Button
                  startIcon={<UploadIcon />}
                  onClick={handleAddSamplesToDialog}
                  size="small"
                  variant="outlined"
                >
                  {t('speakers.uploadSample')}
                </Button>
              </Box>

              {editingId && currentSpeakerSamples.length > 0 && (
                <Box mb={1}>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    {t('speakers.existingSamples')}:
                  </Typography>
                  {currentSpeakerSamples.map((sample) => (
                    <Box
                      key={sample.id}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      py={0.5}
                      px={1}
                      bgcolor="background.default"
                      borderRadius={1}
                      mb={0.5}
                    >
                      <Typography variant="body2">
                        {sample.fileName}
                        {sample.duration && ` (${sample.duration.toFixed(1)}s)`}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteExistingSample(sample.id)}
                        title={t('speakers.deleteSample')}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              {samplesToUpload.length > 0 && (
                <Box mb={1}>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    {t('speakers.newSamples')}:
                  </Typography>
                  {samplesToUpload.map((sample) => (
                    <Box
                      key={sample.id}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      py={0.5}
                      px={1}
                      bgcolor="primary.50"
                      borderRadius={1}
                      mb={0.5}
                    >
                      <Typography variant="body2">
                        {sample.file.name} ({(sample.file.size / 1024).toFixed(1)} KB)
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveSampleFromDialog(sample.id)}
                        title={t('speakers.actions.cancel')}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              {(isCreating || editingId) && currentSpeakerSamples.length === 0 && samplesToUpload.length === 0 && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {t('speakers.messages.minOneSample')}
                </Alert>
              )}
            </Box>

            <Box display="flex" gap={1} mt={2}>
              <Button
                onClick={handleSave}
                variant="contained"
                size="small"
                disabled={
                  !formData.name ||
                  (isCreating && samplesToUpload.length === 0) ||
                  (editingId && currentSpeakerSamples.length === 0 && samplesToUpload.length === 0) ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
              >
                {t('speakers.actions.save')}
              </Button>
              <Button
                onClick={() => {
                  setIsCreating(false);
                  setEditingId(null);
                  resetForm();
                }}
                size="small"
              >
                {t('speakers.actions.cancel')}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      <List sx={{ maxHeight: 400, overflow: 'auto' }}>
        {speakers?.map((speaker) => (
          <React.Fragment key={speaker.id}>
            <ListItem>
              {speaker.samples.length > 0 && (
                <IconButton
                  size="small"
                  onClick={() => toggleSpeakerExpanded(speaker.id)}
                  sx={{ mr: 1 }}
                >
                  {expandedSpeakers.has(speaker.id) ? (
                    <ExpandMoreIcon fontSize="small" />
                  ) : (
                    <ChevronRightIcon fontSize="small" />
                  )}
                </IconButton>
              )}

              <ListItemText
                primary={
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography
                      variant="body1"
                      sx={{ opacity: speaker.isActive ? 1 : 0.5 }}
                    >
                      {speaker.name}
                    </Typography>
                    {!speaker.isActive && (
                      <Chip
                        label={t('speakers.inactive')}
                        size="small"
                        color="warning"
                        variant="outlined"
                      />
                    )}
                    {speaker.gender && (
                      <Chip
                        label={t(`speakers.gender${speaker.gender.charAt(0).toUpperCase() + speaker.gender.slice(1) as 'Male' | 'Female' | 'Neutral'}`)}
                        size="small"
                      />
                    )}
                    <Chip label={`${speaker.samples.length} ${t('speakers.samples')}`} size="small" />
                  </Box>
                }
                secondary={speaker.description}
                sx={{ ml: speaker.samples.length === 0 ? 5 : 0 }}
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  onClick={() => handleSetDefault(speaker.id)}
                  title={speaker.isDefault ? t('speakers.defaultSpeaker') : t('speakers.setAsDefault')}
                  size="small"
                  disabled={!speaker.isActive}
                >
                  {speaker.isDefault ? (
                    <StarIcon color="primary" fontSize="small" />
                  ) : (
                    <StarBorderIcon fontSize="small" />
                  )}
                </IconButton>
                <IconButton
                  edge="end"
                  onClick={() => handleEdit(speaker)}
                  title={t('speakers.edit')}
                  size="small"
                >
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton
                  edge="end"
                  onClick={() => handleDelete(speaker)}
                  title={t('speakers.delete')}
                  size="small"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>

            {speaker.samples.length > 0 && expandedSpeakers.has(speaker.id) && (
              <Box pl={4} pb={1}>
                {speaker.samples.map((sample) => (
                  <Box
                    key={sample.id}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    py={0.5}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {sample.fileName}
                      {sample.duration && ` (${sample.duration.toFixed(1)}s)`}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Divider />
          </React.Fragment>
        ))}

        {(!speakers || speakers.length === 0) && !isCreating && (
          <ListItem>
            <ListItemText
              primary={t('speakers.noSamples')}
              secondary={t('speakers.add')}
            />
          </ListItem>
        )}
      </List>

      <ConfirmDialog />
    </Box>
  );
}
