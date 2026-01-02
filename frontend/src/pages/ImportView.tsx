/**
 * ImportView - Markdown Import View
 *
 * Full-screen markdown import interface with split-view layout:
 * - Left panel: Configuration (file upload, mapping rules)
 * - Right panel: Preview (project info, chapters, warnings, statistics)
 */

import React, { memo, useState, useCallback, useEffect, useMemo } from 'react'
import {
  Box,
  Paper,
  Typography,
  Divider,
  Stack,
  Button,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material'
import {
  Settings as SettingsIcon,
  Upload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  Transform as TransformIcon,
  MergeType as MergeIcon,
  Checklist as ChecklistIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import {
  ViewContainer,
  ViewHeader,
  ViewContent,
  ViewFooter,
} from '../components/layout/ViewComponents'
import FileUploadArea from '../components/import/FileUploadArea'
import MappingRulesEditor from '../components/import/MappingRulesEditor'
import ImportPreviewPanel from '../components/import/ImportPreviewPanel'
import ImportModeSelector from '../components/import/ImportModeSelector'
import ChapterSelectionList from '../components/import/ChapterSelectionList'
import TTSSettingsSelector from '../components/import/TTSSettingsSelector'
import type { MappingRules, ImportPreviewResponse } from '../types/import'
import { DEFAULT_MAPPING_RULES } from '../types/import'
import { usePreviewImport, useExecuteImport } from '../hooks/useImportQuery'
import { useTextEngineLanguages } from '../hooks/useTextEngineLanguages'
import { useAllEnginesStatus } from '../hooks/useEnginesQuery'
import { useUISettingsStore } from '../store/uiSettingsStore'
import { useAppStore } from '../store/appStore'
import { useNavigationStore } from '../store/navigationStore'
import { useSnackbar } from '../hooks/useSnackbar'
import { useDefaultSpeaker } from '../hooks/useSpeakersQuery'
import { translateBackendError } from '../utils/translateBackendError'

const ImportView = memo(() => {
  const { t } = useTranslation()
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const [importError, setImportError] = useState<string | null>(null)

  // Check if import feature is available (requires text processing engine)
  const canUseImport = useAppStore((state) => state.canUseImport())

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mappingRules, setMappingRules] = useState<MappingRules>(DEFAULT_MAPPING_RULES)
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Import mode state
  const [importMode, setImportMode] = useState<'new' | 'merge'>('new')
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)

  // Chapter selection and renaming state (for merge mode)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [renamedChapters, setRenamedChapters] = useState<Map<string, string>>(new Map())

  // Accordion state - only one section expanded at a time
  const [expandedSection, setExpandedSection] = useState<'upload' | 'mapping' | 'mode' | 'chapters' | 'tts' | null>('upload')

  // Get UI language as default for spaCy
  const uiLanguage = useUISettingsStore((state) => state.settings.uiLanguage)

  // Text engine language for text segmentation (independent from TTS language)
  const [textLanguage, setTextLanguage] = useState<string>('')

  // Load available text engine languages from engines status
  const { languages: textLanguages, isLoading: textLanguagesLoading } = useTextEngineLanguages()

  // Initialize text language once languages are loaded
  useEffect(() => {
    if (!textLanguagesLoading && textLanguages && textLanguages.length > 0 && !textLanguage) {
      // Try to use UI language if available, otherwise use first available language
      const uiLangAvailable = textLanguages.some((code) => code === uiLanguage)
      setTextLanguage(uiLangAvailable ? uiLanguage : textLanguages[0])
    }
  }, [textLanguages, textLanguagesLoading, uiLanguage, textLanguage])

  // Get default TTS engine from app store
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine())

  // Get engine info from engines status (Single Source of Truth for default model/language)
  const { data: enginesStatus } = useAllEnginesStatus()
  const engineInfo = enginesStatus?.tts?.find((e) => e.variantId === defaultEngine)

  // Default speaker from speakers table (single source of truth)
  const { data: defaultSpeakerData } = useDefaultSpeaker()

  // TTS settings state (initialized from engine info - Single Source of Truth)
  const [ttsEngine, setTtsEngine] = useState<string>(defaultEngine)
  const [ttsModelName, setTtsModelName] = useState<string>('')
  const [language, setLanguage] = useState<string>('de')
  const [ttsSpeakerName, setTtsSpeakerName] = useState<string>(defaultSpeakerData?.name || '')

  // Update TTS settings when engine info loads (async data)
  useEffect(() => {
    if (engineInfo) {
      if (engineInfo.defaultModelName && !ttsModelName) {
        setTtsModelName(engineInfo.defaultModelName)
      }
      if (engineInfo.defaultLanguage && language === 'de') {
        setLanguage(engineInfo.defaultLanguage)
      }
    }
  }, [engineInfo, ttsModelName, language])

  // Preview and execute mutation hooks
  const previewMutation = usePreviewImport()
  const executeImport = useExecuteImport()

  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file)
    setFileError(null)
  }, [])

  const handleMappingRulesChange = useCallback((rules: MappingRules) => {
    setMappingRules(rules)
  }, [])

  const handleAccordionChange = useCallback((panel: 'upload' | 'mapping' | 'mode' | 'chapters' | 'tts') =>
    (_event: React.SyntheticEvent, isExpanded: boolean) => {
      setExpandedSection(isExpanded ? panel : null)
    }, [])

  const handleSelectionChange = useCallback((selected: Set<string>) => {
    setSelectedChapters(selected)
  }, [])

  const handleRenameChange = useCallback((chapterId: string, newTitle: string) => {
    setRenamedChapters((prev) => {
      const next = new Map(prev)
      next.set(chapterId, newTitle)
      return next
    })
  }, [])

  // Initialize chapter selection when preview data changes (select all by default)
  useEffect(() => {
    if (previewData?.chapters) {
      setSelectedChapters(new Set(previewData.chapters.map((ch) => ch.id)))
      setRenamedChapters(new Map()) // Reset renames when preview changes
    }
  }, [previewData])

  // Debounced preview API call
  useEffect(() => {
    // Clear preview if no file selected
    if (!selectedFile) {
      setPreviewData(null)
      return
    }

    // Debounce mapping rules changes (500ms)
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      setFileError(null)

      try {
        const preview = await previewMutation.mutateAsync({
          file: selectedFile,
          mappingRules,
          language: textLanguage,  // Use text engine language for segmentation
        })
        setPreviewData(preview)
      } catch (err: unknown) {
        const errorMessage = translateBackendError(
          err instanceof Error ? err.message : t('import.preview.error'),
          t
        )
        setFileError(errorMessage)
        setPreviewData(null)
      } finally {
        setPreviewLoading(false)
      }
    }, 500) // 500ms debounce delay

    // Cleanup timer on unmount or dependency change
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, mappingRules, textLanguage])  // Trigger preview when file, rules, or text language changes

  // Import loading state
  const isImporting = executeImport.isPending

  // Import button enabled state (memoized for performance)
  const isImportEnabled = useMemo(
    () =>
      !isImporting &&
      selectedFile !== null &&
      previewData?.isValid === true &&
      (importMode === 'new' || (importMode === 'merge' && mergeTargetId !== null)) &&
      selectedChapters.size > 0 &&
      ttsEngine !== '' &&
      ttsModelName !== '' &&
      language !== '',
    [
      isImporting,
      selectedFile,
      previewData?.isValid,
      importMode,
      mergeTargetId,
      selectedChapters.size,
      ttsEngine,
      ttsModelName,
      language,
    ]
  )

  // Handle import execution
  const handleImport = useCallback(async () => {
    // Clear previous error
    setImportError(null)

    // Validation
    if (!selectedFile) {
      setImportError(t('import.actions.noFileSelected'))
      return
    }

    if (!previewData?.isValid) {
      setImportError(t('import.actions.invalidConfig'))
      return
    }

    if (importMode === 'merge' && !mergeTargetId) {
      setImportError(t('import.actions.noMergeTarget'))
      return
    }

    if (selectedChapters.size === 0) {
      setImportError(t('import.actions.noChaptersSelected'))
      return
    }

    try {
      // Execute import
      const result = await executeImport.mutateAsync({
        file: selectedFile,
        mappingRules,
        language: textLanguage,  // Use text engine language for segmentation
        mode: importMode,
        mergeTargetId,
        selectedChapters: Array.from(selectedChapters),
        renamedChapters: Object.fromEntries(renamedChapters),
        ttsSettings: {
          ttsEngine,
          ttsModelName,
          language,
          ttsSpeakerName: ttsSpeakerName || undefined,
        },
      })

      // Store the imported project ID in sessionStorage for AppLayout to pick up
      sessionStorage.setItem('selectedProjectId', result.project.id)

      // Store success message for MainView to display (since ImportView will unmount)
      const chapterCount = result.project.chapters?.length || 0
      const segmentCount = result.project.chapters?.reduce((sum, ch) => sum + (ch.segments?.length || 0), 0) || 0
      const successMessage = t('import.actions.success', { chapters: chapterCount, segments: segmentCount })
      sessionStorage.setItem('importSuccessMessage', successMessage)

      // Navigate to Main view
      navigateTo('main')

      // Reset import form (will happen after navigation, but good practice)
      setSelectedFile(null)
      setPreviewData(null)
      setFileError(null)
      setSelectedChapters(new Set())
      setRenamedChapters(new Map())
      setMappingRules(DEFAULT_MAPPING_RULES)
      setImportMode('new')
      setMergeTargetId(null)
    } catch (err: unknown) {
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('import.actions.error'),
        t
      )
      setImportError(errorMessage)
    }
  }, [
    selectedFile,
    previewData,
    importMode,
    mergeTargetId,
    selectedChapters,
    mappingRules,
    uiLanguage,
    renamedChapters,
    ttsEngine,
    ttsModelName,
    language,
    ttsSpeakerName,
    executeImport,
    navigateTo,
    t,
  ])

  // Feature-gating: Show warning screen if no text processing engine available
  if (!canUseImport) {
    return (
      <ViewContainer data-testid="import-view">
        <ViewContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 3,
              px: 3,
            }}
          >
            <WarningIcon sx={{ fontSize: 80, color: 'warning.main' }} />
            <Typography variant="h5" textAlign="center">
              {t('import.noTextEngine.title')}
            </Typography>
            <Typography color="text.secondary" textAlign="center" maxWidth={700}>
              {t('import.noTextEngine.message')}
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={() => navigateTo('settings')}
              size="large"
            >
              {t('import.noTextEngine.goToEngines')}
            </Button>
          </Box>
        </ViewContent>
        <SnackbarComponent />
      </ViewContainer>
    )
  }

  return (
    <ViewContainer data-testid="import-view">
      {/* Header */}
      <ViewHeader
        title={t('import.title')}
        actions={
          <Button
            data-testid="import-execute-button"
            variant="contained"
            color="primary"
            size="small"
            disabled={!isImportEnabled}
            onClick={handleImport}
            startIcon={
              executeImport.isPending ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                <UploadIcon />
              )
            }
          >
            {executeImport.isPending
              ? t('import.actions.importing')
              : t('import.actions.import')}
          </Button>
        }
      />

      {/* Split-View Content */}
      <ViewContent
        noPadding
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '400px 1fr' },
          overflow: 'hidden',
          '@media (max-width: 900px)': {
            gridTemplateColumns: '1fr',
            gridTemplateRows: 'auto 1fr',
          },
        }}
      >
        {/* Left Panel - Configuration */}
        <Box
          data-testid="import-config-panel"
          sx={{
            height: '100%',
            borderRight: { xs: 'none', md: '1px solid #3a3a3a' },
            borderBottom: { xs: '1px solid #3a3a3a', md: 'none' },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Scrollable Content */}
          <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              '&::-webkit-scrollbar': {
                width: (theme) => theme.custom.spacing.xs,
              },
              '&::-webkit-scrollbar-track': {
                background: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'divider',
                borderRadius: (theme) => theme.custom.borderRadius.sm,
                '&:hover': {
                  backgroundColor: 'text.disabled',
                },
              },
            }}
          >
            <Box
              sx={{
                p: (theme) => theme.custom.spacing.md,
                '& .MuiAccordion-root + .MuiAccordion-root': {
                  mt: (theme) => theme.custom.spacing.md,
                },
              }}
            >
              {/* Import error alert */}
              {importError && (
                <Alert
                  severity="error"
                  onClose={() => setImportError(null)}
                  sx={{ fontSize: '0.875rem', mb: (theme) => theme.custom.spacing.md }}
                >
                  {importError}
                </Alert>
              )}

                {/* File Upload Accordion */}
                <Accordion
                  data-testid="import-file-upload-section"
                  expanded={expandedSection === 'upload'}
                  onChange={handleAccordionChange('upload')}
                  sx={{
                    bgcolor: 'action.hover',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: (theme) => theme.custom.borderRadius.sm,
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                    margin: 0,
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      minHeight: (theme) => theme.custom.heights.tabs,
                      '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                      '& .MuiAccordionSummary-content': {
                        my: 1,
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <UploadIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          color: 'text.secondary',
                        }}
                      >
                        {t('import.fileUpload.title')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                    <Stack spacing={2}>
                      {/* Text Language Selector - FIRST, before upload */}
                      <FormControl fullWidth size="small" disabled={textLanguagesLoading}>
                        <InputLabel>{t('import.fileUpload.textLanguage')}</InputLabel>
                        <Select
                          value={textLanguage}
                          label={t('import.fileUpload.textLanguage')}
                          onChange={(e) => setTextLanguage(e.target.value)}
                          data-testid="text-language-selector"
                        >
                          {textLanguages?.map((code) => (
                            <MenuItem key={code} value={code}>
                              {t(`languages.${code}`, code.toUpperCase())}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {/* Warning if no text models available */}
                      {!textLanguagesLoading && (!textLanguages || textLanguages.length === 0) && (
                        <Alert severity="error">
                          {t('import.fileUpload.noTextModels')}
                        </Alert>
                      )}

                      {/* File Upload Area - disabled if no text language available */}
                      <Box sx={{ opacity: (!textLanguages || textLanguages.length === 0) ? 0.5 : 1 }}>
                        <FileUploadArea
                          onFileSelect={(!textLanguages || textLanguages.length === 0) ? () => {} : handleFileSelect}
                          selectedFile={selectedFile}
                          error={fileError}
                        />
                      </Box>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                {/* Mapping Rules Accordion */}
                <Accordion
                  data-testid="import-mapping-section"
                  expanded={expandedSection === 'mapping'}
                  onChange={handleAccordionChange('mapping')}
                  sx={{
                    bgcolor: 'action.hover',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: (theme) => theme.custom.borderRadius.sm,
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                    margin: 0,
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      minHeight: (theme) => theme.custom.heights.tabs,
                      '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                      '& .MuiAccordionSummary-content': {
                        my: 1,
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TransformIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          color: 'text.secondary',
                        }}
                      >
                        {t('import.mapping.title')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                    <MappingRulesEditor
                      mappingRules={mappingRules}
                      onChange={handleMappingRulesChange}
                    />
                  </AccordionDetails>
                </Accordion>

                {/* Import Mode Accordion - Only show when preview is valid */}
                {previewData?.isValid && (
                  <Accordion
                    data-testid="import-mode-section"
                    expanded={expandedSection === 'mode'}
                    onChange={handleAccordionChange('mode')}
                    sx={{
                      bgcolor: 'action.hover',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: (theme) => theme.custom.borderRadius.sm,
                      '&:before': { display: 'none' },
                      boxShadow: 'none',
                      margin: 0,
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{
                        minHeight: (theme) => theme.custom.heights.tabs,
                        '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                        '& .MuiAccordionSummary-content': {
                          my: 1,
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <MergeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            color: 'text.secondary',
                          }}
                        >
                          {t('import.mode.section')}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                      <ImportModeSelector
                        mode={importMode}
                        onModeChange={setImportMode}
                        mergeTargetId={mergeTargetId}
                        onMergeTargetChange={setMergeTargetId}
                      />
                    </AccordionDetails>
                  </Accordion>
                )}

                {/* Chapter Selection Accordion - Only show in merge mode */}
                {previewData?.isValid && importMode === 'merge' && (
                  <Accordion
                    data-testid="import-chapter-selection-section"
                    expanded={expandedSection === 'chapters'}
                    onChange={handleAccordionChange('chapters')}
                    sx={{
                      bgcolor: 'action.hover',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: (theme) => theme.custom.borderRadius.sm,
                      '&:before': { display: 'none' },
                      boxShadow: 'none',
                      margin: 0,
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{
                        minHeight: (theme) => theme.custom.heights.tabs,
                        '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                        '& .MuiAccordionSummary-content': {
                          my: 1,
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ChecklistIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            color: 'text.secondary',
                          }}
                        >
                          {t('import.chapters.title')}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                      <ChapterSelectionList
                        chapters={previewData.chapters}
                        selectedChapters={selectedChapters}
                        onSelectionChange={handleSelectionChange}
                        renamedChapters={renamedChapters}
                        onRenameChange={handleRenameChange}
                      />
                    </AccordionDetails>
                  </Accordion>
                )}

                {/* TTS Settings Accordion - Only show when preview is valid */}
                {previewData?.isValid && (
                  <Accordion
                    data-testid="import-tts-section"
                    expanded={expandedSection === 'tts'}
                    onChange={handleAccordionChange('tts')}
                    sx={{
                      bgcolor: 'action.hover',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: (theme) => theme.custom.borderRadius.sm,
                      '&:before': { display: 'none' },
                      boxShadow: 'none',
                      margin: 0,
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{
                        minHeight: (theme) => theme.custom.heights.tabs,
                        '&.Mui-expanded': { minHeight: (theme) => theme.custom.heights.tabs },
                        '& .MuiAccordionSummary-content': {
                          my: 1,
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <SettingsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            color: 'text.secondary',
                          }}
                        >
                          {t('import.tts.title')}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 2, pb: 2 }}>
                      <TTSSettingsSelector
                        engine={ttsEngine}
                        onEngineChange={setTtsEngine}
                        modelName={ttsModelName}
                        onModelChange={setTtsModelName}
                        language={language}
                        onLanguageChange={setLanguage}
                        speakerName={ttsSpeakerName}
                        onSpeakerChange={setTtsSpeakerName}
                      />
                    </AccordionDetails>
                  </Accordion>
                )}

              {/* Validation warnings */}
              <Box
                data-testid="import-actions"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: (theme) => theme.custom.spacing.sm,
                  mt: (theme) => theme.custom.spacing.md,
                }}
              >
                  {selectedFile && previewData && !previewData.isValid && (
                    <Alert severity="error" sx={{ fontSize: '0.875rem' }}>
                      {t('import.preview.invalidStatus')}
                    </Alert>
                  )}

                  {selectedFile && importMode === 'merge' && !mergeTargetId && (
                    <Alert severity="warning" sx={{ fontSize: '0.875rem' }}>
                      {t('import.actions.noMergeTarget')}
                    </Alert>
                  )}

                  {previewData && selectedChapters.size === 0 && (
                    <Alert severity="warning" sx={{ fontSize: '0.875rem' }}>
                      {t('import.actions.noChaptersSelected')}
                    </Alert>
                  )}

                  {/* Disabled state hint */}
                  {!isImportEnabled && !executeImport.isPending && (
                    <Typography variant="caption" color="text.secondary" align="center">
                      {!selectedFile
                        ? t('import.actions.noFileSelected')
                        : !previewData?.isValid
                        ? t('import.actions.invalidConfig')
                        : ''}
                    </Typography>
                  )}
                </Box>
            </Box>
          </Box>
        </Box>

        {/* Right Panel - Preview */}
        <Box
          data-testid="import-preview-panel"
          sx={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Preview Content */}
          <ImportPreviewPanel previewData={previewData} loading={previewLoading} importing={isImporting} />
        </Box>
      </ViewContent>

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </ViewContainer>
  )
})

ImportView.displayName = 'ImportView'

export default ImportView
