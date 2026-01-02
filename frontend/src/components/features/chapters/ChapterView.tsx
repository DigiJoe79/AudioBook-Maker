import {
  Box,
  Typography,
} from '@mui/material'
import {
  Description,
  FolderOpen,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { Project, Chapter, Segment } from '@types'
import { SegmentList } from '@components/features/segments/SegmentList'
import ChapterList from '@components/features/chapters/ChapterList'
import { TextUploadDialog } from '@components/dialogs/TextUploadDialog'
import { EditSegmentDialog } from '@components/dialogs/EditSegmentDialog'
import { EditSegmentSettingsDialog } from '@components/dialogs/EditSegmentSettingsDialog'
import { GenerateAudioDialog } from '@components/dialogs/GenerateAudioDialog'
import { ExportDialog } from '@components/dialogs/ExportDialog'
import { useState, useCallback } from 'react'
import { useChapter, useSegmentText } from '@hooks/useChaptersQuery'
import { useDeleteSegment, useUpdateSegment } from '@hooks/useSegmentsQuery'
import {
  useGenerateChapter,
  useGenerateSegment,
  useActiveTTSJobs,
} from '@hooks/useTTSQuery'
import { useAnalyzeChapterQuality } from '@hooks/useQualityQuery'
import { useAppStore } from '@store/appStore'
import { useConfirm } from '@hooks/useConfirm'
import { useError } from '@hooks/useError'
import { useSnackbar } from '@hooks/useSnackbar'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSpeakers } from '@services/settingsApi'
import { isActiveSpeaker } from '@utils/speakerHelpers'
import { queryKeys } from '@services/queryKeys'
import { useDefaultSpeaker } from '@hooks/useSpeakersQuery'
import { logger } from '@utils/logger'
import { getErrorMessage } from '@utils/typeGuards'
import { translateBackendError } from '@utils/translateBackendError'

interface ChapterViewProps {
  project?: Project
  chapter?: Chapter
  onCreateChapter?: () => void
  onChapterSelect?: (chapterId: string) => void
  onSegmentClick?: (segmentId: string) => void
  playingSegmentId?: string | null
  continuousPlayback?: boolean
  onPlaySegment?: (segment: Segment, continuous?: boolean) => void
  // Dialog control from MainView
  uploadDialogOpen?: boolean
  generateDialogOpen?: boolean
  exportDialogOpen?: boolean
  onUploadDialogClose?: () => void
  onGenerateDialogClose?: () => void
  onExportDialogClose?: () => void
  onAnalyzeClick?: () => void
}

export default function ChapterView({
  project,
  chapter,
  onCreateChapter,
  onChapterSelect,
  onSegmentClick,
  playingSegmentId,
  continuousPlayback = false,
  onPlaySegment,
  uploadDialogOpen = false,
  generateDialogOpen = false,
  exportDialogOpen = false,
  onUploadDialogClose,
  onGenerateDialogClose,
  onExportDialogClose,
  onAnalyzeClick
}: ChapterViewProps) {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const { showError, ErrorDialog } = useError()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const [currentTime] = useState(0)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editSettingsDialogOpen, setEditSettingsDialogOpen] = useState(false)
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null)


  // Default speaker from speakers table (single source of truth)
  const { data: defaultSpeakerData } = useDefaultSpeaker()
  const defaultSpeaker = defaultSpeakerData?.name || ''

  // Query speakers for validation
  const { data: speakers = [] } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
  })

  // React Query client for optimistic updates
  const queryClient = useQueryClient()

  // React Query Hooks
  // Database-backed job tracking - SSE-aware (no polling needed)
  const { data: activeJobsData } = useActiveTTSJobs()
  const activeJob = activeJobsData?.jobs.find(job => job.chapterId === chapter?.id)
  const isGenerating = !!activeJob

  // Fetch chapter data - SSE events trigger automatic cache updates (no polling)
  const { data: freshChapter } = useChapter(chapter?.id)

  // Use fresh chapter data from React Query if available, otherwise use prop
  const displayChapter = freshChapter || chapter

  // Check if any segment is currently processing (for UI state)
  const isAnySegmentGenerating = displayChapter?.segments.some(
    (s) => s.status === 'processing'
  ) || false

  // TTS Mutations
  const generateChapterMutation = useGenerateChapter()
  const generateSegmentMutation = useGenerateSegment()

  // Quality Analysis Mutations
  const analyzeChapterMutation = useAnalyzeChapterQuality()

  // Segment Mutations
  const deleteSegmentMutation = useDeleteSegment()
  const updateSegmentMutation = useUpdateSegment()
  const segmentTextMutation = useSegmentText()

  // Text upload handler
  const handleTextUpload = useCallback(async (data: {
    text: string
    textLanguage: string
    ttsEngine: string
    ttsModelName: string
    ttsLanguage: string
    speaker: string
  }) => {
    if (!chapter) return

    // Check if speakers are available
    if (!data.speaker) {
      throw new Error(t('textUpload.messages.noDefaultSpeaker'))
    }

    // Debug logging
    logger.group('📋 Operations', 'Text upload speaker validation', {
      'Selected Speaker': data.speaker,
      'Speakers Loaded': speakers?.length || 0,
      'Speaker Found': !!speakers?.find(s => s.name === data.speaker),
      'Speaker Data': speakers?.find(s => s.name === data.speaker)
    }, '#2196F3')

    // Check if speakers are loaded
    if (!speakers || speakers.length === 0) {
      throw new Error('Speaker list not loaded yet. Please wait a moment and try again.')
    }

    // Check if selected speaker is active (has samples)
    if (!isActiveSpeaker(data.speaker, speakers)) {
      const speaker = speakers.find(s => s.name === data.speaker)
      if (!speaker) {
        throw new Error(t('textUpload.messages.speakerInactive', { speaker: `${data.speaker} (not found)` }))
      }
      throw new Error(t('textUpload.messages.speakerInactive', { speaker: data.speaker }))
    }

    try {
      const result = await segmentTextMutation.mutateAsync({
        chapterId: chapter.id,
        text: data.text,
        options: {
          language: data.textLanguage, // Text engine language for segmentation
          ttsEngine: data.ttsEngine, // Use engine from dialog
          ttsModelName: data.ttsModelName, // Use model from dialog
          ttsLanguage: data.ttsLanguage, // TTS language from dialog
          ttsSpeakerName: data.speaker, // Use speaker from dialog
        },
      })
      // Show success message with segment count
      const segmentCount = result?.segments?.length || 0
      showSnackbar(
        t('chapterView.textSegmented', { count: segmentCount }),
        { severity: 'success' }
      )
      return result
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to segment text:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('chapterView.textSegmentFailed'),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
      throw err
    }
    // No manual refresh needed - React Query auto-updates!
  }, [chapter, speakers, segmentTextMutation, showSnackbar, t])

  // Generate audio for all segments
  const handleGenerateAllAudio = useCallback(async (config: {
    forceRegenerate: boolean
    overrideSegmentSettings?: boolean
    speaker?: string
    language?: string
    ttsEngine?: string
    ttsModelName?: string
  }) => {
    if (!chapter) return

    // Optimistic update: Immediately mark all non-divider segments as "processing"
    // This gives instant visual feedback before backend confirms
    queryClient.setQueryData(
      queryKeys.chapters.detail(chapter.id),
      (old: Chapter | undefined) => {
        if (!old) return old
        return {
          ...old,
          segments: old.segments.map((s) => ({
            ...s,
            // Only mark standard segments as processing, keep dividers unchanged
            status: s.segmentType === 'divider' ? s.status : 'processing'
          }))
        }
      }
    )

    logger.group('📋 Operations', 'Optimistic UI update', {
      'Chapter ID': chapter.id,
      'Operation': 'Mark segments as processing',
      'Segment Count': chapter.segments.length,
      'Override Settings': config.overrideSegmentSettings ?? false
    }, '#FF9800')

    // Generation tracking is handled by database-backed job system (useActiveTTSJobs hook)
    try {
      await generateChapterMutation.mutateAsync({
        chapterId: chapter.id,
        forceRegenerate: config.forceRegenerate,
        overrideSegmentSettings: config.overrideSegmentSettings,
        ttsSpeakerName: config.speaker,
        language: config.language,
        ttsEngine: config.ttsEngine,
        ttsModelName: config.ttsModelName,
      })
      showSnackbar(t('chapterView.generationJobCreated'), { severity: 'success' })
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to start audio generation:', err)

      // On error, revert optimistic update by refetching
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(chapter.id)
      })

      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : 'Failed to start audio generation',
        t
      )
      await showError(
        t('chapterView.generationFailed'),
        errorMessage
      )
    }
  }, [chapter, queryClient, generateChapterMutation, showSnackbar, showError, t])

  // Edit segment text
  const handleSegmentEdit = useCallback((segment: Segment) => {
    setEditingSegment(segment)
    setEditDialogOpen(true)
  }, [])

  // Edit segment settings (Engine, Model, Language, Speaker)
  const handleSegmentEditSettings = useCallback((segment: Segment) => {
    setEditingSegment(segment)
    setEditSettingsDialogOpen(true)
  }, [])

  // Navigate between segments in edit dialog
  const handleSegmentChange = useCallback((segmentId: string) => {
    if (!chapter) return
    const newSegment = chapter.segments.find(s => s.id === segmentId)
    if (newSegment) {
      setEditingSegment(newSegment)
    }
  }, [chapter])

  // Save edited segment text
  const handleSaveSegment = useCallback(async (segmentId: string, newText: string) => {
    if (!chapter) return

    try {
      await updateSegmentMutation.mutateAsync({
        segmentId,
        chapterId: chapter.id,
        data: { text: newText }
      })
      showSnackbar(t('segments.messages.updated'), { severity: 'success' })
      // No manual refresh needed - React Query auto-updates!
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to update segment:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('segments.messages.updateFailed'),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
      throw err
    }
  }, [chapter, updateSegmentMutation, showSnackbar, t])

  // Save edited segment settings
  const handleSaveSegmentSettings = useCallback(async (
    segmentId: string,
    updates: {
      ttsEngine?: string
      ttsModelName?: string
      language?: string
      ttsSpeakerName?: string | null
    }
  ) => {
    if (!chapter) return

    try {
      await updateSegmentMutation.mutateAsync({
        segmentId,
        chapterId: chapter.id,
        data: updates
      })
      showSnackbar(t('segments.messages.settingsUpdated'), { severity: 'success' })
      // No manual refresh needed - React Query auto-updates!
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to update segment settings:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('segments.messages.settingsUpdateFailed'),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
      throw err
    }
  }, [chapter, updateSegmentMutation, showSnackbar, t])

  // Delete segment
  const handleDeleteSegment = useCallback(async (segment: Segment) => {
    const confirmed = await confirm(
      t('segments.delete'),
      t('segments.messages.deleteConfirm'),
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )
    if (!confirmed) return

    try {
      await deleteSegmentMutation.mutateAsync({
        segmentId: segment.id,
        chapterId: chapter?.id || '',
      })
      showSnackbar(t('segments.messages.deleted'), { severity: 'success' })
      // No manual refresh needed - React Query auto-updates!
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to delete segment:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('segments.messages.deleteFailed'),
        t
      )
      await showError(
        t('segments.delete'),
        errorMessage
      )
    }
  }, [chapter, confirm, deleteSegmentMutation, showSnackbar, showError, t])

  // Regenerate single segment
  const handleRegenerateSegment = useCallback(async (segment: Segment) => {
    if (!chapter) return

    // Backend automatically creates job in tts_jobs table
    // SSE events update UI in real-time (via useSSEEventHandlers)
    try {
      // All parameters (speaker, language, engine, model, TTS options) are loaded
      // from the segment's stored values and database settings
      await generateSegmentMutation.mutateAsync({
        segmentId: segment.id,
        chapterId: chapter.id,
      })
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to regenerate segment:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('chapterView.failedRegenerateSegment'),
        t
      )
      await showError(
        t('segments.regenerate'),
        errorMessage
      )
    }
  }, [chapter, generateSegmentMutation, showError, t])

  // Analyze chapter with Quality system
  const handleAnalyzeChapter = useCallback(async () => {
    if (!chapter) return

    try {
      await analyzeChapterMutation.mutateAsync({
        chapterId: chapter.id,
        // sttEngine, sttModelName, audioEngine use backend defaults
      })
      showSnackbar(t('segments.messages.qualityJobCreated'), { severity: 'success' })
    } catch (err: unknown) {
      logger.error('[ChapterView] Failed to start quality analysis:', getErrorMessage(err))
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('chapterView.failedQualityAnalysis'),
        t
      )
      await showError(
        t('chapterView.analyzeChapter'),
        errorMessage
      )
    }
  }, [chapter, analyzeChapterMutation, showSnackbar, showError, t])

  // Handle segment click - memoized to prevent SegmentList re-renders
  const handleSegmentClick = useCallback((segment: Segment) => {
    onSegmentClick?.(segment.id)
  }, [onSegmentClick])

  // No project selected
  if (!project) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          p: 4,
        }}
      >
        <FolderOpen sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h5" color="text.secondary" gutterBottom>
          {t('chapterView.noProjectSelected')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('chapterView.selectProjectHint')}
        </Typography>
      </Box>
    )
  }

  // No chapter selected - Show chapter list
  if (!chapter) {
    return (
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
        <ChapterList
          chapters={project.chapters}
          selectedChapterId={null}
          onChapterClick={(ch) => onChapterSelect?.(ch.id)}
        />
      </Box>
    )
  }

  // Chapter view with real-time updates from React Query
  if (!displayChapter) {
    return null
  }

  // Calculate generation progress (only count audio segments, not dividers)
  const audioSegments = displayChapter.segments.filter(s => (s as any).segmentType !== 'divider')
  const completedSegments = audioSegments.filter(s => s.status === 'completed').length
  const totalSegments = audioSegments.length
  const isGeneratingLocal = isAnySegmentGenerating || generateChapterMutation.isPending

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Content - Scrollable */}
      <Box
        sx={{
          flex: 1,
          overflow: 'hidden',
          px: 0,
        }}
      >
        {/* Segments */}
        {displayChapter.segments.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              py: 8,
              px: 3,
            }}
          >
            <Description sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              {t('chapterView.noSegments')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('chapterView.uploadTextHint')}
            </Typography>
          </Box>
      ) : (
        <SegmentList
          chapterId={displayChapter.id}
          segments={displayChapter.segments}
          currentTime={currentTime}
          onSegmentClick={handleSegmentClick}
          onSegmentPlay={onPlaySegment}
          onSegmentEdit={handleSegmentEdit}
          onSegmentEditSettings={handleSegmentEditSettings}
          onSegmentDelete={handleDeleteSegment}
          onSegmentRegenerate={handleRegenerateSegment}
          playingSegmentId={playingSegmentId}
          continuousPlayback={continuousPlayback}
        />
        )}
      </Box>

      {/* Text Upload Dialog */}
      <TextUploadDialog
        open={uploadDialogOpen}
        onClose={onUploadDialogClose ?? (() => {})}
        onUpload={handleTextUpload}
      />

      {/* Edit Segment Text Dialog */}
      <EditSegmentDialog
        open={editDialogOpen}
        segment={editingSegment}
        projectId={project?.id}
        onClose={() => {
          setEditDialogOpen(false)
          setEditingSegment(null)
        }}
        onSave={handleSaveSegment}
        onSegmentChange={handleSegmentChange}
      />

      {/* Edit Segment Settings Dialog */}
      <EditSegmentSettingsDialog
        open={editSettingsDialogOpen}
        segment={editingSegment}
        onClose={() => {
          setEditSettingsDialogOpen(false)
          setEditingSegment(null)
        }}
        onSave={handleSaveSegmentSettings}
      />

      {/* Generate Audio Dialog */}
      <GenerateAudioDialog
        open={generateDialogOpen}
        chapter={displayChapter}
        onClose={onGenerateDialogClose ?? (() => {})}
        onGenerate={handleGenerateAllAudio}
      />

      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={onExportDialogClose ?? (() => {})}
        chapter={displayChapter}
        project={project}
        segmentCount={totalSegments}
        completedSegmentCount={completedSegments}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog />

      {/* Error Dialog */}
      <ErrorDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </Box>
  )
}
