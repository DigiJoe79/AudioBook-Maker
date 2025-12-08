/**
 * MainView - Main Audiobook Editing View
 *
 * The primary audiobook editing interface with:
 * - Collapsible ProjectSidebar (left, 280px or 0px)
 * - ChapterView with segment editing
 * - AudioPlayer (fixed bottom, 120px)
 *
 * Architecture:
 * - ViewContainer + ViewHeader (sidebar toggle + actions)
 * - Custom Grid Layout (280px sidebar | content area)
 * - ContentArea: Breadcrumb Toolbar + ChapterView + AudioPlayer
 */

import React, { useCallback, memo, useState, useEffect } from 'react'
import { Box, IconButton, Tooltip, Typography, Button, useTheme } from '@mui/material'
import {
  ChevronLeft,
  ChevronRight,
  Mic as MicIcon,
  Add as AddIcon,
  Upload,
  Audiotrack,
  Download,
  FolderOpen
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useError } from '@hooks/useError'
import { useSnackbar } from '@hooks/useSnackbar'
import { useActiveTTSJobs } from '@hooks/useTTSQuery'
import { useAnalyzeChapterQuality } from '@hooks/useQualityQuery'
import { useChapter } from '@hooks/useChaptersQuery'
import ProjectSidebar from '@components/sidebar/ProjectSidebar'
import ChapterView from '@components/features/chapters/ChapterView'
import AudioPlayer from '@components/AudioPlayer/AudioPlayer'
import { useNavigationStore } from '@store/navigationStore'
import { useAppStore } from '@store/appStore'
import { ViewContainer, ViewHeader } from '@components/layout/ViewComponents'
import { getSecondaryBackground } from '@/theme'
import { logger } from '@utils/logger'
import { getErrorMessage } from '@utils/typeGuards'
import type { Project, Chapter, Segment } from '@types'

interface MainViewProps {
  projects: Project[]
  selectedProjectId: string | null
  selectedChapterId: string | null
  expandedProjects: Set<string>
  onSelectProject: (projectId: string) => void
  onSelectChapter: (chapterId: string | null) => void
  onDeselectChapter?: () => void
  onToggleProject: (projectId: string) => void
  onCreateProject?: () => void
  onCreateChapter?: () => void
  onEditProject?: (projectId: string) => void
  onEditChapter?: (chapterId: string) => void
  onDeleteProject?: (projectId: string, projectTitle: string) => void
  onDeleteChapter?: (chapterId: string, chapterTitle: string) => void
  seekToSegmentId?: string | null
  seekTrigger?: number
  onSegmentClick?: (segmentId: string) => void
  playingSegmentId?: string | null
  continuousPlayback?: boolean
  onPlaySegment?: (segment: Segment, continuous?: boolean) => void
  audioRef: React.RefObject<HTMLAudioElement>
  onStopPlayback?: () => void
  onCurrentSegmentChange?: (segmentId: string | null) => void
}

const MainView = memo(({
  projects,
  selectedProjectId,
  selectedChapterId,
  expandedProjects,
  onSelectProject,
  onSelectChapter,
  onDeselectChapter,
  onToggleProject,
  onCreateProject,
  onCreateChapter,
  onEditProject,
  onEditChapter,
  onDeleteProject,
  onDeleteChapter,
  seekToSegmentId,
  seekTrigger,
  onSegmentClick,
  playingSegmentId,
  continuousPlayback,
  onPlaySegment,
  audioRef,
  onStopPlayback,
  onCurrentSegmentChange
}: MainViewProps) => {
  const { t } = useTranslation()
  const { showError, ErrorDialog } = useError()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const theme = useTheme()
  const projectSidebarCollapsed = useNavigationStore((state) => state.projectSidebarCollapsed)
  const toggleProjectSidebar = useNavigationStore((state) => state.toggleProjectSidebar)
  const navigateTo = useNavigationStore((state) => state.navigateTo)

  // Check for import success message from sessionStorage
  useEffect(() => {
    const importSuccessMessage = sessionStorage.getItem('importSuccessMessage')
    if (importSuccessMessage) {
      showSnackbar(importSuccessMessage, { severity: 'success' })
      sessionStorage.removeItem('importSuccessMessage')
    }
  }, [showSnackbar])

  // Find selected project and chapter
  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedChapter = selectedProject?.chapters.find(c => c.id === selectedChapterId)

  // Fetch fresh chapter data from React Query (for button logic)
  const { data: freshChapter } = useChapter(selectedChapterId)
  const displayChapter = freshChapter || selectedChapter

  // Dialog states
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // Check for active TTS jobs
  const { data: activeJobsData } = useActiveTTSJobs()
  const activeJob = activeJobsData?.jobs.find(job => job.chapterId === selectedChapterId)
  const isGenerating = !!activeJob

  // Quality Analysis Mutation (unified STT + Audio)
  const analyzeChapterMutation = useAnalyzeChapterQuality()

  // Check engine availability for quality analysis (needs at least STT or Audio engine)
  const engineAvailability = useAppStore((state) => state.engineAvailability)
  const canAnalyzeQuality = engineAvailability.stt.hasEnabled || engineAvailability.audio.hasEnabled

  // Calculate chapter info for button logic (use displayChapter for fresh data!)
  const hasSegments = (displayChapter?.segments.length ?? 0) > 0
  const audioSegments = displayChapter?.segments.filter(s => (s as any).segmentType !== 'divider') ?? []
  const completedSegments = audioSegments.filter(s => s.status === 'completed').length
  const totalSegments = audioSegments.length
  const allSegmentsCompleted = hasSegments && completedSegments === totalSegments

  // Memoized toggle handler
  const handleToggleSidebar = useCallback(() => {
    toggleProjectSidebar()
  }, [toggleProjectSidebar])

  // Dialog handlers
  const handleUploadClick = useCallback(() => {
    setUploadDialogOpen(true)
  }, [])

  const handleGenerateClick = useCallback(() => {
    setGenerateDialogOpen(true)
  }, [])

  const handleExportClick = useCallback(() => {
    setExportDialogOpen(true)
  }, [])

  const handleAnalyzeClick = useCallback(async () => {
    if (!selectedChapterId) return

    try {
      // Use default engines from settings (no need to specify here)
      await analyzeChapterMutation.mutateAsync({
        chapterId: selectedChapterId,
      })
      showSnackbar(t('segments.messages.qualityJobCreated'), { severity: 'success' })
    } catch (err) {
      logger.error('[MainView] Failed to start quality analysis:', getErrorMessage(err))
      await showError(
        t('quality.analyze'),
        t('chapterView.failedQualityAnalysis')
      )
    }
  }, [selectedChapterId, analyzeChapterMutation, t, showError, showSnackbar])

  return (
    <ViewContainer>
      {/* ViewHeader - Title with Sidebar Toggle + Actions */}
      <ViewHeader
        title={t('mainView.title')}
        icon={
          <Tooltip title={t('mainView.toggleSidebar')} placement="bottom">
            <IconButton
              onClick={handleToggleSidebar}
              size="small"
              data-testid="sidebar-toggle"
              sx={{
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                ml: 3,
                mr: 4,
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              {projectSidebarCollapsed ? <ChevronRight sx={{ fontSize: 18 }} /> : <ChevronLeft sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        }
        actions={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>

            {/* Action Buttons - Only visible when chapter selected */}
            {selectedChapterId && hasSegments && (
              <Button
                data-testid="generate-chapter-button"
                size="small"
                startIcon={<Audiotrack />}
                onClick={handleGenerateClick}
                disabled={isGenerating}
              >
                {isGenerating
                  ? t('chapterView.generating')
                  : allSegmentsCompleted
                  ? t('chapterView.regenerateAllAudio')
                  : t('chapterView.generateAllAudio')}
              </Button>
            )}

            {selectedChapterId && (
              <Tooltip
                title={
                  !canAnalyzeQuality
                    ? t('quality.noEngineAvailable')
                    : !allSegmentsCompleted
                    ? t('quality.generateFirst')
                    : ''
                }
                placement="bottom"
              >
                <span>
                  <Button
                    size="small"
                    startIcon={<MicIcon />}
                    onClick={handleAnalyzeClick}
                    disabled={analyzeChapterMutation.isPending || !canAnalyzeQuality || !allSegmentsCompleted}
                  >
                    {analyzeChapterMutation.isPending
                      ? t('chapterView.analyzingChapter')
                      : t('chapterView.analyzeChapter')}
                  </Button>
                </span>
              </Tooltip>
            )}

            {selectedChapterId && (
              <Tooltip
                title={!allSegmentsCompleted ? t('chapterView.exportRequiresAudio') : ''}
                placement="bottom"
              >
                <span>
                  <Button
                    size="small"
                    startIcon={<Download />}
                    onClick={handleExportClick}
                    disabled={!allSegmentsCompleted}
                  >
                    {t('chapterView.exportChapter')}
                  </Button>
                </span>
              </Tooltip>
            )}

            {/* Dynamic Create Button */}
            {!selectedProjectId ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<FolderOpen />}
                onClick={onCreateProject}
              >
                {t('projects.new')}
              </Button>
            ) : !selectedChapterId ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={onCreateChapter}
              >
                {t('chapters.new')}
              </Button>
            ) : (
              <Button
                variant="contained"
                size="small"
                startIcon={<Upload />}
                onClick={handleUploadClick}
                data-testid="upload-text-button"
              >
                {t('chapterView.uploadText')}
              </Button>
            )}
          </Box>
        }
      />

      {/* ViewBody - Custom Grid Layout (Sidebar Pattern) */}
      <Box
        data-testid="main-view"
        sx={{
          display: 'grid',
          gridTemplateColumns: projectSidebarCollapsed ? '0 1fr' : '280px 1fr',
          height: 'calc(100vh - 64px)', // Subtract ViewHeader height
          overflow: 'hidden',
          transition: 'grid-template-columns 0.3s ease',
        }}
      >
        {/* ProjectSidebar - Collapsible (280px → 0px) */}
        <Box
          data-testid="project-sidebar"
          sx={{
            width: projectSidebarCollapsed ? 0 : 280,
            overflow: 'hidden',
            transition: 'width 300ms ease-in-out',
            borderRight: projectSidebarCollapsed ? 0 : 1,
            borderColor: 'divider',
          }}
        >
          <ProjectSidebar
            projects={projects}
            selectedProjectId={selectedProjectId}
            selectedChapterId={selectedChapterId}
            expandedProjects={expandedProjects}
            onSelectProject={onSelectProject}
            onSelectChapter={onSelectChapter}
            onToggleProject={onToggleProject}
            onCreateProject={onCreateProject}
            onCreateChapter={onCreateChapter}
            onEditProject={onEditProject}
            onEditChapter={onEditChapter}
            onDeleteProject={onDeleteProject}
            onDeleteChapter={onDeleteChapter}
            width={280}
          />
        </Box>

        {/* ContentArea - Breadcrumb + ChapterView + AudioPlayer */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Content Toolbar - Breadcrumb Navigation */}
          {(selectedProject || selectedChapter) && (
            <Box
              sx={{
                minHeight: '56px',
                padding: '12px 24px',
                bgcolor: getSecondaryBackground(theme),
                borderBottom: 1,
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'text.secondary',
                }}
              >
                {selectedProject && (
                  <>
                    <Typography
                      component="span"
                      onClick={selectedChapter && onDeselectChapter ? onDeselectChapter : undefined}
                      sx={{
                        cursor: selectedChapter ? 'pointer' : 'default',
                        '&:hover': selectedChapter ? {
                          color: 'primary.main',
                          textDecoration: 'underline',
                        } : {},
                      }}
                    >
                      {selectedProject.title}
                    </Typography>
                    {selectedChapter && (
                      <>
                        <Typography
                          component="span"
                          sx={{ color: 'text.disabled' }}
                        >
                          ›
                        </Typography>
                        <Typography
                          component="span"
                          sx={{ color: 'primary.light', fontWeight: 500 }}
                        >
                          {selectedChapter.title}
                        </Typography>
                      </>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )}

          {/* ChapterView - Main Content */}
          <Box
            data-testid="chapter-view"
            sx={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ChapterView
              project={selectedProject}
              chapter={selectedChapter}
              onCreateChapter={onCreateChapter}
              onChapterSelect={onSelectChapter}
              onSegmentClick={onSegmentClick}
              playingSegmentId={playingSegmentId}
              continuousPlayback={continuousPlayback}
              onPlaySegment={onPlaySegment}
              uploadDialogOpen={uploadDialogOpen}
              generateDialogOpen={generateDialogOpen}
              exportDialogOpen={exportDialogOpen}
              onUploadDialogClose={() => setUploadDialogOpen(false)}
              onGenerateDialogClose={() => setGenerateDialogOpen(false)}
              onExportDialogClose={() => setExportDialogOpen(false)}
            />
          </Box>

          {/* AudioPlayer - Fixed Bottom (120px) */}
          <Box
            data-testid="audio-player"
            sx={{
              height: 120,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              flexShrink: 0,
            }}
          >
            <AudioPlayer
              chapterId={selectedChapterId}
              seekToSegmentId={seekToSegmentId}
              seekTrigger={seekTrigger}
              playingSegmentId={playingSegmentId}
              audioRef={audioRef}
              onPlaySegment={onPlaySegment}
              onStopPlayback={onStopPlayback}
              onCurrentSegmentChange={onCurrentSegmentChange}
            />
          </Box>
        </Box>
      </Box>

      {/* Snackbar Notifications */}
      <SnackbarComponent />

      {/* Error Dialog */}
      <ErrorDialog />
    </ViewContainer>
  )
})

MainView.displayName = 'MainView'

export default MainView
