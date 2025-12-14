import React, { useState, useMemo } from 'react'
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  LinearProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
} from '@mui/material'
import { Upload as UploadIcon, PlayArrow as PlayIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useFullBookWizard, type FullBookWizardOptions } from '@hooks/useFullBookWizard'
import { defaultMappingRules } from '@types' // adjust import to where you define defaults

export function FullBookWizardView() {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState('en')
  const [outputFormat, setOutputFormat] =
    useState<FullBookWizardOptions['exportFormat']>('mp3')
  const [outputQuality, setOutputQuality] =
    useState<FullBookWizardOptions['exportQuality']>('high')

  // For now: force "new" projects, you can extend later
  const mode: FullBookWizardOptions['mode'] = 'new'

  const {
    step,
    progressText,
    error,
    result,
    startWizard,
    isRunning,
    reset,
  } = useFullBookWizard()

  const canStart = useMemo(() => {
    return !!file && !isRunning
  }, [file, isRunning])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (selected) {
      setFile(selected)
    }
  }

  const handleStart = async () => {
    if (!file) {
      return
    }

    const options: FullBookWizardOptions = {
      mappingRules: defaultMappingRules, // use your existing defaults
      language,
      mode,
      mergeTargetId: null,
      selectedChapters: [], // all chapters
      renamedChapters: {},
      ttsSettings: {
        ttsEngine: 'local',        // or pull defaults from settings
        ttsModelName: 'default',   // adjust to real default
        language,
      },
      exportFormat: outputFormat,
      exportQuality: outputQuality,
    }

    try {
      await startWizard(file, options)
    } catch {
      // error state is already handled in hook
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        {t('wizard.fullBook.title', 'Book → Audiobook Wizard')}
      </Typography>

      <Typography variant="body1" color="text.secondary" gutterBottom>
        {t(
          'wizard.fullBook.description',
          'Upload a structured Markdown or EPUB, pick your settings, and let the wizard import, generate TTS, and start exports for all chapters.'
        )}
      </Typography>

      <Paper sx={{ p: 3, mt: 2 }}>
        <Stack spacing={3}>
          {/* File upload */}
          <Box>
            <Button
              variant="outlined"
              component="label"
              startIcon={<UploadIcon />}
            >
              {file
                ? t('wizard.fullBook.changeFile', 'Change file')
                : t('wizard.fullBook.selectFile', 'Select book file')}
              <input
                type="file"
                hidden
                accept=".md,.markdown,.epub"
                onChange={handleFileChange}
              />
            </Button>
            {file && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t('wizard.fullBook.selectedFile', 'Selected file')}: {file.name}
              </Typography>
            )}
          </Box>

          {/* Basic settings */}
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('wizard.fullBook.language', 'Language')}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              size="small"
            />

            <FormControl size="small">
              <InputLabel id="wizard-output-format-label">
                {t('wizard.fullBook.outputFormat', 'Output format')}
              </InputLabel>
              <Select
                labelId="wizard-output-format-label"
                label={t('wizard.fullBook.outputFormat', 'Output format')}
                value={outputFormat}
                onChange={(e) =>
                  setOutputFormat(e.target.value as FullBookWizardOptions['exportFormat'])
                }
              >
                <MenuItem value="mp3">MP3</MenuItem>
                <MenuItem value="m4a">M4A</MenuItem>
                <MenuItem value="wav">WAV</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small">
              <InputLabel id="wizard-output-quality-label">
                {t('wizard.fullBook.outputQuality', 'Quality')}
              </InputLabel>
              <Select
                labelId="wizard-output-quality-label"
                label={t('wizard.fullBook.outputQuality', 'Quality')}
                value={outputQuality}
                onChange={(e) =>
                  setOutputQuality(
                    e.target.value as FullBookWizardOptions['exportQuality']
                  )
                }
              >
                <MenuItem value="low">{t('wizard.quality.low', 'Low')}</MenuItem>
                <MenuItem value="medium">
                  {t('wizard.quality.medium', 'Medium')}
                </MenuItem>
                <MenuItem value="high">
                  {t('wizard.quality.high', 'High')}
                </MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {/* Start button */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="contained"
              startIcon={<PlayIcon />}
              onClick={handleStart}
              disabled={!canStart}
            >
              {t('wizard.fullBook.start', 'Start full book wizard')}
            </Button>

            {isRunning && (
              <Typography variant="body2" color="text.secondary">
                {t('wizard.fullBook.running', 'Wizard is running...')}
              </Typography>
            )}

            {step === 'done' && result && (
              <Typography variant="body2" color="success.main">
                {t(
                  'wizard.fullBook.done',
                  'Done. TTS and export jobs were started for {{count}} chapters.',
                  { count: result.chapterIds.length }
                )}
              </Typography>
            )}

            {step === 'error' && error && (
              <Typography variant="body2" color="error">
                {t('wizard.fullBook.error', 'Wizard failed')}: {error}
              </Typography>
            )}
          </Stack>

          {/* Progress bar and text */}
          {isRunning && (
            <Box>
              <LinearProgress />
              <Typography variant="body2" sx={{ mt: 1 }}>
                {progressText}
              </Typography>
            </Box>
          )}

          {/* Debug summary */}
          {result && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1">
                {t('wizard.fullBook.summary', 'Summary')}
              </Typography>
              <Typography variant="body2">
                Project: {result.projectId}
              </Typography>
              <Typography variant="body2">
                Chapters: {result.chapterIds.length}
              </Typography>
              <Typography variant="body2">
                Export jobs: {result.exportJobs.length}
              </Typography>
            </Box>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}

export default FullBookWizardView
