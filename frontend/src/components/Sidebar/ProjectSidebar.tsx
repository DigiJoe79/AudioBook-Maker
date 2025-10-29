import { useState, useMemo } from 'react'
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Collapse,
  Typography,
  IconButton,
  Toolbar,
  Divider,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  ExpandLess,
  ExpandMore,
  Add,
  FolderOpen,
  Description,
  DragIndicator,
} from '@mui/icons-material'
import ProjectMenu from './ProjectMenu'
import ChapterMenu from './ChapterMenu'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Project, Chapter } from '../../types'
import {
  useReorderProjects,
  useReorderChapters,
  useMoveChapter,
} from '../../hooks/useDragDropMutations'

interface ProjectSidebarProps {
  projects: Project[]
  selectedProjectId: string | null
  selectedChapterId: string | null
  expandedProjects: Set<string>
  onSelectProject: (projectId: string) => void
  onSelectChapter: (chapterId: string | null) => void
  onToggleProject: (projectId: string) => void
  onCreateProject?: () => void
  onCreateChapter?: (projectId: string) => void
  onEditProject?: (projectId: string) => void
  onEditChapter?: (chapterId: string) => void
  onDeleteProject?: (projectId: string, projectTitle: string) => void
  onDeleteChapter?: (chapterId: string, chapterTitle: string) => void
  width: number
}

interface DragData {
  type: 'project' | 'chapter'
  id: string
  projectId?: string
}

function SortableProjectItem({
  project,
  isExpanded,
  isSelected,
  onSelect,
  onToggle,
  onSelectChapter,
  onCreateChapter,
  onEdit,
  onDelete,
  children,
}: {
  project: Project
  isExpanded: boolean
  isSelected: boolean
  onSelect: () => void
  onToggle: () => void
  onSelectChapter: (chapterId: string | null) => void
  onCreateChapter?: () => void
  onEdit?: () => void
  onDelete?: () => void
  children: React.ReactNode
}) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project.id,
    data: {
      type: 'project',
      id: project.id,
    } as DragData,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Box ref={setNodeRef} style={style}>
      <ListItem
        disablePadding
        secondaryAction={
          <IconButton
            edge="end"
            size="small"
            onClick={onToggle}
          >
            {isExpanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        }
      >
        <ListItemButton
          selected={isSelected}
          onClick={() => {
            onSelect()
            onSelectChapter(null)
          }}
        >
          <Box
            {...attributes}
            {...listeners}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'grab',
              mr: 0.5,
              '&:active': { cursor: 'grabbing' },
            }}
          >
            <DragIndicator fontSize="small" sx={{ color: 'text.disabled' }} />
          </Box>
          {(onEdit || onDelete) ? (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setMenuAnchorEl(e.currentTarget)
              }}
              sx={{ mr: 0.5, p: 0.5 }}
            >
              <FolderOpen sx={{ fontSize: 20 }} />
            </IconButton>
          ) : (
            <FolderOpen sx={{ mr: 1, fontSize: 20 }} />
          )}
          <ListItemText
            primary={project.title}
            primaryTypographyProps={{
              variant: 'body2',
              fontWeight: 'medium',
            }}
          />
        </ListItemButton>
      </ListItem>

      {(onEdit || onDelete) && (
        <ProjectMenu
          anchorEl={menuAnchorEl}
          open={Boolean(menuAnchorEl)}
          onClose={() => setMenuAnchorEl(null)}
          onEdit={() => onEdit?.()}
          onDelete={() => onDelete?.()}
        />
      )}

      {children}
    </Box>
  )
}

function SortableChapterItem({
  chapter,
  projectId,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  chapter: Chapter
  projectId: string
  isSelected: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: chapter.id,
    data: {
      type: 'chapter',
      id: chapter.id,
      projectId,
    } as DragData,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <>
      <ListItem
        ref={setNodeRef}
        style={style}
        disablePadding
      >
      <ListItemButton
        sx={{ pl: 4 }}
        selected={isSelected}
        onClick={onSelect}
      >
        <Box
          {...attributes}
          {...listeners}
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'grab',
            mr: 0.5,
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <DragIndicator fontSize="small" sx={{ color: 'text.disabled' }} />
        </Box>
        {(onEdit || onDelete) ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAnchorEl(e.currentTarget)
            }}
            sx={{ mr: 0.5, p: 0.5 }}
          >
            <Description sx={{ fontSize: 18 }} />
          </IconButton>
        ) : (
          <Description sx={{ mr: 1, fontSize: 18 }} />
        )}
        <ListItemText
          primary={chapter.title}
          primaryTypographyProps={{
            variant: 'body2',
          }}
        />
      </ListItemButton>
    </ListItem>

      {(onEdit || onDelete) && (
        <ChapterMenu
          anchorEl={menuAnchorEl}
          open={Boolean(menuAnchorEl)}
          onClose={() => setMenuAnchorEl(null)}
          onEdit={() => onEdit?.()}
          onDelete={() => onDelete?.()}
        />
      )}
    </>
  )
}

export default function ProjectSidebar({
  projects,
  selectedProjectId,
  selectedChapterId,
  expandedProjects,
  onSelectProject,
  onSelectChapter,
  onToggleProject,
  onCreateProject,
  onCreateChapter,
  onEditProject,
  onEditChapter,
  onDeleteProject,
  onDeleteChapter,
  width,
}: ProjectSidebarProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const reorderProjects = useReorderProjects()
  const reorderChapters = useReorderChapters()
  const moveChapter = useMoveChapter()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const projectIds = useMemo(() => projects.map(p => p.id), [projects])

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)

    if (!over || active.id === over.id) {
      return
    }

    const activeData = active.data.current as DragData | undefined
    const overData = over.data.current as DragData | undefined

    if (!activeData) return

    if (activeData.type === 'project' && overData?.type === 'project') {
      const oldIndex = projects.findIndex(p => p.id === active.id)
      const newIndex = projects.findIndex(p => p.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      const reordered = [...projects]
      const [movedProject] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, movedProject)

      const projectIds = reordered.map(p => p.id)

      reorderProjects.mutate(projectIds)
      return
    }

    if (
      activeData.type === 'chapter' &&
      overData?.type === 'chapter' &&
      activeData.projectId === overData.projectId
    ) {
      const projectId = activeData.projectId!
      const project = projects.find(p => p.id === projectId)
      if (!project) return

      const chapters = project.chapters
      const oldIndex = chapters.findIndex(c => c.id === active.id)
      const newIndex = chapters.findIndex(c => c.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      const reordered = [...chapters]
      const [movedChapter] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, movedChapter)

      const chapterIds = reordered.map(c => c.id)

      reorderChapters.mutate({ projectId, chapterIds })
      return
    }

    if (
      activeData.type === 'chapter' &&
      overData?.type === 'chapter' &&
      activeData.projectId !== overData.projectId
    ) {
      const sourceProjectId = activeData.projectId!
      const targetProjectId = overData.projectId!
      const chapterId = active.id as string

      const targetProject = projects.find(p => p.id === targetProjectId)
      if (!targetProject) return

      const targetChapters = targetProject.chapters
      const overIndex = targetChapters.findIndex(c => c.id === over.id)
      const newOrderIndex = overIndex !== -1 ? overIndex : targetChapters.length

      moveChapter.mutate({
        chapterId,
        newProjectId: targetProjectId,
        newOrderIndex,
      })
      return
    }

    if (activeData.type === 'chapter' && overData?.type === 'project') {
      const sourceProjectId = activeData.projectId!
      const targetProjectId = over.id as string
      const chapterId = active.id as string

      if (sourceProjectId === targetProjectId) return

      const targetProject = projects.find(p => p.id === targetProjectId)
      if (!targetProject) return

      const newOrderIndex = targetProject.chapters.length

      moveChapter.mutate({
        chapterId,
        newProjectId: targetProjectId,
        newOrderIndex,
      })
      return
    }
  }

  const activeProject = activeId ? projects.find(p => p.id === activeId) : null
  const activeChapter = activeId
    ? projects.flatMap(p => p.chapters).find(c => c.id === activeId)
    : null

  const { t } = useTranslation()

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Drawer
        variant="permanent"
        sx={{
          width,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width,
            boxSizing: 'border-box',
            borderRight: 1,
            borderColor: 'divider',
          },
        }}
      >
        <Toolbar
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            minHeight: '73px !important',
          }}
        >
          <Typography variant="h6" noWrap component="div">
            {t('app.projectsTitle')}
          </Typography>
          <IconButton
            size="small"
            color="primary"
            onClick={onCreateProject}
            title={t('projects.new')}
          >
            <Add />
          </IconButton>
        </Toolbar>
        <Divider />

        <Box sx={{ overflow: 'auto', flexGrow: 1 }}>
          {projects.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                p: 3,
              }}
            >
              <Typography variant="body2" color="text.secondary" align="center">
                {t('projects.noProjects')}
              </Typography>
            </Box>
          ) : (
            <List dense>
              <SortableContext
                items={projectIds}
                strategy={verticalListSortingStrategy}
              >
                {projects.map((project) => (
                  <SortableProjectItem
                    key={project.id}
                    project={project}
                    isExpanded={expandedProjects.has(project.id)}
                    isSelected={selectedProjectId === project.id}
                    onSelect={() => onSelectProject(project.id)}
                    onToggle={() => onToggleProject(project.id)}
                    onSelectChapter={onSelectChapter}
                    onCreateChapter={() => onCreateChapter?.(project.id)}
                    onEdit={() => onEditProject?.(project.id)}
                    onDelete={() => onDeleteProject?.(project.id, project.title)}
                  >
                    <Collapse
                      in={expandedProjects.has(project.id)}
                      timeout="auto"
                      unmountOnExit
                    >
                      <List component="div" disablePadding dense>
                        <SortableContext
                          items={project.chapters.map(c => c.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {project.chapters.map((chapter) => (
                            <SortableChapterItem
                              key={chapter.id}
                              chapter={chapter}
                              projectId={project.id}
                              isSelected={selectedChapterId === chapter.id}
                              onSelect={() => {
                                onSelectProject(project.id)
                                onSelectChapter(chapter.id)
                              }}
                              onEdit={() => onEditChapter?.(chapter.id)}
                              onDelete={() => onDeleteChapter?.(chapter.id, chapter.title)}
                            />
                          ))}
                        </SortableContext>

                        <ListItem disablePadding>
                          <ListItemButton
                            sx={{ pl: 4 }}
                            onClick={() => onCreateChapter?.(project.id)}
                          >
                            <Add sx={{ mr: 1, fontSize: 18, color: 'primary.main' }} />
                            <ListItemText
                              primary={t('chapters.new')}
                              primaryTypographyProps={{
                                variant: 'body2',
                                color: 'primary.main',
                              }}
                            />
                          </ListItemButton>
                        </ListItem>
                      </List>
                    </Collapse>
                  </SortableProjectItem>
                ))}
              </SortableContext>
            </List>
          )}
        </Box>
      </Drawer>

      <DragOverlay>
        {activeProject && (
          <Box
            sx={{
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'primary.main',
              borderRadius: 1,
              p: 1,
              boxShadow: 3,
              display: 'flex',
              alignItems: 'center',
              minWidth: 200,
            }}
          >
            <FolderOpen sx={{ mr: 1, fontSize: 20 }} />
            <Typography variant="body2" fontWeight="medium">
              {activeProject.title}
            </Typography>
          </Box>
        )}
        {activeChapter && (
          <Box
            sx={{
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'primary.main',
              borderRadius: 1,
              p: 1,
              boxShadow: 3,
              display: 'flex',
              alignItems: 'center',
              minWidth: 200,
            }}
          >
            <Description sx={{ mr: 1, fontSize: 18 }} />
            <Typography variant="body2">
              {activeChapter.title}
            </Typography>
          </Box>
        )}
      </DragOverlay>
    </DndContext>
  )
}
