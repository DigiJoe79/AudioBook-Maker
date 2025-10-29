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
import { useGenerateChapter, useGenerateSegment } from '../../hooks/useTTSQuery'
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

  const currentEngine = useAppStore((state) => state.getCurrentEngine())
  const currentModelName = useAppStore((state) => state.getCurrentModelName())
  const currentSpeaker = useAppStore((state) => state.getCurrentSpeaker())
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage())

  const { data: speakers = [] } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  })

  const queryClient = useQueryClient()

  const activeGenerations = useAppStore((state) => state.activeGenerations)
  const isGenerating = chapter?.id ? activeGenerations.has(chapter.id) : false

  const { data: freshChapter } = useChapter(chapter?.id, {
    forcePolling: isGenerating,
    pollingInterval: 500,
  })

  const displayChapter = freshChapter || chapter

  const isAnySegmentGenerating = displayChapter?.segments.some(
    (s) => s.status === 'processing'
  ) || false

  const generateChapterMutation = useGenerateChapter()
  const generateSegmentMutation = useGenerateSegment()

  const deleteSegmentMutation = useDeleteSegment()
  const updateSegmentMutation = useUpdateSegment()
  const segmentTextMutation = useSegmentText()

  const handleTextUpload = async (data: {
    text: string
    method: 'sentences' | 'paragraphs' | 'smart' | 'length'
    language: string
    autoCreate: boolean
  }) => {
    if (!chapter) return

    if (data.autoCreate) {
      if (!currentSpeaker) {
        throw new Error(t('textUpload.messages.noDefaultSpeaker'))
      }

      logger.debug('[TextUpload] Current speaker:', currentSpeaker)
      logger.debug('[TextUpload] Speakers loaded:', speakers?.length || 0)
      logger.debug('[TextUpload] Speaker data:', speakers?.find(s => s.name === currentSpeaker))

      if (!speakers || speakers.length === 0) {
        throw new Error('Speaker list not loaded yet. Please wait a moment and try again.')
      }

      if (!isActiveSpeaker(currentSpeaker, speakers)) {
        const speaker = speakers.find(s => s.name === currentSpeaker)
        if (!speaker) {
          throw new Error(t('textUpload.messages.speakerInactive', { speaker: `${currentSpeaker} (not found)` }))
        }
        throw new Error(t('textUpload.messages.speakerInactive', { speaker: currentSpeaker }))
      }
    }

    return await segmentTextMutation.mutateAsync({
      chapterId: chapter.id,
      text: data.text,
      options: {
        method: data.method,
        language: data.language,
        engine: currentEngine,
        modelName: currentModelName,
        speakerName: currentSpeaker,
        autoCreate: data.autoCreate,
      },
    })
  }

  const handleGenerateAllAudio = async (config: {
    speaker: string
    language: string
    engine: string
    modelName: string
    forceRegenerate: boolean
  }) => {
    if (!chapter) return

    queryClient.setQueryData(
      queryKeys.chapters.detail(chapter.id),
      (old: any) => {
        if (!old) return old
        return {
          ...old,
          segments: old.segments.map((s: any) => ({
            ...s,
            status: s.segmentType === 'divider' ? s.status : 'processing'
          }))
        }
      }
    )

    logger.debug('[ChapterView] Optimistically marked segments as processing')

    try {
      await generateChapterMutation.mutateAsync({
        chapterId: chapter.id,
        speaker: config.speaker,
        language: config.language,
        engine: config.engine,
        modelName: config.modelName,
        forceRegenerate: config.forceRegenerate,
      })
    } catch (err) {
      logger.error('[ChapterView] Failed to start audio generation:', err)

      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(chapter.id)
      })

      alert('Failed to start audio generation')
    }
  }

  const handleSegmentEdit = (segment: Segment) => {
    setEditingSegment(segment)
    setEditDialogOpen(true)
  }

  const handleSegmentEditSettings = (segment: Segment) => {
    setEditingSegment(segment)
    setEditSettingsDialogOpen(true)
  }

  const handleSaveSegment = async (segmentId: string, newText: string) => {
    if (!chapter) return

    await updateSegmentMutation.mutateAsync({
      segmentId,
      chapterId: chapter.id,
      data: { text: newText }
    })
  }

  const handleSaveSegmentSettings = async (
    segmentId: string,
    updates: {
      engine?: string
      modelName?: string
      language?: string
      speakerName?: string | null
    }
  ) => {
    if (!chapter) return

    await updateSegmentMutation.mutateAsync({
      segmentId,
      chapterId: chapter.id,
      data: updates
    })
  }

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
    } catch (err) {
      logger.error('[ChapterView] Failed to delete segment:', getErrorMessage(err))
      alert(t('segments.messages.error'))
    }
  }

  const handleRegenerateSegment = async (segment: Segment) => {
    if (!chapter) return

    const { startGeneration, stopGeneration } = useAppStore.getState()
    startGeneration(chapter.id)

    try {
      await generateSegmentMutation.mutateAsync({
        segmentId: segment.id,
        chapterId: chapter.id,
      })
    } catch (err) {
      logger.error('[ChapterView] Failed to regenerate segment:', getErrorMessage(err))
      alert(t('chapterView.failedRegenerateSegment'))
      stopGeneration(chapter.id)
    }
  }

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

  if (!chapter) {
    return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

  if (!displayChapter) {
    return null
  }

  const audioSegments = displayChapter.segments.filter(s => (s as any).segmentType !== 'divider')
  const completedSegments = audioSegments.filter(s => s.status === 'completed').length
  const totalSegments = audioSegments.length
  const isGeneratingLocal = isAnySegmentGenerating || generateChapterMutation.isPending

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      <Box
        sx={{
          flex: 1,
          overflow: 'hidden',
          px: 0,
        }}
      >
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

      <TextUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUpload={handleTextUpload}
      />

      <EditSegmentDialog
        open={editDialogOpen}
        segment={editingSegment}
        onClose={() => {
          setEditDialogOpen(false)
          setEditingSegment(null)
        }}
        onSave={handleSaveSegment}
      />

      <EditSegmentSettingsDialog
        open={editSettingsDialogOpen}
        segment={editingSegment}
        onClose={() => {
          setEditSettingsDialogOpen(false)
          setEditingSegment(null)
        }}
        onSave={handleSaveSegmentSettings}
      />

      <GenerateAudioDialog
        open={generateDialogOpen}
        chapter={displayChapter}
        onClose={() => setGenerateDialogOpen(false)}
        onGenerate={handleGenerateAllAudio}
      />

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        chapter={displayChapter}
        project={project}
        segmentCount={totalSegments}
        completedSegmentCount={completedSegments}
      />

      <ConfirmDialog />
    </Box>
  )
}
