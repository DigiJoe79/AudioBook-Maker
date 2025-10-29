import { Box, Typography, Alert, Button, Select, MenuItem, FormControl, Chip, IconButton } from '@mui/material'
import { Settings as SettingsIcon } from '@mui/icons-material'
import { useState, useEffect, useRef } from 'react'
import ProjectSidebar from '../Sidebar/ProjectSidebar'
import ChapterView from '../chapter/ChapterView'
import AudioPlayer from '../AudioPlayer/AudioPlayer'
import { ErrorBoundary } from '../ErrorBoundary'
import { Project, Chapter, Segment } from '../../types'
import { ProjectDialog } from '../dialogs/ProjectDialog'
import { ChapterDialog } from '../dialogs/ChapterDialog'
import SettingsDialog from '../dialogs/SettingsDialog'
import { useProjectsList, useCreateProject, useUpdateProject, useDeleteProject } from '../../hooks/useProjectsQuery'
import { useCreateChapter, useUpdateChapter, useDeleteChapter, useChapter } from '../../hooks/useChaptersQuery'
import { useTTSEngines, useTTSModels } from '../../hooks/useTTSQuery'
import { useAppStore } from '../../store/appStore'
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback'
import type { SessionState } from '../../types/backend'
import { DisconnectButton } from '../DisconnectButton'
import { useConfirm } from '../../hooks/useConfirm'
import { useTranslation } from 'react-i18next'
import { NoSpeakersOverlay } from '../overlays/NoSpeakersOverlay'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSpeakers } from '../../services/settingsApi'
import { useChapterGenerationMonitor } from '../../hooks/useChapterGenerationMonitor'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/typeGuards'

const SIDEBAR_WIDTH = 280
const PLAYER_HEIGHT = 120

export default function AppLayout() {

  const { t } = useTranslation()

  const queryClient = useQueryClient()
  const { data: projects = [], isLoading, error, refetch } = useProjectsList()
  const createProjectMutation = useCreateProject()
  const updateProjectMutation = useUpdateProject()
  const deleteProjectMutation = useDeleteProject()
  const createChapterMutation = useCreateChapter()
  const updateChapterMutation = useUpdateChapter()
  const deleteChapterMutation = useDeleteChapter()
  const { data: engines = [], isLoading: enginesLoading } = useTTSEngines()

  const currentEngine = useAppStore((state) => state.getCurrentEngine())
  const currentModelName = useAppStore((state) => state.getCurrentModelName())
  const setSessionOverride = useAppStore((state) => state.setSessionOverride)

  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  const settings = useAppStore((state) => state.settings)
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500

  const { data: models = [], isLoading: modelsLoading } = useTTSModels(currentEngine)

  const { data: speakers = [], isLoading: speakersLoading } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  })
  const hasSpeakers = speakers.filter(s => s.isActive).length > 0

  const { confirm, ConfirmDialog } = useConfirm()

  useChapterGenerationMonitor()

  const safeModelValue = models.length > 0 && models.some(m => m.modelName === currentModelName)
    ? currentModelName
    : ''

  useEffect(() => {
    if (models.length > 0) {
      const modelExists = models.some(m => m.modelName === currentModelName)
      if (!modelExists) {
        setSessionOverride('modelName', models[0].modelName)
      }
    } else if (currentModelName) {
      setSessionOverride('modelName', '')
    }
  }, [models, currentModelName, setSessionOverride])


  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null)
  const [continuousPlayback, setContinuousPlayback] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<number>(0)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [sessionRestored, setSessionRestored] = useState(false)

  const { data: liveChapter } = useChapter(selectedChapterId, {
    forcePolling: !!playingSegmentId,
    pollingInterval: 1000,
  })

  const lastSelectedChapterRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const selectedChapterRef = useRef<typeof selectedChapter>(undefined)
  const currentPlayingSegmentIdRef = useRef<string | null>(null)
  const continuousPlaybackRef = useRef<boolean>(false)
  const handlePlaySegmentRef = useRef<((segment: Segment, continuous?: boolean) => void) | undefined>(undefined)
  const pauseTimeoutRef = useRef<number | null>(null)

  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedChapterFromProject = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  const selectedChapter = liveChapter || selectedChapterFromProject

  useEffect(() => {
    if (selectedChapterId) {
      lastSelectedChapterRef.current = selectedChapterId
    }
  }, [selectedChapterId])

  useEffect(() => {
    if (!lastSelectedChapterRef.current || !selectedProject) {
      return
    }

    const chapterStillExists = selectedProject.chapters.some(
      c => c.id === lastSelectedChapterRef.current
    )

    if (chapterStillExists && !selectedChapterId) {
      setSelectedChapterId(lastSelectedChapterRef.current)
    } else if (!chapterStillExists) {
      lastSelectedChapterRef.current = null
      setSelectedChapterId(null)
    }
  }, [projects, selectedProject, selectedChapterId])

  useEffect(() => {
    selectedChapterRef.current = selectedChapter
  }, [selectedChapter])

  useEffect(() => {
    handlePlaySegmentRef.current = handlePlaySegmentInternal
  })

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      audio.pause()
      audio.src = ''
      audio.load()
    }
  }, [])



  useEffect(() => {
    if (sessionRestored) return

    const session = restoreSessionState()
    if (session) {
      logger.info('[AppLayout] Restoring previous session:', session)

      if (session.selectedProjectId) {
        setSelectedProjectId(session.selectedProjectId)
      }
      if (session.selectedChapterId) {
        setSelectedChapterId(session.selectedChapterId)
      }
      if (session.selectedSegmentId) {
        setSelectedSegmentId(session.selectedSegmentId)
      }

      if (session.expandedProjects.length > 0) {
        setExpandedProjects(new Set(session.expandedProjects))
      }
    }

    setSessionRestored(true)
  }, [restoreSessionState, sessionRestored])

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
    if (sessionRestored) {
      saveSessionDebounced()
    }
  }, [selectedProjectId, selectedChapterId, selectedSegmentId, expandedProjects, sessionRestored, saveSessionDebounced])


  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId)
    setSelectedChapterId(null)
    lastSelectedChapterRef.current = null
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
      await updateProjectMutation.mutateAsync({
        id: editingProject.id,
        data
      })
    } else {
      const newProject = await createProjectMutation.mutateAsync(data)
      setSelectedProjectId(newProject.id)
    }
  }

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
      await updateChapterMutation.mutateAsync({
        id: editingChapter.id,
        data
      })
      return
    }

    if (!selectedProjectId) return

    const project = projects.find(p => p.id === selectedProjectId)
    const isFirstChapter = project?.chapters.length === 0

    const newChapter = await createChapterMutation.mutateAsync({
      projectId: selectedProjectId,
      defaultEngine: currentEngine,
      defaultModelName: currentModelName,
      ...data,
    })

    if (isFirstChapter) {
      const newExpanded = new Set(expandedProjects)
      newExpanded.add(selectedProjectId)
      setExpandedProjects(newExpanded)
    }

    setTimeout(() => {
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
      setSelectedProjectId(null)
      setSelectedChapterId(null)
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

    const project = projects.find(p => p.chapters.some(c => c.id === chapterId))
    if (!project) {
      logger.error('[AppLayout] Could not find project for chapter:', chapterId)
      return
    }

    try {
      await deleteChapterMutation.mutateAsync({ chapterId, projectId: project.id })
      setSelectedChapterId(null)
    } catch (err) {
      logger.error('[AppLayout] Failed to delete chapter:', getErrorMessage(err))
      alert(t('chapters.messages.error'))
    }
  }

  const handlePlaySegmentInternal = (segment: Segment, continuous = false) => {
    if (!segment.audioPath) return

    const audioPath = segment.audioPath
    const audio = audioRef.current

    if (import.meta.env.DEV) {
      logger.debug('[PlaySegment] Starting playback', {
        segmentId: segment.id,
        continuous,
        mode: continuous ? 'AUTOPLAY MODE' : 'SINGLE SEGMENT MODE'
      })
    }
    setContinuousPlayback(continuous)
    continuousPlaybackRef.current = continuous

    if (playingSegmentId === segment.id) {
      audio.pause()
      audio.currentTime = 0
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false

      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current)
        pauseTimeoutRef.current = null
      }
      return
    }

    audio.pause()
    audio.currentTime = 0

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }

    audio.onended = null
    audio.onerror = null

    audio.src = audioPath
    audio.load()

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

      const playNextSegmentInAutoPlay = (startIndex: number) => {
        if (startIndex >= currentChapter.segments.length) {
          if (import.meta.env.DEV) {
            logger.info('[Auto-Play] Reached end of chapter, stopping')
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

        if (nextSegment?.segmentType === 'divider') {
          const pauseDuration = nextSegment?.pauseDuration || 0
          if (import.meta.env.DEV) {
            logger.debug(`[Auto-Play] Pause segment detected, waiting ${pauseDuration}ms`)
          }

          if (pauseTimeoutRef.current) {
            clearTimeout(pauseTimeoutRef.current)
            pauseTimeoutRef.current = null
          }

          pauseTimeoutRef.current = setTimeout(() => {
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

        if (nextSegment?.audioPath) {
          setTimeout(() => {
            if (import.meta.env.DEV) {
              logger.debug('[Auto-Play] Playing audio segment:', nextSegment.id)
            }
            handlePlaySegmentRef.current?.(nextSegment, true)
          }, pauseBetweenSegments)
        } else {
          if (import.meta.env.DEV) {
            logger.debug('[Auto-Play] Skipping segment without audio, trying next')
          }
          playNextSegmentInAutoPlay(startIndex + 1)
        }
      }

      playNextSegmentInAutoPlay(currentIndex + 1)
    }

    audio.onerror = (e) => {
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

    audio.play().catch((err) => {
      if (err.name === 'AbortError') {
        if (import.meta.env.DEV) {
          logger.debug('[PlaySegment] Play aborted (normal during fast skipping)')
        }
        return
      }

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

  const handlePlaySegment = (segment: Segment, continuous = false) => {
    handlePlaySegmentRef.current?.(segment, continuous)
  }


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


  return (
    <>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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

        <Box
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                  {t('appLayout.engine')}:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <Select
                    value={currentEngine}
                    onChange={(e) => setSessionOverride('engine', e.target.value)}
                    disabled={enginesLoading}
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

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                  {t('appLayout.model')}:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <Select
                    value={safeModelValue}
                    onChange={(e) => setSessionOverride('modelName', e.target.value)}
                    disabled={modelsLoading || !currentEngine}
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

              {!enginesLoading && engines.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('appLayout.languagesCount', {
                    count: engines.find(e => e.name === currentEngine)?.supportedLanguages?.length || 0
                  })}
                </Typography>
              )}
            </Box>

            <Box display="flex" gap={1} alignItems="center">
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

      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSave={handleSaveProject}
        onImportSuccess={(project) => {
          setSelectedProjectId(project.id)
          const newExpanded = new Set(expandedProjects)
          newExpanded.add(project.id)
          setExpandedProjects(newExpanded)
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

      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => {
          setSettingsDialogOpen(false)
          setSettingsInitialTab(0)
          queryClient.invalidateQueries({ queryKey: ['settings'] })
          queryClient.invalidateQueries({ queryKey: ['speakers'] })
        }}
        initialTab={settingsInitialTab}
      />

      {!speakersLoading && !hasSpeakers && !settingsDialogOpen && (
        <NoSpeakersOverlay
          onOpenSettings={() => {
            setSettingsInitialTab(4)
            setSettingsDialogOpen(true)
          }}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
