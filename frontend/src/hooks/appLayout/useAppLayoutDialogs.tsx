import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Warning as WarningIcon } from '@mui/icons-material'
import { useCreateProject, useUpdateProject, useDeleteProject } from '@hooks/useProjectsQuery'
import { useCreateChapter, useUpdateChapter, useDeleteChapter } from '@hooks/useChaptersQuery'
import { useConfirm } from '@hooks/useConfirm'
import { useError } from '@hooks/useError'
import { useSnackbar } from '@hooks/useSnackbar'
import { pronunciationApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import { logger } from '@utils/logger'
import { getErrorMessage } from '@utils/typeGuards'
import { translateBackendError } from '@utils/translateBackendError'
import type { Project, Chapter } from '@types'

interface UseAppLayoutDialogsOptions {
  projects: Project[]
  selectedProjectId: string | null
  selectedProject: Project | undefined
  expandedProjects: Set<string>
  defaultEngine: string
  defaultModelName: string
  setSelectedProjectId: (id: string | null) => void
  setSelectedChapterId: (id: string | null) => void
  setExpandedProjects: React.Dispatch<React.SetStateAction<Set<string>>>
}

interface UseAppLayoutDialogsReturn {
  // Dialog state
  projectDialogOpen: boolean
  chapterDialogOpen: boolean
  editingProject: Project | null
  editingChapter: Chapter | null

  // Dialog handlers
  handleCreateProject: () => void
  handleEditProject: (projectId: string) => void
  handleSaveProject: (data: { title: string; description: string }) => Promise<void>
  handleDeleteProject: (projectId: string, projectTitle: string) => Promise<void>
  handleCreateChapter: (projectId: string) => void
  handleEditChapter: (chapterId: string) => void
  handleSaveChapter: (data: { title: string; orderIndex: number }) => Promise<void>
  handleDeleteChapter: (chapterId: string, chapterTitle: string) => Promise<void>
  closeProjectDialog: () => void
  closeChapterDialog: () => void

  // UI Components (must be rendered)
  ConfirmDialog: React.ComponentType
  ErrorDialog: React.ComponentType
  SnackbarComponent: React.ComponentType

  // Snackbar for external use
  showSnackbar: (message: string, options?: { severity?: 'success' | 'error' | 'warning' | 'info' }) => void
}

/**
 * Hook for managing AppLayout dialogs
 *
 * Responsibilities:
 * - Project dialog state and handlers (create/edit/delete)
 * - Chapter dialog state and handlers (create/edit/delete)
 * - Confirmation dialogs
 * - Error dialogs
 * - Snackbar notifications
 */
export function useAppLayoutDialogs({
  projects,
  selectedProjectId,
  selectedProject,
  expandedProjects,
  defaultEngine,
  defaultModelName,
  setSelectedProjectId,
  setSelectedChapterId,
  setExpandedProjects,
}: UseAppLayoutDialogsOptions): UseAppLayoutDialogsReturn {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // Mutations
  const createProjectMutation = useCreateProject()
  const updateProjectMutation = useUpdateProject()
  const deleteProjectMutation = useDeleteProject()
  const createChapterMutation = useCreateChapter()
  const updateChapterMutation = useUpdateChapter()
  const deleteChapterMutation = useDeleteChapter()

  // Dialogs and notifications
  const { confirm, ConfirmDialog } = useConfirm()
  const { showError, ErrorDialog } = useError()
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  // Dialog state
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)

  // Project handlers
  const handleCreateProject = useCallback(() => {
    setEditingProject(null)
    setProjectDialogOpen(true)
  }, [])

  const handleEditProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setEditingProject(project)
      setProjectDialogOpen(true)
    }
  }, [projects])

  const handleSaveProject = useCallback(async (data: { title: string; description: string }) => {
    try {
      if (editingProject) {
        await updateProjectMutation.mutateAsync({
          id: editingProject.id,
          data
        })
        showSnackbar(t('projects.messages.updated'), { severity: 'success' })
      } else {
        const newProject = await createProjectMutation.mutateAsync(data)
        setSelectedProjectId(newProject.id)
        showSnackbar(t('projects.messages.created'), { severity: 'success' })
      }
    } catch (err) {
      logger.error('[AppLayout] Failed to save project', { error: getErrorMessage(err) })
      showSnackbar(
        editingProject ? t('projects.messages.updateFailed') : t('projects.messages.createFailed'),
        { severity: 'error' }
      )
    }
  }, [editingProject, updateProjectMutation, createProjectMutation, showSnackbar, t, setSelectedProjectId])

  const handleDeleteProject = useCallback(async (projectId: string, projectTitle: string) => {
    // Fetch pronunciation rules count
    const rulesCountQuery = await queryClient.fetchQuery({
      queryKey: queryKeys.pronunciation.projectCount(projectId),
      queryFn: async () => {
        try {
          const result = await pronunciationApi.getRules({ projectId })
          return result.rules.length
        } catch {
          return 0
        }
      }
    })

    const rulesCount = rulesCountQuery || 0

    let confirmMessage = t('appLayout.deleteProjectConfirm', { title: projectTitle })
    if (rulesCount > 0) {
      confirmMessage += `\n\n⚠️ ${rulesCount} ${rulesCount === 1 ? 'Aussprache-Regel' : 'Aussprache-Regeln'} ${rulesCount === 1 ? 'wird' : 'werden'} ebenfalls gelöscht.`
    }

    const confirmed = await confirm(
      t('projects.delete'),
      confirmMessage,
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )
    if (!confirmed) return

    try {
      await deleteProjectMutation.mutateAsync(projectId)
      setSelectedProjectId(null)
      setSelectedChapterId(null)
      showSnackbar(t('projects.messages.deleted'), { severity: 'success' })
    } catch (err: unknown) {
      logger.error('[AppLayout] Failed to delete project', { error: getErrorMessage(err) })
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('projects.messages.error'),
        t
      )
      await showError(t('projects.delete'), errorMessage)
    }
  }, [queryClient, confirm, deleteProjectMutation, showSnackbar, showError, t, setSelectedProjectId, setSelectedChapterId])

  // Chapter handlers
  const handleCreateChapter = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setEditingChapter(null)
    setChapterDialogOpen(true)
  }, [setSelectedProjectId])

  const handleEditChapter = useCallback((chapterId: string) => {
    const project = projects.find(p => p.chapters.some(c => c.id === chapterId))
    const chapter = project?.chapters.find(c => c.id === chapterId)
    if (chapter && project) {
      setSelectedProjectId(project.id)
      setEditingChapter(chapter)
      setChapterDialogOpen(true)
    }
  }, [projects, setSelectedProjectId])

  const handleSaveChapter = useCallback(async (data: { title: string; orderIndex: number }) => {
    try {
      if (editingChapter) {
        await updateChapterMutation.mutateAsync({
          id: editingChapter.id,
          data
        })
        showSnackbar(t('chapters.messages.updated'), { severity: 'success' })
        return
      }

      if (!selectedProjectId) return

      const project = projects.find(p => p.id === selectedProjectId)
      const isFirstChapter = project?.chapters.length === 0

      const newChapter = await createChapterMutation.mutateAsync({
        projectId: selectedProjectId,
        ...data,
      })

      showSnackbar(t('chapters.messages.created'), { severity: 'success' })

      if (isFirstChapter) {
        setExpandedProjects(prev => new Set(prev).add(selectedProjectId))
      }

      setTimeout(() => {
        setSelectedChapterId(newChapter.id)
      }, 50)
    } catch (err) {
      logger.error('[AppLayout] Failed to save chapter', { error: getErrorMessage(err) })
      showSnackbar(
        editingChapter ? t('chapters.messages.updateFailed') : t('chapters.messages.createFailed'),
        { severity: 'error' }
      )
    }
  }, [editingChapter, updateChapterMutation, createChapterMutation, selectedProjectId, projects, defaultEngine, defaultModelName, showSnackbar, t, setExpandedProjects, setSelectedChapterId])

  const handleDeleteChapter = useCallback(async (chapterId: string, chapterTitle: string) => {
    const confirmed = await confirm(
      t('chapters.delete'),
      t('appLayout.deleteChapterConfirm', { title: chapterTitle }),
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )
    if (!confirmed) return

    const project = projects.find(p => p.chapters.some(c => c.id === chapterId))
    if (!project) {
      logger.error('[AppLayout] Could not find project for chapter', { chapterId })
      return
    }

    try {
      await deleteChapterMutation.mutateAsync({ chapterId, projectId: project.id })
      setSelectedChapterId(null)
      showSnackbar(t('chapters.messages.deleted'), { severity: 'success' })
    } catch (err: unknown) {
      logger.error('[AppLayout] Failed to delete chapter', { error: getErrorMessage(err) })
      const errorMessage = translateBackendError(
        err instanceof Error ? err.message : t('chapters.messages.error'),
        t
      )
      await showError(t('chapters.delete'), errorMessage)
    }
  }, [confirm, projects, deleteChapterMutation, showSnackbar, showError, t, setSelectedChapterId])

  const closeProjectDialog = useCallback(() => {
    setProjectDialogOpen(false)
  }, [])

  const closeChapterDialog = useCallback(() => {
    setChapterDialogOpen(false)
  }, [])

  return {
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
  }
}