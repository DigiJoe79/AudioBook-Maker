import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@store/appStore'
import { useDebouncedCallback } from '@hooks/useDebouncedCallback'
import { useSpeakers } from '@hooks/useTTSQuery'
import { useNavigationStore } from '@store/navigationStore'
import { logger } from '@utils/logger'
import type { SessionState, Project } from '@types'

interface UseAppLayoutSessionOptions {
  projects: Project[]
  isLoading: boolean
}

interface UseAppLayoutSessionReturn {
  // Selection state
  selectedProjectId: string | null
  selectedChapterId: string | null
  expandedProjects: Set<string>
  sessionRestored: boolean

  // Selection handlers
  setSelectedProjectId: (id: string | null) => void
  setSelectedChapterId: (id: string | null) => void
  handleSelectProject: (projectId: string) => void
  handleDeselectChapter: () => void
  toggleProject: (projectId: string) => void

  // Computed values
  selectedProject: Project | undefined
}

/**
 * Hook for managing AppLayout session state
 *
 * Responsibilities:
 * - Restore session state on mount (selectedProject, selectedChapter, expandedProjects)
 * - Save session state on changes (debounced)
 * - Handle project/chapter selection
 * - Track and restore chapter selection after data refresh
 * - Auto-navigate to Speakers view if no speakers exist
 * - Handle imported project auto-selection from sessionStorage
 */
export function useAppLayoutSession({
  projects,
  isLoading,
}: UseAppLayoutSessionOptions): UseAppLayoutSessionReturn {
  // Session state management from appStore
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  // Navigation
  const currentView = useNavigationStore((state) => state.currentView)
  const navigateTo = useNavigationStore((state) => state.navigateTo)

  // Speakers for auto-navigation check
  const { data: speakers = [], isLoading: speakersLoading } = useSpeakers()

  // State
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [sessionRestored, setSessionRestored] = useState(false)

  // Refs for tracking
  const lastSelectedChapterRef = useRef<string | null>(null)
  const hasCheckedSpeakers = useRef(false)

  // Refs for stable session save callback (avoid recreating on every render)
  const sessionStateRef = useRef({
    selectedProjectId,
    selectedChapterId,
    expandedProjects,
  })

  // Keep ref in sync with current state (for stable callback)
  useEffect(() => {
    sessionStateRef.current = {
      selectedProjectId,
      selectedChapterId,
      expandedProjects,
    }
  }, [selectedProjectId, selectedChapterId, expandedProjects])

  // Computed values
  const selectedProject = projects.find(p => p.id === selectedProjectId)

  // Track chapter selection
  useEffect(() => {
    if (selectedChapterId) {
      lastSelectedChapterRef.current = selectedChapterId
    }
  }, [selectedChapterId])

  // Restore chapter selection after data refresh
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

  // Restore session state on mount (wait for projects to validate chapter existence)
  useEffect(() => {
    if (sessionRestored) return
    // Wait for projects to load before restoring to validate chapter existence
    if (isLoading) return

    const session = restoreSessionState()
    if (session) {
      logger.group('📱 Layout', 'Restoring previous session', {
        'Project ID': session.selectedProjectId,
        'Chapter ID': session.selectedChapterId,
        'Expanded Projects': session.expandedProjects.length
      }, '#2196F3')

      if (session.selectedProjectId) {
        setSelectedProjectId(session.selectedProjectId)
      }
      // Only restore chapter if it still exists in the project
      // This prevents 404 fetches for deleted chapters from stale session state
      if (session.selectedChapterId) {
        const project = projects.find(p => p.id === session.selectedProjectId)
        const chapterExists = project?.chapters.some(c => c.id === session.selectedChapterId)
        if (chapterExists) {
          setSelectedChapterId(session.selectedChapterId)
        } else {
          logger.info('[Session] Skipping restore of deleted chapter:', session.selectedChapterId)
        }
      }
      if (session.expandedProjects.length > 0) {
        setExpandedProjects(new Set(session.expandedProjects))
      }
    }

    setSessionRestored(true)
  }, [restoreSessionState, sessionRestored, isLoading, projects])

  // Handle imported project from sessionStorage
  useEffect(() => {
    if (!sessionRestored || !projects.length) return

    const importedProjectId = sessionStorage.getItem('selectedProjectId')
    if (importedProjectId) {
      const projectExists = projects.some(p => p.id === importedProjectId)
      if (projectExists) {
        logger.group('📥 Import', 'Auto-selecting imported project', {
          'Project ID': importedProjectId
        }, '#4CAF50')

        setSelectedProjectId(importedProjectId)
        setSelectedChapterId(null)
        setExpandedProjects(prev => new Set(prev).add(importedProjectId))
      }
      sessionStorage.removeItem('selectedProjectId')
    }
  }, [sessionRestored, projects])

  // Auto-navigate to Speakers view if no speakers
  useEffect(() => {
    if (hasCheckedSpeakers.current || speakersLoading) {
      return
    }

    if (speakers.length === 0 && currentView !== 'speakers') {
      logger.info('[AppLayout] No speakers found - navigating to Speakers view')
      navigateTo('speakers')
    }

    hasCheckedSpeakers.current = true
  }, [speakers, speakersLoading, currentView, navigateTo])

  // Save session state (debounced) - stable callback using ref
  const saveSessionCallback = useCallback(() => {
    const { selectedProjectId, selectedChapterId, expandedProjects } = sessionStateRef.current
    const state: SessionState = {
      selectedProjectId,
      selectedChapterId,
      selectedSegmentId: null,
      expandedProjects: Array.from(expandedProjects),
      timestamp: new Date(),
    }
    saveSessionState(state)
  }, [saveSessionState])

  const saveSessionDebounced = useDebouncedCallback(saveSessionCallback, 1000)

  useEffect(() => {
    if (sessionRestored) {
      saveSessionDebounced()
    }
    // Only trigger on actual value changes, not on callback reference changes
  }, [selectedProjectId, selectedChapterId, expandedProjects, sessionRestored])

  // Handlers
  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setSelectedChapterId(null)
    lastSelectedChapterRef.current = null
  }, [])

  const handleDeselectChapter = useCallback(() => {
    setSelectedChapterId(null)
    lastSelectedChapterRef.current = null
  }, [])

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const newExpanded = new Set(prev)
      if (newExpanded.has(projectId)) {
        newExpanded.delete(projectId)
      } else {
        newExpanded.add(projectId)
      }
      return newExpanded
    })
  }, [])

  return {
    selectedProjectId,
    selectedChapterId,
    expandedProjects,
    sessionRestored,
    setSelectedProjectId,
    setSelectedChapterId,
    handleSelectProject,
    handleDeselectChapter,
    toggleProject,
    selectedProject,
  }
}