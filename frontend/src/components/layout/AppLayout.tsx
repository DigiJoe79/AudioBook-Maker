import { Box, Typography, Alert, Button } from '@mui/material'
import { useState, useEffect, useRef, useCallback } from 'react'
import { ErrorBoundary } from '@components/ErrorBoundary'
import { ProjectDialog } from '@components/dialogs/ProjectDialog'
import { ChapterDialog } from '@components/dialogs/ChapterDialog'
import { useProjectsList } from '@hooks/useProjectsQuery'
import { useChapter } from '@hooks/useChaptersQuery'
import { useActiveTTSJobs } from '@hooks/useTTSQuery'
import { useAllEnginesStatus } from '@hooks/useEnginesQuery'
import { useAppStore } from '@store/appStore'
import { useTranslation } from 'react-i18next'
import { logger } from '@utils/logger'
import { useSSEEventHandlers } from '@hooks/useSSEEventHandlers'
import { useSSEConnection } from '@contexts/SSEContext'
import { useAudioPlayerContext } from '@contexts/AudioPlayerContext'
import { NavigationSidebar } from '@components/layout/NavigationSidebar'
import { useNavigationStore } from '@store/navigationStore'
import MainView from '@pages/MainView'
import MonitoringView from '@pages/MonitoringView'
import SettingsView from '@pages/SettingsView'
import PronunciationView from '@pages/PronunciationView'
import SpeakersView from '@pages/SpeakersView'
import ImportView from '@pages/ImportView'
import { useNavigationShortcuts } from '@hooks/useNavigationShortcuts'
import { ViewTransition } from '@components/layout/ViewTransition'
import { useAppLayoutSession, useAppLayoutDialogs, useAudioPlayback } from '@hooks/appLayout'
import { useError } from '@hooks/useError'

export default function AppLayout() {
  // ============================================================================
  // ALL HOOKS FIRST - Must be called in same order every render (React Rules)
  // ============================================================================

  const { t } = useTranslation()

  // Register keyboard shortcuts for navigation
  useNavigationShortcuts()

  // React Query hooks
  const { data: projects = [], isLoading, error, refetch } = useProjectsList()
  const { data: enginesStatus, isLoading: enginesLoading } = useAllEnginesStatus()

  // TTS state from appStore (direct DB settings access)
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine())
  const getDefaultTtsModel = useAppStore((state) => state.getDefaultTtsModel)
  const defaultModelName = getDefaultTtsModel(defaultEngine)

  // Extract TTS engines from unified status
  const ttsEngines = enginesStatus?.tts ?? []

  // Navigation state
  const currentView = useNavigationStore((state) => state.currentView)

  // Error hook for audio playback errors
  const { showError, ErrorDialog: AudioErrorDialog } = useError()

  // ============================================================================
  // SESSION STATE MANAGEMENT (extracted hook)
  // ============================================================================

  const {
    selectedProjectId,
    selectedChapterId,
    expandedProjects,
    setSelectedProjectId,
    setSelectedChapterId,
    handleSelectProject,
    handleDeselectChapter,
    toggleProject,
    selectedProject,
  } = useAppLayoutSession({
    projects,
    isLoading,
  })

  // Fetch live chapter data - SSE events trigger automatic cache updates
  const { data: liveChapter } = useChapter(selectedChapterId)
  const selectedChapterFromProject = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  const selectedChapter = liveChapter || selectedChapterFromProject

  // ============================================================================
  // AUDIO PLAYBACK (extracted hook)
  // ============================================================================

  const {
    playingSegmentId,
    continuousPlayback,
    seekToSegmentId,
    seekTrigger,
    audioRef,
    handlePlaySegment,
    handleSegmentClick,
    handleStopPlayback,
    setPlayingSegmentId,
  } = useAudioPlayback({
    selectedChapter,
    showError,
  })

  // ============================================================================
  // DIALOGS (extracted hook)
  // ============================================================================

  // We need a local state for expandedProjects setter for the dialogs hook
  const [expandedProjectsState, setExpandedProjectsState] = useState<Set<string>>(new Set())

  // Sync expandedProjects from session hook to local state
  useEffect(() => {
    setExpandedProjectsState(expandedProjects)
  }, [expandedProjects])

  const {
    projectDialogOpen,
    chapterDialogOpen,
    editingProject,
    editingChapter,
    handleCreateProject,
    handleEditProject,
    handleSaveProject,
    handleDeleteProject,
    handleCreateChapter,
    handleEditChapter,
    handleSaveChapter,
    handleDeleteChapter,
    closeProjectDialog,
    closeChapterDialog,
    ConfirmDialog,
    ErrorDialog,
    SnackbarComponent,
    showSnackbar,
  } = useAppLayoutDialogs({
    projects,
    selectedProjectId,
    selectedProject,
    expandedProjects: expandedProjectsState,
    defaultEngine,
    defaultModelName,
    setSelectedProjectId,
    setSelectedChapterId,
    setExpandedProjects: setExpandedProjectsState,
  })

  // ============================================================================
  // SSE EVENT HANDLING
  // ============================================================================

  // Audio player context - for triggering updates from SSE events
  const { triggerUpdate: triggerAudioUpdate } = useAudioPlayerContext()

  // Stable callback for audio updates from SSE
  const handleAudioUpdate = useCallback(async (segmentId: string, chapterId: string) => {
    logger.info('[AppLayout] SSE triggered audio update', { segmentId, chapterId })
    await triggerAudioUpdate(segmentId)
  }, [triggerAudioUpdate])

  // Job Status Change Handler
  const handleJobStatusChange = useCallback((status: 'completed' | 'failed' | 'cancelled', _jobId: string, _chapterId: string) => {
    if (status === 'completed') {
      showSnackbar(t('jobs.messages.jobCompleted'), { severity: 'success' })
    } else if (status === 'failed') {
      showSnackbar(t('jobs.messages.jobFailed'), { severity: 'error' })
    } else if (status === 'cancelled') {
      showSnackbar(t('jobs.messages.jobCancelled'), { severity: 'info' })
    }
  }, [showSnackbar, t])

  // Enable SSE event handlers globally
  useSSEEventHandlers({
    enabled: true,
    onAudioUpdate: handleAudioUpdate,
    onJobStatusChange: handleJobStatusChange,
  })

  // SSE connection status (hook called for side effects)
  useSSEConnection()

  // Fetch active TTS jobs (for React Query cache, used by NavigationSidebar)
  useActiveTTSJobs()

  // ============================================================================
  // VIEW SCROLL MANAGEMENT
  // ============================================================================

  const contentRef = useRef<HTMLDivElement>(null)

  // Scroll to top when view changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo(0, 0)
    }
  }, [currentView])

  // ============================================================================
  // CONDITIONAL RETURNS (after all hooks)
  // ============================================================================

  // Handle loading state
  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('appLayout.loadingProjects')}
          </Typography>
        </Box>
      </Box>
    )
  }

  // Handle error state
  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          bgcolor: 'background.default',
          gap: 2,
          p: 4,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 600 }}>
          {error.message}
        </Alert>
        <Button variant="contained" onClick={() => refetch()}>
          {t('appLayout.retry')}
        </Button>
      </Box>
    )
  }

  // ============================================================================
  // VIEW ROUTING
  // ============================================================================

  const renderCurrentView = () => {
    switch (currentView) {
      case 'monitoring':
        return (
          <Box data-testid="monitoring-view" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MonitoringView />
          </Box>
        )
      case 'import':
        return (
          <ErrorBoundary context="ImportView" critical={false}>
            <Box data-testid="import-view" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <ImportView />
            </Box>
          </ErrorBoundary>
        )
      case 'settings':
        return (
          <ErrorBoundary context="SettingsView" critical={false}>
            <Box data-testid="settings-view" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <SettingsView />
            </Box>
          </ErrorBoundary>
        )
      case 'pronunciation':
        return (
          <ErrorBoundary context="PronunciationView" critical={false}>
            <Box data-testid="pronunciation-view" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <PronunciationView />
            </Box>
          </ErrorBoundary>
        )
      case 'speakers':
        return (
          <ErrorBoundary context="SpeakersView" critical={false}>
            <Box data-testid="speakers-view" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <SpeakersView />
            </Box>
          </ErrorBoundary>
        )
      case 'main':
      default:
        // Main view (default for unknown views)
        return (
          <ErrorBoundary context="MainView" critical={false}>
            <MainView
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedChapterId={selectedChapterId}
              expandedProjects={expandedProjects}
              onSelectProject={handleSelectProject}
              onSelectChapter={setSelectedChapterId}
              onDeselectChapter={handleDeselectChapter}
              onToggleProject={toggleProject}
              onCreateProject={handleCreateProject}
              onCreateChapter={() => selectedProjectId && handleCreateChapter(selectedProjectId)}
              onEditProject={handleEditProject}
              onEditChapter={handleEditChapter}
              onDeleteProject={handleDeleteProject}
              onDeleteChapter={handleDeleteChapter}
              seekToSegmentId={seekToSegmentId}
              seekTrigger={seekTrigger}
              onSegmentClick={handleSegmentClick}
              playingSegmentId={playingSegmentId}
              continuousPlayback={continuousPlayback}
              onPlaySegment={handlePlaySegment}
              audioRef={audioRef}
              onCurrentSegmentChange={setPlayingSegmentId}
              onStopPlayback={handleStopPlayback}
            />
          </ErrorBoundary>
        )
    }
  }

  // ============================================================================
  // NORMAL RENDER
  // ============================================================================

  return (
    <>
      <Box data-testid="app-layout" sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Navigation Sidebar (left, 72px) */}
        <NavigationSidebar />

        {/* Main Content Area */}
        <Box
          ref={contentRef}
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            height: '100vh',
          }}
        >
          <ViewTransition viewKey={currentView}>
            {renderCurrentView()}
          </ViewTransition>
        </Box>
      </Box>

      {/* Dialogs for Create/Edit */}
      <ProjectDialog
        open={projectDialogOpen}
        onClose={closeProjectDialog}
        onSave={handleSaveProject}
        initialData={editingProject ? {
          title: editingProject.title,
          description: editingProject.description || ''
        } : undefined}
        mode={editingProject ? 'edit' : 'create'}
      />

      <ChapterDialog
        open={chapterDialogOpen}
        onClose={closeChapterDialog}
        onSave={handleSaveChapter}
        initialData={editingChapter ? {
          title: editingChapter.title,
          orderIndex: editingChapter.orderIndex
        } : undefined}
        mode={editingChapter ? 'edit' : 'create'}
        nextOrderIndex={selectedProject?.chapters.length || 0}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog />

      {/* Error Dialog */}
      <ErrorDialog />

      {/* Audio Error Dialog */}
      <AudioErrorDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </>
  )
}