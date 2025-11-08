import { Box, Typography, Alert, Button, Select, MenuItem, FormControl, Chip, IconButton, Badge } from '@mui/material'
import { Settings as SettingsIcon, WorkHistory as JobsIcon } from '@mui/icons-material'
import { useState, useEffect, useRef } from 'react'
import ProjectSidebar from '../Sidebar/ProjectSidebar'
import ChapterView from '../chapter/ChapterView'
import AudioPlayer from '../AudioPlayer/AudioPlayer'
import { ErrorBoundary } from '../ErrorBoundary'
import { Project, Chapter, Segment } from '../../types'
import { ProjectDialog } from '../dialogs/ProjectDialog'
import { ChapterDialog } from '../dialogs/ChapterDialog'
import SettingsDialog from '../dialogs/SettingsDialog'
import { JobsPanelDialog } from '../dialogs/JobsPanelDialog'
import { useProjectsList, useCreateProject, useUpdateProject, useDeleteProject } from '../../hooks/useProjectsQuery'
import { useCreateChapter, useUpdateChapter, useDeleteChapter, useChapter } from '../../hooks/useChaptersQuery'
import { useTTSEngines, useTTSModels, useActiveTTSJobs } from '../../hooks/useTTSQuery'
import { useAppStore } from '../../store/appStore'
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback'
import type { SessionState } from '../../types/backend'
import { DisconnectButton } from '../DisconnectButton'
import { useConfirm } from '../../hooks/useConfirm'
import { useTranslation } from 'react-i18next'
import { NoSpeakersOverlay } from '../overlays/NoSpeakersOverlay'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSpeakers } from '../../services/settingsApi'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/typeGuards'
import { useSSEEventHandlers } from '../../hooks/useSSEEventHandlers'
import { useSSEConnection } from '../../contexts/SSEContext'
import { ttsApi } from '../../services/api'
import { getAudioUrl } from '../../utils/audioUrl'

const SIDEBAR_WIDTH = 280
const PLAYER_HEIGHT = 120

export default function AppLayout() {
  // ============================================================================
  // ALL HOOKS FIRST - Must be called in same order every render (React Rules)
  // ============================================================================

  const { t } = useTranslation()

  // React Query hooks
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading, error, refetch } = useProjectsList()
  const createProjectMutation = useCreateProject()
  const updateProjectMutation = useUpdateProject()
  const deleteProjectMutation = useDeleteProject()
  const createChapterMutation = useCreateChapter()
  const updateChapterMutation = useUpdateChapter()
  const deleteChapterMutation = useDeleteChapter()
  const { data: engines = [], isLoading: enginesLoading } = useTTSEngines()

  // TTS state from appStore (uses computed getters + session overrides)
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine())
  const currentModelName = useAppStore((state) => state.getCurrentTtsModelName())
  const setSessionOverride = useAppStore((state) => state.setSessionOverride)
  const backendUrl = useAppStore((state) => state.connection.url)

  // Session state management from appStore
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  // Global settings from appStore
  const settings = useAppStore((state) => state.settings)
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500 // Fallback to 500ms

  // Validate that current engine exists before fetching models
  // - While loading: validatedEngine = null (don't query yet)
  // - After load with empty list: validatedEngine = null (no engines available)
  // - After load with engines: validatedEngine = currentEngine if exists, else null
  const engineExists = !enginesLoading && engines.length > 0 && engines.some(e => e.name === currentEngine)
  const validatedEngine = engineExists ? currentEngine : null

  // Fetch models for current engine (only if engine exists and not loading)
  const { data: models = [], isLoading: modelsLoading } = useTTSModels(validatedEngine)

  // Enable SSE event handlers globally (CRITICAL for real-time updates)
  useSSEEventHandlers({ enabled: true })

  // SSE connection status for status indicator (uses shared connection from context)
  const { connection: sseConnection } = useSSEConnection()

  // Fetch active TTS jobs for badge display (SSE-aware, no aggressive polling)
  const { data: activeJobsData } = useActiveTTSJobs()
  const activeJobsCount = activeJobsData?.jobs.length ?? 0

  // NOTE: No manual refetch on SSE reconnect needed - SSE events already update cache

  // Check if speakers are available
  const { data: speakers = [], isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  })
  // Only count active speakers
  const hasSpeakers = speakers.filter(s => s.isActive).length > 0

  // Confirmation dialog hook
  const { confirm, ConfirmDialog } = useConfirm()

  // Calculate safe engine value (prevents MUI warnings when engines unavailable)
  const safeEngineValue = engines.length > 0 && engines.some(e => e.name === currentEngine)
    ? currentEngine
    : ''

  // Calculate safe model value (prevents MUI warnings during loading/switching)
  const safeModelValue = models.length > 0 && models.some(m => m.modelName === currentModelName)
    ? currentModelName
    : ''

  // Validate and sync session overrides with available engines
  useEffect(() => {
    if (!enginesLoading) {
      if (engines.length > 0) {
        // Check if current engine exists in available engines
        const engineExists = engines.some(e => e.name === currentEngine)
        if (!engineExists) {
          // Current engine doesn't exist, set to first available engine
          logger.warn('[AppLayout] Current engine not found, switching to first available:', {
            current: currentEngine,
            available: engines.map(e => e.name),
            switching: engines[0].name
          })

          // Remove cached queries for the invalid engine (prevents refetch on mount)
          queryClient.removeQueries({ queryKey: ['tts', 'models', currentEngine] })

          setSessionOverride('ttsEngine', engines[0].name)
          // Clear model override - will be set by model auto-select effect
          setSessionOverride('ttsModelName', '')
        }
      } else {
        // No engines available, clear session overrides
        if (currentEngine) {
          logger.warn('[AppLayout] No engines available, clearing session overrides')

          // Remove cached queries for invalid engine (prevents refetch on mount)
          queryClient.removeQueries({ queryKey: ['tts', 'models', currentEngine] })

          setSessionOverride('ttsEngine', '')
          setSessionOverride('ttsModelName', '')
        }
      }
    }
  }, [engines, enginesLoading, currentEngine, setSessionOverride, queryClient])

  // Get session overrides to check if already set (avoid infinite loops)
  const sessionOverrides = useAppStore((state) => state.sessionOverrides)

  // Auto-select first model when engine changes or models load
  useEffect(() => {
    if (models.length > 0) {
      // Check if current model exists in new models list
      const modelExists = models.some(m => m.modelName === currentModelName)
      if (!modelExists) {
        // Current model doesn't exist, set session override to first available
        setSessionOverride('ttsModelName', models[0].modelName)
      }
    } else if (currentModelName) {
      // No models available, clear session override
      // Only clear if override is not already empty (avoid infinite loop)
      if (sessionOverrides.ttsModelName !== '') {
        setSessionOverride('ttsModelName', '')
      }
    }
  }, [models, currentModelName, setSessionOverride, sessionOverrides.ttsModelName])

  // Notify backend of preferred engine/model after both are properly set
  useEffect(() => {
    // Only notify if we have valid engine and model (not empty strings)
    if (currentEngine && currentModelName && !enginesLoading && !modelsLoading) {
      ttsApi.setPreferredEngine(currentEngine, currentModelName).catch(err => {
        logger.error('[AppLayout] Failed to set preferred engine:', err)
      })
    }
  }, [currentEngine, currentModelName, enginesLoading, modelsLoading])

  // Note: Language auto-update removed - getCurrentLanguage() handles this automatically
  // via settings.tts.engines[engine].defaultLanguage fallback

  // State hooks - ALL useState must come before any conditional returns
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null)
  const [continuousPlayback, setContinuousPlayback] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<number>(0)
  const [jobsPanelOpen, setJobsPanelOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [sessionRestored, setSessionRestored] = useState(false)

  // Fetch live chapter data - SSE events trigger automatic cache updates (no polling)
  const { data: liveChapter } = useChapter(selectedChapterId)

  // Ref hooks
  const lastSelectedChapterRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const selectedChapterRef = useRef<typeof selectedChapter>(undefined)
  const currentPlayingSegmentIdRef = useRef<string | null>(null)
  const continuousPlaybackRef = useRef<boolean>(false)
  const handlePlaySegmentRef = useRef<((segment: Segment, continuous?: boolean) => void) | undefined>(undefined)
  const pauseTimeoutRef = useRef<number | null>(null) // Track pause segment timeouts (setTimeout returns number in browser)

  // Computed values (not hooks, but used by effects)
  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedChapterFromProject = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  // Prefer live chapter data (with polling) over cached project data
  const selectedChapter = liveChapter || selectedChapterFromProject

  // Effect hooks - Track and restore chapter selection
  useEffect(() => {
    if (selectedChapterId) {
      lastSelectedChapterRef.current = selectedChapterId
    }
  }, [selectedChapterId])

  useEffect(() => {
    // Only run if we have a saved chapter ID and a selected project
    if (!lastSelectedChapterRef.current || !selectedProject) {
      return
    }

    const chapterStillExists = selectedProject.chapters.some(
      c => c.id === lastSelectedChapterRef.current
    )

    if (chapterStillExists && !selectedChapterId) {
      // Chapter exists but selection was lost - restore it
      setSelectedChapterId(lastSelectedChapterRef.current)
    } else if (!chapterStillExists) {
      // Chapter was deleted - clear the ref and selection
      lastSelectedChapterRef.current = null
      setSelectedChapterId(null)
    }
  }, [projects, selectedProject, selectedChapterId])

  // Keep selectedChapterRef in sync with selectedChapter for live data in closures
  useEffect(() => {
    selectedChapterRef.current = selectedChapter
  }, [selectedChapter])

  // Keep handlePlaySegmentRef updated with the latest version of the function
  useEffect(() => {
    handlePlaySegmentRef.current = handlePlaySegmentInternal
  })

  // Cleanup audio on unmount
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      audio.pause()
      audio.src = ''
      audio.load()
    }
  }, [])


  // ============================================================================
  // SESSION STATE MANAGEMENT (Phase 7)
  // ============================================================================

  // Restore session state on mount
  useEffect(() => {
    if (sessionRestored) return

    const session = restoreSessionState()
    if (session) {
      logger.group('📱 Layout', 'Restoring previous session', {
        'Project ID': session.selectedProjectId,
        'Chapter ID': session.selectedChapterId,
        'Segment ID': session.selectedSegmentId,
        'Expanded Projects': session.expandedProjects.length
      }, '#2196F3')

      // Restore selections
      if (session.selectedProjectId) {
        setSelectedProjectId(session.selectedProjectId)
      }
      if (session.selectedChapterId) {
        setSelectedChapterId(session.selectedChapterId)
      }
      if (session.selectedSegmentId) {
        setSelectedSegmentId(session.selectedSegmentId)
      }

      // Restore expanded projects
      if (session.expandedProjects.length > 0) {
        setExpandedProjects(new Set(session.expandedProjects))
      }
    }

    setSessionRestored(true)
  }, [restoreSessionState, sessionRestored])

  // Save session state on changes (debounced to avoid excessive saves)
  const saveSessionDebounced = useDebouncedCallback(() => {
    const state: SessionState = {
      selectedProjectId,
      selectedChapterId,
      selectedSegmentId,
      expandedProjects: Array.from(expandedProjects),
      timestamp: new Date(),
    }
    saveSessionState(state)
  }, 1000)

  useEffect(() => {
    // Only save after session has been restored (to avoid overwriting on mount)
    if (sessionRestored) {
      saveSessionDebounced()
    }
  }, [selectedProjectId, selectedChapterId, selectedSegmentId, expandedProjects, sessionRestored, saveSessionDebounced])

  // ============================================================================
  // HANDLER FUNCTIONS
  // ============================================================================

  // Project handlers
  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId)
    setSelectedChapterId(null)
    lastSelectedChapterRef.current = null  // Reset the ref to prevent restore
  }

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId)
    } else {
      newExpanded.add(projectId)
    }
    setExpandedProjects(newExpanded)
  } 

  const handleCreateProject = () => {
    setEditingProject(null)
    setProjectDialogOpen(true)
  }

  const handleSaveProject = async (data: { title: string; description: string }) => {
    if (editingProject) {
      // Update existing project
      await updateProjectMutation.mutateAsync({
        id: editingProject.id,
        data
      })
    } else {
      // Create new project
      const newProject = await createProjectMutation.mutateAsync(data)
      // Automatically select the new project
      setSelectedProjectId(newProject.id)
    }
    // No need to call onProjectsChange - React Query auto-updates!
  }

  // Chapter handlers
  const handleCreateChapter = (projectId: string) => {
    setSelectedProjectId(projectId)
    setEditingChapter(null)
    setChapterDialogOpen(true)
  }

  const handleEditProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setEditingProject(project)
      setProjectDialogOpen(true)
    }
  }

  const handleEditChapter = (chapterId: string) => {
    const project = projects.find(p => p.chapters.some(c => c.id === chapterId))
    const chapter = project?.chapters.find(c => c.id === chapterId)
    if (chapter && project) {
      setSelectedProjectId(project.id)
      setEditingChapter(chapter)
      setChapterDialogOpen(true)
    }
  }

  const handleSaveChapter = async (data: { title: string; orderIndex: number }) => {
    if (editingChapter) {
      // Update existing chapter
      await updateChapterMutation.mutateAsync({
        id: editingChapter.id,
        data
      })
      return
    }

    if (!selectedProjectId) return

    // Check if this is the first chapter for the project
    const project = projects.find(p => p.id === selectedProjectId)
    const isFirstChapter = project?.chapters.length === 0

    const newChapter = await createChapterMutation.mutateAsync({
      projectId: selectedProjectId,
      defaultTtsEngine: currentEngine,
      defaultTtsModelName: currentModelName,
      ...data,
    })

    // If this is the first chapter, auto-expand the project
    if (isFirstChapter) {
      const newExpanded = new Set(expandedProjects)
      newExpanded.add(selectedProjectId)
      setExpandedProjects(newExpanded)
    }

    // Small delay to ensure React Query cache updates are processed
    // This ensures the chapter data is available when the view renders
    setTimeout(() => {
      // Automatically select the new chapter
      setSelectedChapterId(newChapter.id)
    }, 50)
  }

  const handleDeleteProject = async (projectId: string, projectTitle: string) => {
    const confirmed = await confirm(
      t('projects.delete'),
      t('appLayout.deleteProjectConfirm', { title: projectTitle })
    )
    if (!confirmed) return

    try {
      await deleteProjectMutation.mutateAsync(projectId)
      // Reset selection after deletion
      setSelectedProjectId(null)
      setSelectedChapterId(null)
      // React Query auto-updates the project list
    } catch (err) {
      logger.error('[AppLayout] Failed to delete project:', getErrorMessage(err))
      alert(t('projects.messages.error'))
    }
  }

  const handleDeleteChapter = async (chapterId: string, chapterTitle: string) => {
    const confirmed = await confirm(
      t('chapters.delete'),
      t('appLayout.deleteChapterConfirm', { title: chapterTitle })
    )
    if (!confirmed) return

    // Find the project that contains this chapter
    const project = projects.find(p => p.chapters.some(c => c.id === chapterId))
    if (!project) {
      logger.error('[AppLayout] Could not find project for chapter:', chapterId)
      return
    }

    try {
      await deleteChapterMutation.mutateAsync({ chapterId, projectId: project.id })
      // Reset chapter selection after deletion
      setSelectedChapterId(null)
      // React Query auto-updates the project/chapter list
    } catch (err) {
      logger.error('[AppLayout] Failed to delete chapter:', getErrorMessage(err))
      alert(t('chapters.messages.error'))
    }
  }

  /**
   * Audio playback handler - Central function for playing segments
   *
   * @param segment - The segment to play
   * @param continuous - If true, automatically play next segments after this one (autoplay)
   *                     If false, only play this single segment and stop
   *
   * Used by:
   * - AudioPlayer (big play button): Always continuous=true for autoplay
   * - AudioPlayer (prev/next): Always continuous=true to maintain autoplay
   * - SegmentList (small play button): Always continuous=false for single segment play
   */
  const handlePlaySegmentInternal = (segment: Segment, continuous = false) => {
    if (!segment.audioPath) return

    // Construct full audio URL with cache-busting (handles both old URLs and new filenames)
    const audioUrl = getAudioUrl(segment.audioPath, backendUrl, segment.updatedAt)
    if (!audioUrl) {
      logger.error('[PlaySegment] Failed to construct audio URL', {
        audioPath: segment.audioPath,
        backendUrl,
        updatedAt: segment.updatedAt
      })
      return
    }

    const audio = audioRef.current

    // Set continuous playback mode
    if (import.meta.env.DEV) {
      logger.group(
        '🎵 Playback',
        'Starting playback',
        {
          segmentId: segment.id,
          continuous,
          mode: continuous ? 'AUTOPLAY MODE' : 'SINGLE SEGMENT MODE',
          audioUrl
        },
        '#2196F3'
      )
    }
    setContinuousPlayback(continuous)
    continuousPlaybackRef.current = continuous

    // If clicking the same segment that's playing, stop it (toggle behavior)
    if (playingSegmentId === segment.id) {
      audio.pause()
      audio.currentTime = 0
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false

      // Clear any pending pause timeout
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current)
        pauseTimeoutRef.current = null
      }
      return
    }

    // Stop current playback and clean up
    audio.pause()
    audio.currentTime = 0

    // Clear any pending pause timeout from previous playback
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }

    // Remove all existing event listeners to prevent duplicates
    audio.onended = null
    audio.onerror = null

    // Set new source
    audio.src = audioUrl
    audio.load()

    // Set up event handlers
    audio.onended = () => {
      const currentChapter = selectedChapterRef.current
      const currentSegmentId = currentPlayingSegmentIdRef.current
      const isContinuous = continuousPlaybackRef.current

      if (import.meta.env.DEV) {
        logger.debug('[Auto-Play] Segment ended', {
          hasChapter: !!currentChapter,
          currentSegmentId,
          totalSegments: currentChapter?.segments.length,
          continuousPlayback: isContinuous
        })
      }

      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null

      // AUTOPLAY LOGIC:
      // - If continuous=false (single segment mode): Stop here
      // - If continuous=true (autoplay mode): Play next segment automatically
      if (!isContinuous) {
        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] Single segment mode - stopping playback')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      if (!currentChapter || !currentSegmentId) {
        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] No chapter or segment ID, stopping')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      const currentIndex = currentChapter.segments.findIndex(s => s.id === currentSegmentId)
      if (import.meta.env.DEV) {
        logger.debug('[Auto-Play] Current index:', currentIndex)
      }

      if (currentIndex === -1) {
        if (import.meta.env.DEV) {
          logger.warn('[Auto-Play] Segment not found in chapter, stopping')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      // Helper function to find and play next segment (handles pause segments)
      const playNextSegmentInAutoPlay = (startIndex: number) => {
        if (startIndex >= currentChapter.segments.length) {
          if (import.meta.env.DEV) {
            logger.group(
              '🎵 Playback',
              'Reached end of chapter',
              { continuousPlayback: false },
              '#FF9800'
            )
          }
          setContinuousPlayback(false)
          continuousPlaybackRef.current = false
          return
        }

        const nextSegment = currentChapter.segments[startIndex]

        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] Next segment:', {
            index: startIndex,
            segmentId: nextSegment?.id,
            segmentType: nextSegment?.segmentType,
            hasAudio: !!nextSegment?.audioPath,
            pauseDuration: nextSegment?.pauseDuration
          })
        }

        // Check if it's a divider (pause) segment
        if (nextSegment?.segmentType === 'divider') {
          const pauseDuration = nextSegment?.pauseDuration || 0
          if (import.meta.env.DEV) {
            logger.debug(`[Auto-Play] Pause segment detected, waiting ${pauseDuration}ms`)
          }

          // Clear any existing pause timeout
          if (pauseTimeoutRef.current) {
            clearTimeout(pauseTimeoutRef.current)
            pauseTimeoutRef.current = null
          }

          // Wait for pause duration, then continue to next segment
          pauseTimeoutRef.current = setTimeout(() => {
            // Check if continuous playback is still active
            if (!continuousPlaybackRef.current) {
              if (import.meta.env.DEV) {
                logger.debug('[Auto-Play] Continuous playback stopped during pause, aborting')
              }
              pauseTimeoutRef.current = null
              return
            }

            pauseTimeoutRef.current = null
            playNextSegmentInAutoPlay(startIndex + 1)
          }, pauseDuration)
          return
        }

        // It's a regular audio segment
        if (nextSegment?.audioPath) {
          setTimeout(() => {
            if (import.meta.env.DEV) {
              logger.debug('[Auto-Play] Playing audio segment:', nextSegment.id)
            }
            // Use the ref to ensure we always call the latest version of the function
            handlePlaySegmentRef.current?.(nextSegment, true)  // Continue continuous playback
          }, pauseBetweenSegments)
        } else {
          // Skip segments without audio (shouldn't happen in normal operation)
          if (import.meta.env.DEV) {
            logger.group(
              '🎵 Playback',
              'Skipping segment without audio',
              { segmentId: nextSegment?.id, tryingNext: true },
              '#FF9800'
            )
          }
          playNextSegmentInAutoPlay(startIndex + 1)
        }
      }

      // Start auto-play from next segment
      playNextSegmentInAutoPlay(currentIndex + 1)
    }

    audio.onerror = (e) => {
      // Ignore errors if no segment is currently playing
      // This can happen after disconnect when the audio src is still set to a backend URL
      if (!currentPlayingSegmentIdRef.current) {
        if (import.meta.env.DEV) {
          logger.debug('[Audio] Error ignored (no active segment):', e)
        }
        return
      }

      logger.error('[Audio] Playback error:', e)
      alert(t('appLayout.audioPlaybackError'))
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false
    }

    // Play and update state
    audio.play().catch((err) => {
      // Ignore AbortError - this happens when quickly skipping between segments
      // The browser aborts the previous play() when we start a new one
      if (err.name === 'AbortError') {
        if (import.meta.env.DEV) {
          logger.debug('[PlaySegment] Play aborted (normal during fast skipping)')
        }
        return
      }

      // Real playback error - show alert
      logger.error('[Audio] Failed to play:', err)
      alert(t('appLayout.audioPlaybackErrorDetailed', { message: err.message }))
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false
    })

    setPlayingSegmentId(segment.id)
    currentPlayingSegmentIdRef.current = segment.id
  }

  // Public wrapper function that always uses the latest version via ref
  // This avoids closure issues with recursive calls by using the ref
  const handlePlaySegment = (segment: Segment, continuous = false) => {
    handlePlaySegmentRef.current?.(segment, continuous)
  }

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
  // NORMAL RENDER
  // ============================================================================

  return (
    <>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedChapterId={selectedChapterId}
          expandedProjects={expandedProjects}
          onSelectProject={handleSelectProject}
          onSelectChapter={setSelectedChapterId}
          onToggleProject={toggleProject}
          onCreateProject={handleCreateProject}
          onCreateChapter={handleCreateChapter}
          onEditProject={handleEditProject}
          onEditChapter={handleEditChapter}
          onDeleteProject={handleDeleteProject}
          onDeleteChapter={handleDeleteChapter}
          width={SIDEBAR_WIDTH}
        />

        {/* Main Content Area */}
        <Box
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Engine & Model Selector Header */}
          <Box
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              px: 3,
              py: 2,
              bgcolor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            {/* Left side: Engine & Model Selectors */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              {/* Engine Selector */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                  {t('appLayout.engine')}:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <Select
                    value={safeEngineValue}
                    onChange={(e) => {
                      const newEngine = e.target.value
                      setSessionOverride('ttsEngine', newEngine)
                      // Note: Backend notification happens automatically via useEffect
                    }}
                    disabled={enginesLoading || engines.length === 0}
                    displayEmpty
                  >
                    {enginesLoading ? (
                      <MenuItem value="">{t('appLayout.loading')}</MenuItem>
                    ) : engines.length === 0 ? (
                      <MenuItem value="">{t('appLayout.noEngines')}</MenuItem>
                    ) : (
                      engines.map((engine) => (
                        <MenuItem key={engine.name} value={engine.name}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography>{engine.displayName}</Typography>
                            {engine.modelLoaded && (
                              <Chip label={t('appLayout.loaded')} size="small" color="success" sx={{ height: 18, fontSize: '0.7rem' }} />
                            )}
                          </Box>
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Box>

              {/* Model Selector */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                  {t('appLayout.model')}:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <Select
                    value={safeModelValue}
                    onChange={(e) => {
                      const newModel = e.target.value
                      setSessionOverride('ttsModelName', newModel)
                      // Note: Backend notification happens automatically via useEffect
                    }}
                    disabled={modelsLoading || !currentEngine || models.length === 0}
                    displayEmpty
                  >
                    {modelsLoading ? (
                      <MenuItem value="">{t('appLayout.loading')}</MenuItem>
                    ) : models.length === 0 ? (
                      <MenuItem value="">{t('appLayout.noModels')}</MenuItem>
                    ) : (
                      models.map((model) => (
                        <MenuItem key={model.modelName} value={model.modelName}>
                          {model.displayName}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Box>

              {/* Languages Info */}
              {!enginesLoading && engines.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('appLayout.languagesCount', {
                    count: engines.find(e => e.name === currentEngine)?.supportedLanguages?.length || 0
                  })}
                </Typography>
              )}
            </Box>

            {/* Right side: Jobs Badge, Settings & Disconnect Button */}
            <Box display="flex" gap={1} alignItems="center">
              {/* SSE Connection Status Indicator */}
              {sseConnection.connectionType === 'sse' && sseConnection.status === 'connected' && (
                <Chip
                  label="Real-time"
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ ml: 1 }}
                />
              )}
              {sseConnection.connectionType === 'polling' && (
                <Chip
                  label="Polling"
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ ml: 1 }}
                />
              )}

              {/* Jobs Badge */}
              <IconButton
                onClick={() => setJobsPanelOpen(true)}
                color="inherit"
                title={t('appLayout.jobs.title')}
              >
                <Badge badgeContent={activeJobsCount} color="primary">
                  <JobsIcon />
                </Badge>
              </IconButton>

              <IconButton
                onClick={() => setSettingsDialogOpen(true)}
                color="inherit"
                title={t('appLayout.settings')}
              >
                <SettingsIcon />
              </IconButton>
              <DisconnectButton />
            </Box>
          </Box>

          {/* Chapter View */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: 'auto',
              pb: 2,
            }}
          >
            <ErrorBoundary context="ChapterView" critical={false}>
              <ChapterView
                project={selectedProject}
                chapter={selectedChapter}
                onCreateChapter={() => selectedProjectId && handleCreateChapter(selectedProjectId)}
                onChapterSelect={setSelectedChapterId}
                selectedSegmentId={selectedSegmentId}
                onSegmentSelect={setSelectedSegmentId}
                playingSegmentId={playingSegmentId}
                continuousPlayback={continuousPlayback}
                onPlaySegment={handlePlaySegment}
              />
            </ErrorBoundary>
          </Box>

          {/* Audio Player - Fixed at bottom */}
          <Box
            sx={{
              height: PLAYER_HEIGHT,
              borderTop: 1,
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <ErrorBoundary context="AudioPlayer" critical={false}>
              <AudioPlayer
              chapter={selectedChapter}
              selectedSegmentId={selectedSegmentId}
              playingSegmentId={playingSegmentId}
              audioRef={audioRef}
              onPlaySegment={handlePlaySegment}
              onStopPlayback={() => {
                const audio = audioRef.current
                audio.pause()
                audio.currentTime = 0
                setPlayingSegmentId(null)
                currentPlayingSegmentIdRef.current = null
                setContinuousPlayback(false)
                continuousPlaybackRef.current = false

                // Clear any pending pause timeout
                if (pauseTimeoutRef.current) {
                  clearTimeout(pauseTimeoutRef.current)
                  pauseTimeoutRef.current = null
                }
              }}
            />
            </ErrorBoundary>
          </Box>
        </Box>
      </Box>

      {/* Dialogs */}
      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSave={handleSaveProject}
        onImportSuccess={(project) => {
          // Automatically select the imported project
          setSelectedProjectId(project.id)
          // Expand the project to show chapters
          const newExpanded = new Set(expandedProjects)
          newExpanded.add(project.id)
          setExpandedProjects(newExpanded)
          // Refetch projects to update cache
          refetch()
        }}
        initialData={editingProject ? {
          title: editingProject.title,
          description: editingProject.description || ''
        } : undefined}
        mode={editingProject ? 'edit' : 'create'}
      />

      <ChapterDialog
        open={chapterDialogOpen}
        onClose={() => setChapterDialogOpen(false)}
        onSave={handleSaveChapter}
        initialData={editingChapter ? {
          title: editingChapter.title,
          orderIndex: editingChapter.orderIndex
        } : undefined}
        mode={editingChapter ? 'edit' : 'create'}
        nextOrderIndex={selectedProject?.chapters.length || 0}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => {
          setSettingsDialogOpen(false)
          setSettingsInitialTab(0) // Reset to first tab when closing
          // Invalidate settings and speakers to refresh cache after dialog closes
          // This ensures speaker sample uploads are reflected (e.g., first sample activating default speaker)
          queryClient.invalidateQueries({ queryKey: ['settings'] })
          queryClient.invalidateQueries({ queryKey: ['speakers'] })
        }}
        initialTab={settingsInitialTab}
      />

      {/* Jobs Panel Dialog */}
      <JobsPanelDialog
        open={jobsPanelOpen}
        onClose={() => setJobsPanelOpen(false)}
      />

      {/* No Speakers Overlay - Only show after speakers have loaded */}
      {!speakersLoading && !hasSpeakers && !settingsDialogOpen && (
        <NoSpeakersOverlay
          onOpenSettings={() => {
            setSettingsInitialTab(4) // Tab index 4 = Speakers tab
            setSettingsDialogOpen(true)
          }}
        />
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog />
    </>
  )
}
