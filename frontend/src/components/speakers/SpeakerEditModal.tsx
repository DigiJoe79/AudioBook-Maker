/**
 * SpeakerEditModal - Full-Screen Modal for Creating/Editing Speakers
 *
 * Features:
 * - Create or Edit mode
 * - Sample upload with preview
 * - Form validation
 * - Loading states
 * - Better UX than inline form
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  IconButton,
  Box,
  Typography,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormHelperText,
  Tooltip,
  Alert,
} from '@mui/material'
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon,
  Save as SaveIcon,
  RecordVoiceOver as SpeakersIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { Speaker, SpeakerSample } from '@types'
import SampleListItem from './SampleListItem'
import SampleUploadZone from './SampleUploadZone'
import SampleUploadProgress, { type UploadItem } from './SampleUploadProgress'

interface SpeakerEditModalProps {
  open: boolean
  speaker?: Speaker | null  // null = create mode
  onClose: () => void
  onSave: (data: SpeakerFormData, samplesToUpload: File[]) => Promise<void>
  onDeleteSample?: (sampleId: string) => Promise<void>
  isSaving?: boolean
}

export interface SpeakerFormData {
  name: string
  description: string
  gender: 'male' | 'female' | 'neutral' | ''
  tags: string[]
}

interface SampleToUpload {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

export default function SpeakerEditModal({
  open,
  speaker,
  onClose,
  onSave,
  onDeleteSample,
  isSaving = false,
}: SpeakerEditModalProps) {
  const { t } = useTranslation()
  const isEditMode = !!speaker

  const [formData, setFormData] = useState<SpeakerFormData>({
    name: '',
    description: '',
    gender: '',
    tags: [],
  })

  const [samplesToUpload, setSamplesToUpload] = useState<SampleToUpload[]>([])
  const [currentSamples, setCurrentSamples] = useState<SpeakerSample[]>([])
  const [isUploading, setIsUploading] = useState(false)

  // Initialize form when speaker changes
  useEffect(() => {
    if (speaker) {
      setFormData({
        name: speaker.name,
        description: speaker.description || '',
        gender: speaker.gender || '',
        tags: speaker.tags || [],
      })
      setCurrentSamples(speaker.samples || [])
    } else {
      setFormData({
        name: '',
        description: '',
        gender: '',
        tags: [],
      })
      setCurrentSamples([])
    }
    setSamplesToUpload([])
  }, [speaker, open])

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) return

    const files = samplesToUpload.map(s => s.file)
    await onSave(formData, files)
  }, [formData, samplesToUpload, onSave])

  const handleFilesAdded = useCallback((files: File[]) => {
    const newSamples: SampleToUpload[] = files.map((file) => ({
      file,
      id: `temp-${Date.now()}-${Math.random()}`,
      status: 'pending',
      progress: 0,
    }))

    setSamplesToUpload((prev) => [...prev, ...newSamples])
  }, [])

  const handleRemoveSample = useCallback((sampleId: string) => {
    setSamplesToUpload((prev) => prev.filter((s) => s.id !== sampleId))
  }, [])

  const handleRenameSample = useCallback((sampleId: string, newName: string) => {
    // For now, this is only for existing samples
    // Backend API would need to support renaming
  }, [])

  const handleDeleteExistingSample = useCallback(async (sampleId: string) => {
    if (!onDeleteSample) return
    await onDeleteSample(sampleId)
    setCurrentSamples((prev) => prev.filter((s) => s.id !== sampleId))
  }, [onDeleteSample])

  const totalSampleCount = useMemo(
    () => currentSamples.length + samplesToUpload.length,
    [currentSamples.length, samplesToUpload.length]
  )

  const hasMinSamples = useMemo(
    () => totalSampleCount > 0,
    [totalSampleCount]
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="speaker-edit-modal"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          minHeight: 500,
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box display="flex" alignItems="center" gap={1.5}>
            <SpeakersIcon />
            <Typography variant="h5" fontWeight="bold">
              {isEditMode ? t('speakers.edit') : t('speakers.add')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: 'background.default', pt: 3 }}>
        <Stack spacing={3}>
          {/* Required Section */}
          <Box>
            <Typography variant="subtitle2" color="primary" gutterBottom fontWeight="bold">
              {t('speakers.form.requiredInfo')}
            </Typography>

            <TextField
              data-testid="speaker-name-input"
              label={`${t('speakers.name')} *`}
              placeholder={t('speakers.form.namePlaceholder')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
              autoFocus
              size="small"
              helperText={t('speakers.form.nameHelper')}
              sx={{ mt: 1 }}
            />
          </Box>

          {/* Optional Section */}
          <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography component="span" variant="body2" color="text.secondary">
                {t('speakers.form.optionalDetails')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <TextField
                  data-testid="speaker-description-input"
                  label={t('speakers.description')}
                  placeholder={t('speakers.form.descriptionPlaceholder')}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  helperText={t('speakers.form.descriptionHelper')}
                />

                <FormControl fullWidth size="small">
                  <InputLabel>{t('speakers.gender')}</InputLabel>
                  <Select
                    data-testid="speaker-gender-select"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'male' | 'female' | 'neutral' | '' })}
                    label={t('speakers.gender')}
                  >
                    <MenuItem value="">{t('speakers.genderNotSpecified')}</MenuItem>
                    <MenuItem value="male">{t('speakers.genderMale')}</MenuItem>
                    <MenuItem value="female">{t('speakers.genderFemale')}</MenuItem>
                    <MenuItem value="neutral">{t('speakers.genderNeutral')}</MenuItem>
                  </Select>
                  <FormHelperText>
                    {t('speakers.form.genderHelper')}
                  </FormHelperText>
                </FormControl>
              </Stack>
            </AccordionDetails>
          </Accordion>

          {/* Audio Samples Section */}
          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <Typography variant="subtitle2" color="primary" fontWeight="bold">
                {t('speakers.audioSamples')} *
              </Typography>
              <Tooltip title={t('speakers.form.samplesTooltip')}>
                <IconButton size="small">
                  <InfoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Drag & Drop Upload Zone */}
            <SampleUploadZone
              onFilesAdded={handleFilesAdded}
              disabled={isSaving}
              maxFiles={10}
              maxSizeBytes={50 * 1024 * 1024}
              acceptedFormats={['.wav', '.mp3', '.m4a', '.flac']}
            />

            {/* Upload Progress for New Samples */}
            {samplesToUpload.length > 0 && (
              <Box mt={2}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  {t('speakers.newSamples')} ({samplesToUpload.length}):
                </Typography>
                <Stack spacing={1}>
                  {samplesToUpload.map((sample) => (
                    <Box
                      key={sample.id}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      py={1}
                      px={1.5}
                      bgcolor={(theme) => theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.15)' : 'rgba(25, 118, 210, 0.08)'}
                      borderRadius={1}
                      border={1}
                      borderColor="primary.light"
                    >
                      <Box flex={1}>
                        <Typography variant="body2" fontWeight="medium" noWrap>
                          {sample.file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {(sample.file.size / 1024).toFixed(1)} KB
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveSample(sample.id)}
                        title={t('speakers.actions.cancel')}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}

            {/* Existing samples with inline preview */}
            {isEditMode && currentSamples.length > 0 && (
              <Box mt={2}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  {t('speakers.existingSamples')} ({currentSamples.length}):
                </Typography>
                <Stack spacing={1}>
                  {currentSamples.map((sample) => (
                    <SampleListItem
                      key={sample.id}
                      sample={sample}
                      speakerId={speaker?.id || ''}
                      onDelete={handleDeleteExistingSample}
                      onRename={handleRenameSample}
                      disabled={isSaving}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* Warning if no samples */}
            {!hasMinSamples && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {t('speakers.messages.minOneSample')}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button data-testid="speaker-cancel-button" onClick={onClose} size="large">
          {t('speakers.actions.cancel')}
        </Button>
        <Button
          data-testid="speaker-save-button"
          loading={isSaving}
          loadingPosition="start"
          startIcon={<SaveIcon />}
          variant="contained"
          size="large"
          onClick={handleSave}
          disabled={!formData.name.trim() || (!isEditMode && !hasMinSamples) || (isEditMode && currentSamples.length === 0 && samplesToUpload.length === 0)}
        >
          {isSaving ? t('speakers.form.saving') : t('speakers.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
