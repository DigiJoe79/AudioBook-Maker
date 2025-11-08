import {
  Box,
  Typography,
  Button,
  Toolbar,
} from '@mui/material'
import {
  Add,
  Upload,
  Download,
  Audiotrack,
  Description,
  FolderOpen,
  Cancel,
} from '@mui/icons-material'
import { Project, Chapter, Segment } from '../../types'
import { SegmentList } from '../SegmentList'
import ChapterList from '../ChapterList'
import { TextUploadDialog } from '../dialogs/TextUploadDialog'
import { EditSegmentDialog } from '../dialogs/EditSegmentDialog'
import { EditSegmentSettingsDialog } from '../dialogs/EditSegmentSettingsDialog'
import { GenerateAudioDialog } from '../dialogs/GenerateAudioDialog'
import { ExportDialog } from '../dialogs/ExportDialog'
import { useState } from 'react'
import { useChapter, useSegmentText } from '../../hooks/useChaptersQuery'
import { useDeleteSegment, useUpdateSegment } from '../../hooks/useSegmentsQuery'
import {
  useGenerateChapter,
  useGenerateSegment,
  useActiveTTSJobs,
} from '../../hooks/useTTSQuery'
import { useAppStore } from '../../store/appStore'
import { useConfirm } from '../../hooks/useConfirm'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSpeakers } from '../../services/settingsApi'
import { isActiveSpeaker } from '../../utils/speakerHelpers'
import { queryKeys } from '../../services/queryKeys'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/typeGuards'

interface ChapterViewProps {
  project?: Project
  chapter?: Chapter
  onCreateChapter?: () => void
  onChapterSelect?: (chapterId: string) => void
  selectedSegmentId?: string | null
  onSegmentSelect?: (segmentId: string | null) => void
  playingSegmentId?: string | null
  continuousPlayback?: boolean
  onPlaySegment?: (segment: Segment, continuous?: boolean) => void
}

export default function ChapterView({
  project,
  chapter,
  onCreateChapter,
  onChapterSelect,
  selectedSegmentId,
  onSegmentSelect,
  playingSegmentId,
  continuousPlayback = false,
  onPlaySegment
}: ChapterViewProps) {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const [currentTime] = useState(0)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editSettingsDialogOpen, setEditSettingsDialogOpen] = useState(false)
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // TTS state from appStore (uses computed getters)
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine())
  const currentModelName = useAppStore((state) => state.getCurrentTtsModelName())
  const currentSpeaker = useAppStore((state) => state.getCurrentTtsSpeaker())
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage())

  // Query speakers for validation
  const { data: speakers = [] } = useQuery({
    queryKey: ['speakers'],
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
  // Note: Generation progress monitoring is now handled by SSE events (useSSEEventHandlers)
  // Note: Job cancellation is now handled in JobsPanelDialog

  // Segment Mutations
  const deleteSegmentMutation = useDeleteSegment()
  const updateSegmentMutation = useUpdateSegment()
  const segmentTextMutation = useSegmentText()

  // Text upload handler
  const handleTextUpload = async (data: {
    text: string
    method: 'sentences' | 'paragraphs' | 'smart' | 'length'
    language: string
    speaker: string
    autoCreate: boolean
  }) => {
    if (!chapter) return

    // Check if speakers are available when autoCreate is enabled
    if (data.autoCreate) {
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
    }

    return await segmentTextMutation.mutateAsync({
      chapterId: chapter.id,
      text: data.text,
      options: {
        method: data.method,
        language: data.language,
        ttsEngine: currentEngine, // Use current engine from appStore
        ttsModelName: currentModelName, // Use current model from appStore
        ttsSpeakerName: data.speaker, // Use selected speaker from dialog
        autoCreate: data.autoCreate,
      },
    })
    // No manual refresh needed - React Query auto-updates!
  }

  // Generate audio for all segments
  const handleGenerateAllAudio = async (config: {
    speaker: string
    language: string
    ttsEngine: string
    ttsModelName: string
    forceRegenerate: boolean
  }) => {
    if (!chapter) return

    // Optimistic update: Immediately mark all non-divider segments as "processing"
    // This gives instant visual feedback before backend confirms
    queryClient.setQueryData(
      queryKeys.chapters.detail(chapter.id),
      (old: any) => {
        if (!old) return old
        return {
          ...old,
          segments: old.segments.map((s: any) => ({
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
      'Segment Count': chapter.segments.length
    }, '#FF9800')

    // Generation tracking is handled by database-backed job system (useActiveTTSJobs hook)
    try {
      await generateChapterMutation.mutateAsync({
        chapterId: chapter.id,
        ttsSpeakerName: config.speaker,  
        language: config.language,
        ttsEngine: config.ttsEngine,
        ttsModelName: config.ttsModelName,
        forceRegenerate: config.forceRegenerate,
      })
    } catch (err) {
      logger.error('[ChapterView] Failed to start audio generation:', err)

      // On error, revert optimistic update by refetching
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(chapter.id)
      })

      alert('Failed to start audio generation')
    }
  }

  // Note: Cancel generation is now handled in JobsPanelDialog
  // Users can cancel jobs by opening the Jobs panel and clicking the cancel button

  // Edit segment text
  const handleSegmentEdit = (segment: Segment) => {
    setEditingSegment(segment)
    setEditDialogOpen(true)
  }

  // Edit segment settings (Engine, Model, Language, Speaker)
  const handleSegmentEditSettings = (segment: Segment) => {
    setEditingSegment(segment)
    setEditSettingsDialogOpen(true)
  }

  // Save edited segment text
  const handleSaveSegment = async (segmentId: string, newText: string) => {
    if (!chapter) return

    await updateSegmentMutation.mutateAsync({
      segmentId,
      chapterId: chapter.id,
      data: { text: newText }
    })
    // No manual refresh needed - React Query auto-updates!
  }

  // Save edited segment settings
  const handleSaveSegmentSettings = async (
    segmentId: string,
    updates: {
      ttsEngine?: string
      ttsModelName?: string
      language?: string
      ttsSpeakerName?: string | null
    }
  ) => {
    if (!chapter) return

    await updateSegmentMutation.mutateAsync({
      segmentId,
      chapterId: chapter.id,
      data: updates
    })
    // No manual refresh needed - React Query auto-updates!
  }

  // Delete segment
  const handleDeleteSegment = async (segment: Segment) => {
    const confirmed = await confirm(
      t('segments.delete'),
      t('segments.messages.deleteConfirm')
    )
    if (!confirmed) return

    try {
      await deleteSegmentMutation.mutateAsync({
        segmentId: segment.id,
        chapterId: chapter?.id || '',
      })
      // No manual refresh needed - React Query auto-updates!
    } catch (err) {
      logger.error('[ChapterView] Failed to delete segment:', getErrorMessage(err))
      alert(t('segments.messages.error'))
    }
  }

  // Regenerate single segment
  const handleRegenerateSegment = async (segment: Segment) => {
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
    } catch (err) {
      logger.error('[ChapterView] Failed to regenerate segment:', getErrorMessage(err))
      alert(t('chapterView.failedRegenerateSegment'))
    }
  }

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

  // No chapter selected
  if (!chapter) {
    return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header - Sticky */}
      <Toolbar
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          px: 2,
          gap: 2,
          bgcolor: 'background.default',
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: '100px !important',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="overline" color="text.secondary">
            {project.title}
          </Typography>
          <Typography variant="h5" component="h1">
            {t('chapterView.overview')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {project.description || '\u00A0'}
          </Typography>
        </Box>
           <Button variant="outlined" startIcon={<Add />} size="small" onClick={onCreateChapter}>
            {t('chapters.create')}
          </Button>
      </Toolbar>

      {/* Content - Scrollable */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
        <ChapterList
          chapters={project.chapters}
          selectedChapterId={null}
          onChapterClick={(ch) => onChapterSelect?.(ch.id)}
        />
      </Box>
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
      {/* Header - Sticky */}
      <Toolbar
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          px: 2,
          gap: 2,
          bgcolor: 'background.default',
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: '100px !important',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="overline" color="text.secondary">
            {project.title}
          </Typography>
          <Typography variant="h5" component="h1">
            {chapter.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {totalSegments > 0
              ? t('chapterView.segmentsGenerated', {
                  completed: completedSegments,
                  total: totalSegments
                })
              : '\u00A0'}
          </Typography>
        </Box>

        {displayChapter.segments.length === 0 && (
          <Button
            variant="outlined"
            startIcon={<Upload />}
            size="small"
            onClick={() => setUploadDialogOpen(true)}
          >
            {t('chapterView.uploadText')}
          </Button>
        )}

        {displayChapter.segments.length > 0 && (
          <Button
            variant="outlined"
            startIcon={<Audiotrack />}
            size="small"
            onClick={() => setGenerateDialogOpen(true)}
            disabled={isGeneratingLocal}
          >
            {isGeneratingLocal
              ? t('chapterView.generating')
              : completedSegments === totalSegments
              ? t('chapterView.regenerateAllAudio')
              : t('chapterView.generateAllAudio')}
          </Button>
        )}

        {/* Note: Cancel button moved to JobsPanel - users can cancel jobs from the Jobs badge */}

        {displayChapter.segments.length > 0 && completedSegments === totalSegments && (
        <Button
          variant="outlined"
          startIcon={<Download />}
          size="small"
          onClick={() => setExportDialogOpen(true)}
        >
          {t('chapterView.exportChapter')}
        </Button>
        )}
      </Toolbar>

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
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Segment List - Takes remaining space */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <SegmentList
              chapterId={displayChapter.id}
              segments={displayChapter.segments}
              currentTime={currentTime}
              selectedSegmentId={selectedSegmentId}
              onSegmentClick={(segment) => onSegmentSelect?.(segment.id)}
              onSegmentPlay={onPlaySegment}
              onSegmentEdit={handleSegmentEdit}
              onSegmentEditSettings={handleSegmentEditSettings}
              onSegmentDelete={handleDeleteSegment}
              onSegmentRegenerate={handleRegenerateSegment}
              playingSegmentId={playingSegmentId}
              continuousPlayback={continuousPlayback}
            />
          </Box>
        </Box>
        )}
      </Box>

      {/* Text Upload Dialog */}
      <TextUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUpload={handleTextUpload}
      />

      {/* Edit Segment Text Dialog */}
      <EditSegmentDialog
        open={editDialogOpen}
        segment={editingSegment}
        onClose={() => {
          setEditDialogOpen(false)
          setEditingSegment(null)
        }}
        onSave={handleSaveSegment}
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
        onClose={() => setGenerateDialogOpen(false)}
        onGenerate={handleGenerateAllAudio}
      />

      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        chapter={displayChapter}
        project={project}
        segmentCount={totalSegments}
        completedSegmentCount={completedSegments}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog />
    </Box>
  )
}
