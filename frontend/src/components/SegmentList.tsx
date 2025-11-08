/**
 * SegmentList with Drag & Drop support
 * Supports reordering segments and creating new segments via Command Toolbar
 */

import React, { useRef, useEffect, useState } from 'react'
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
  Chip,
  IconButton,
  Stack,
  Snackbar,
  Alert,
  Divider,
  Tooltip,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  PlayArrow,
  Pause,
  Refresh,
  DragIndicator,
  MoreVert,
  Description,
  TextFields,
  HorizontalRule,
} from '@mui/icons-material'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery } from '@tanstack/react-query'

import CommandToolbar from './CommandToolbar'
import DividerSegmentItem from './DividerSegmentItem'
import SegmentMenu from './SegmentMenu'
import QuickCreateSegmentDialog from './dialogs/QuickCreateSegmentDialog'
import QuickCreateDividerDialog from './dialogs/QuickCreateDividerDialog'
import { useReorderSegments, useCreateSegment } from '../hooks/useDragDropMutations'
import { useUpdateSegment } from '../hooks/useSegmentsQuery'
import { useAppStore } from '../store/appStore'
import { fetchSpeakers } from '../services/settingsApi'
import { isActiveSpeaker } from '../utils/speakerHelpers'
import { logger } from '../utils/logger'
import type { Segment } from '../types'

interface SegmentListProps {
  chapterId: string
  segments: Segment[]
  currentTime?: number
  selectedSegmentId?: string | null
  playingSegmentId?: string | null
  continuousPlayback?: boolean
  onSegmentClick?: (segment: Segment) => void
  onSegmentPlay?: (segment: Segment, continuous?: boolean) => void
  onSegmentEdit?: (segment: Segment) => void
  onSegmentEditSettings?: (segment: Segment) => void
  onSegmentDelete?: (segment: Segment) => void
  onSegmentRegenerate?: (segment: Segment) => void
}

// ============================================================================
// SortableSegmentItem - Individual draggable segment
// ============================================================================

interface SortableSegmentItemProps {
  segment: Segment
  isPlaying: boolean
  isSelected: boolean
  isOver: boolean
  hasSpeakers: boolean
  speakers: any[] // Speaker list for validation
  onSegmentClick: (segment: Segment) => void
  onSegmentPlay?: (segment: Segment, continuous?: boolean) => void
  onSegmentEdit?: (segment: Segment) => void
  onSegmentEditSettings?: (segment: Segment) => void
  onSegmentDelete?: (segment: Segment) => void
  onSegmentRegenerate?: (segment: Segment) => void
  onUpdatePause?: (segmentId: string, pauseDuration: number) => void
}

function SortableSegmentItem({
  segment,
  isPlaying,
  isSelected,
  isOver,
  hasSpeakers,
  speakers,
  onSegmentClick,
  onSegmentPlay,
  onSegmentEdit,
  onSegmentEditSettings,
  onSegmentDelete,
  onSegmentRegenerate,
  onUpdatePause,
}: SortableSegmentItemProps) {
  const { t } = useTranslation()
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: segment.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Divider segment (pause)
  if (segment.segmentType === 'divider') {
    return (
      <div ref={setNodeRef} style={style}>
        <DividerSegmentItem
          segment={segment}
          isSelected={isSelected}
          isDragging={isDragging}
          isOver={isOver}
          onSelect={() => onSegmentClick(segment)}
          onDelete={() => onSegmentDelete?.(segment)}
          onUpdatePause={(pauseDuration) => onUpdatePause?.(segment.id, pauseDuration)}
          dragHandleProps={{ ...attributes, ...listeners }}
        />
      </div>
    )
  }

  // Standard segment (text/audio)
  const hasAudio = !!segment.audioPath

  const getStatusColor = (status?: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status) {
      case 'completed':
        return 'success'
      case 'processing':
        return 'primary'
      case 'queued':
        return 'default'  
      case 'failed':
        return 'error'
      case 'pending':
      default:
        return 'default'
    }
  }

  const getStatusBgColor = (status?: string): string => {
    switch (status) {
      case 'completed':
        return 'success.main'
      case 'processing':
        return 'warning.main'
      case 'queued':
        return 'action.selected'
      case 'failed':
        return 'error.main'
      case 'pending':
      default:
        return 'action.selected'
    }
  }

  const getStatusText = (status?: string): string => {
    switch (status) {
      case 'completed':
        return t('segments.status.completed')
      case 'processing':
        return t('segments.status.processing')
      case 'queued':
        return t('segments.status.queued')
      case 'failed':
        return t('segments.status.failed')
      case 'pending':
        return t('segments.status.pending')
      default:
        return t('segments.status.noStatus')
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getDuration = (seg: Segment): string => {
    const duration = seg.endTime - seg.startTime
    return formatTime(duration)
  }

  const getHandleColor = (status?: string): string => {
    switch (status) {
      case 'completed':
        return 'success.main'
      case 'processing':
      case 'queued':
        return 'warning.main'  // Yellow/orange handle for both queued and processing
      case 'failed':
        return 'error.main'
      case 'pending':
      default:
        return 'action.selected'
    }
  }

  const getBorderColor = () => {
    if (isPlaying) return 'success.main'
    if (isSelected) return 'primary.main'
    return getHandleColor(segment.status)
  }

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      elevation={isSelected ? 2 : 0}
      sx={{
        mb: 1,
        bgcolor: isSelected ? 'action.selected' : 'background.paper',
        borderLeft: 3,
        borderColor: getBorderColor(),
        transition: 'all 0.2s',
        opacity: isDragging ? 0.5 : 1,
        '&:hover': {
          bgcolor: 'action.hover',
          elevation: 1,
        },
      }}
    >
      <ListItem
        disablePadding
        onClick={() => onSegmentClick(segment)}
      >
        <ListItemButton sx={{ py: 1.5, px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
          {/* Drag Handle - Left */}
          <Box
            {...attributes}
            {...listeners}
            sx={{
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              color: 'text.secondary',
              '&:active': {
                cursor: 'grabbing',
              },
            }}
          >
            <DragIndicator fontSize="small" />
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {onSegmentPlay && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (hasAudio) {
                      onSegmentPlay(segment, false)
                    }
                  }}
                  disabled={!hasAudio}
                  color={isPlaying ? 'success' : 'default'}
                  title={hasAudio ? (isPlaying ? t('segments.actions.pause') : t('segments.actions.play')) : t('segments.noAudio')}
                >
                  {isPlaying ? <Pause fontSize="small" /> : <PlayArrow fontSize="small" />}
                </IconButton>
              )}

              {onSegmentRegenerate && (() => {
                const speakerIsActive = isActiveSpeaker(segment.ttsSpeakerName, speakers);
                const isDisabled = segment.status === 'processing' || segment.status === 'queued' || !hasSpeakers || !speakerIsActive;

                // Always log - we need to see this! JoeLog
                // console.log('[Regenerate] Segment', segment.orderIndex ?? 'unknown', {
                //   ttsSpeakerName: segment.ttsSpeakerName,
                //   hasSpeakers,
                //   speakersCount: speakers?.length || 0,
                //   speakerIsActive,
                //   isDisabled,
                //   status: segment.status,
                //   speakers: speakers?.map(s => ({ name: s.name, isActive: s.isActive }))
                // });

                return (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSegmentRegenerate(segment)
                    }}
                    disabled={isDisabled}
                    title={
                      !hasSpeakers
                        ? t('audioGeneration.noSpeakers.title')
                        : !speakerIsActive
                          ? t('segments.speakerInactive', { speaker: segment.ttsSpeakerName || t('segments.noSpeaker') })
                          : segment.status === 'queued'
                            ? t('segments.queued')
                            : segment.status === 'processing'
                              ? t('segments.generating')
                              : t('segments.actions.regenerate')
                    }
                  >
                    <Refresh fontSize="small" />
                  </IconButton>
                );
              })()}

              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuAnchorEl(e.currentTarget)
                }}
                title={t('segments.actions.moreActions')}
              >
                <MoreVert fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

          {/* Column Layout */}
          <Box sx={{ display: 'flex', gap: 2.5, flex: 1, alignItems: 'center', my: 0.5, ml: 0.5 }}>
            {/* Column 1: Segment Number (status-colored chip with tooltip) */}
            <Box sx={{ flexShrink: 0 }}>
              <Tooltip title={getStatusText(segment.status)} arrow>
                <Chip
                  label={segment.orderIndex + 1}
                  size="small"
                  sx={{
                    minWidth: 45,
                    height: 24,
                    fontSize: '0.8rem',
                    fontWeight: isPlaying ? 'bold' : 'medium',
                    bgcolor: getStatusBgColor(segment.status),
                    color: segment.status && segment.status !== 'pending' ? 'white' : 'text.primary',
                    '& .MuiChip-label': {
                      px: 1,
                    },
                  }}
                />
              </Tooltip>
            </Box>

            {/* Vertical Divider */}
            <Divider orientation="vertical" flexItem sx={{ height: 24, alignSelf: 'center', borderRightWidth: 2, borderColor: 'white' }} />

            {/* Column 2: Text Content (flexible) */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {segment.text}
              </Typography>
            </Box>
          </Box>
        </Box>
        </ListItemButton>
      </ListItem>

      {/* Segment Menu */}
      <SegmentMenu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => setMenuAnchorEl(null)}
        onEdit={() => onSegmentEdit?.(segment)}
        onEditSettings={() => onSegmentEditSettings?.(segment)}
        onDelete={() => onSegmentDelete?.(segment)}
        segmentType="standard"
      />
    </Paper>
  )
}

// ============================================================================
// Inline Drop Zone Component - Between segments
// ============================================================================

interface InlineDropZoneProps {
  id: string
  isActive: boolean
}

function InlineDropZone({ id, isActive }: InlineDropZoneProps) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id })

  if (!isActive) return null

  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: isOver ? 40 : 10,
        mx: 2,
        my: 0.5,
        border: 2,
        borderStyle: 'dashed',
        borderColor: isOver ? 'primary.main' : 'primary.main',
        borderRadius: 1,
        backgroundColor: isOver ? 'action.hover' : 'transparent',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isOver ? 1 : 0.7,
      }}
    >
      <Typography
        variant="caption"
        color={isOver ? 'primary.main' : 'primary.main'}
        sx={{ fontWeight: isOver ? 600 : 400, fontSize: '0.7rem' }}
      >
        {isOver ? t('segments.dropZone.dropHere') : ''}
      </Typography>
    </Box>
  )
}

// ============================================================================
// Drop Zone Component - For appending at the end
// ============================================================================

interface DropZoneProps {
  isActive: boolean
}

function DropZone({ isActive }: DropZoneProps) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-zone-end',
  })

  if (!isActive) return null

  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: 60,
        m: 2,
        border: 2,
        borderStyle: 'dashed',
        borderColor: isOver ? 'primary.main' : 'divider',
        borderRadius: 2,
        backgroundColor: isOver ? 'action.hover' : 'transparent',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {isOver && (
        <Box
          sx={{
            position: 'absolute',
            top: -2,
            left: 0,
            right: 0,
            height: 4,
            bgcolor: 'primary.main',
            zIndex: 1000,
            borderRadius: 1,
            boxShadow: '0 0 8px rgba(0, 123, 255, 0.6)',
          }}
        />
      )}
      <Typography
        variant="body2"
        color={isOver ? 'primary.main' : 'text.secondary'}
        sx={{ fontWeight: isOver ? 600 : 400 }}
      >
        {isOver ? t('segments.dropZone.dropToAppend') : t('segments.dropZone.dropHereToAppend')}
      </Typography>
    </Box>
  )
}

// ============================================================================
// Main SegmentList Component
// ============================================================================

export const SegmentList: React.FC<SegmentListProps> = ({
  chapterId,
  segments,
  currentTime = 0,
  selectedSegmentId,
  playingSegmentId,
  continuousPlayback = false,
  onSegmentClick,
  onSegmentPlay,
  onSegmentEdit,
  onSegmentEditSettings,
  onSegmentDelete,
  onSegmentRegenerate,
}) => {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [localSegments, setLocalSegments] = useState(segments)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  // Dialog states
  const [showCreateSegmentDialog, setShowCreateSegmentDialog] = useState(false)
  const [showCreateDividerDialog, setShowCreateDividerDialog] = useState(false)
  const [pendingDropIndex, setPendingDropIndex] = useState(0)

  // Get TTS settings from session store (consistent with other components)
  const currentEngine = useAppStore((state) => state.getCurrentTtsEngine())
  const currentModelName = useAppStore((state) => state.getCurrentTtsModelName())
  const currentSpeaker = useAppStore((state) => state.getCurrentTtsSpeaker())
  const currentLanguage = useAppStore((state) => state.getCurrentLanguage())

  // Query speakers to check availability
  const { data: speakers } = useQuery({
    queryKey: ['speakers'],
    queryFn: fetchSpeakers,
  })

  // Only count active speakers
  const hasSpeakers = (speakers?.filter(s => s.isActive).length ?? 0) > 0

  // React Query mutations
  const reorderMutation = useReorderSegments()
  const createSegmentMutation = useCreateSegment()
  const updateSegmentMutation = useUpdateSegment()

  // Refs for auto-scroll and scrollbar detection
  const segmentRefs = useRef<Map<string, HTMLElement>>(new Map())
  const listRef = useRef<HTMLUListElement>(null)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    })
  )

  // Sync local state with props
  useEffect(() => {
    setLocalSegments(segments)
  }, [segments])

  // Auto-scroll to playing segment
  useEffect(() => {
    if (playingSegmentId && continuousPlayback) {
      const element = segmentRefs.current.get(playingSegmentId)
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [playingSegmentId, continuousPlayback])

  // Detect scrollbar width
  useEffect(() => {
    const updateScrollbarWidth = () => {
      if (listRef.current) {
        const scrollbarWidth = listRef.current.offsetWidth - listRef.current.clientWidth
        setScrollbarWidth(scrollbarWidth)
      }
    }

    updateScrollbarWidth()

    // Create ResizeObserver to update when list size changes
    const resizeObserver = new ResizeObserver(updateScrollbarWidth)
    if (listRef.current) {
      resizeObserver.observe(listRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [localSegments])

  // ============================================================================
  // Drag & Drop Handlers
  // ============================================================================

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    setOverId(over ? (over.id as string) : null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveId(null)
    setOverId(null)

    if (!over) return

    // Check if dropped on command toolbar (cancel zone)
    if (over.id === 'command-toolbar-cancel-zone') {
      // Cancel operation - do nothing
      return
    }

    // Handle command drops (creating new segments)
    if (active.data.current?.type === 'command') {
      const commandType = active.data.current.commandType

      // Calculate drop position
      let newOrderIndex: number
      const overIdStr = String(over.id)

      if (overIdStr === 'drop-zone-end') {
        // Drop in end zone -> append
        newOrderIndex = localSegments.length
      } else if (overIdStr.startsWith('drop-zone-before-')) {
        // Drop in inline zone -> insert at specific position
        const index = parseInt(overIdStr.replace('drop-zone-before-', ''), 10)
        newOrderIndex = index
      } else {
        // Drop over existing segment -> insert BEFORE that segment
        const dropIndex = localSegments.findIndex((s) => s.id === over.id)
        newOrderIndex = dropIndex >= 0 ? dropIndex : localSegments.length
      }

      // Store drop index for dialog handlers
      setPendingDropIndex(newOrderIndex)

      if (commandType === 'divider') {
        // Open divider dialog
        setShowCreateDividerDialog(true)
      } else if (commandType === 'text-segment') {
        // Open text segment dialog
        setShowCreateSegmentDialog(true)
      }
      return
    }

    // Handle segment reordering
    if (active.id !== over.id) {
      const oldIndex = localSegments.findIndex((s) => s.id === active.id)
      const overIdStr = String(over.id)

      if (oldIndex === -1) return

      let newIndex: number

      if (overIdStr === 'drop-zone-end') {
        // Move to end
        newIndex = localSegments.length - 1
      } else if (overIdStr.startsWith('drop-zone-before-')) {
        // Drop in inline zone -> move to specific position
        newIndex = parseInt(overIdStr.replace('drop-zone-before-', ''), 10)
        // Adjust index if moving from before to after
        if (oldIndex < newIndex) {
          newIndex = newIndex - 1
        }
      } else {
        // Normal reordering - drop over existing segment
        newIndex = localSegments.findIndex((s) => s.id === over.id)
        if (newIndex === -1) return
      }

      // Perform reorder
      const reorderedSegments = arrayMove(localSegments, oldIndex, newIndex)
      setLocalSegments(reorderedSegments)

      // Send to backend
      const segmentIds = reorderedSegments.map((s) => s.id)
      reorderMutation.mutate({ chapterId, segmentIds })
    }
  }

  // ============================================================================
  // Update pause duration
  // ============================================================================

  const handleUpdatePause = (segmentId: string, pauseDuration: number) => {
    updateSegmentMutation.mutate(
      {
        segmentId,
        chapterId,
        data: { pauseDuration },
      },
      {
        onSuccess: () => {
          setSnackbarMessage(t('segments.pauseUpdated', { seconds: pauseDuration / 1000 }))
        },
        onError: (error) => {
          logger.error('📋 Failed to update pause:', error)
          setSnackbarMessage(t('segments.pauseUpdateFailed'))
        },
      }
    )
  }

  // ============================================================================
  // Dialog Handlers
  // ============================================================================

  const handleCreateTextSegment = async (text: string) => {
    // Check if speakers are available
    if (!hasSpeakers || !currentSpeaker) {
      setSnackbarMessage(t('audioGeneration.noSpeakers.title'))
      return Promise.reject(new Error('No speakers available'))
    }

    return new Promise<void>((resolve, reject) => {
      createSegmentMutation.mutate(
        {
          chapterId: chapterId,
          text,
          orderIndex: pendingDropIndex,
          ttsEngine: currentEngine,
          ttsModelName: currentModelName,
          ttsSpeakerName: currentSpeaker,
          language: currentLanguage,
          segmentType: 'standard',
        },
        {
          onSuccess: () => {
            setSnackbarMessage(t('segments.textSegmentCreated'))
            resolve()
          },
          onError: (error) => {
            logger.error('📋 Failed to create text segment:', error)
            reject(error)
          },
        }
      )
    })
  }

  const handleCreateDivider = async (pauseDuration: number) => {
    return new Promise<void>((resolve, reject) => {
      createSegmentMutation.mutate(
        {
          chapterId: chapterId,
          text: '',
          orderIndex: pendingDropIndex,
          ttsEngine: currentEngine,
          ttsModelName: currentModelName,
          ttsSpeakerName: currentSpeaker,
          language: currentLanguage,
          segmentType: 'divider',
          pauseDuration: pauseDuration,
        },
        {
          onSuccess: () => {
            setSnackbarMessage(t('segments.pauseCreated', { seconds: pauseDuration / 1000 }))
            resolve()
          },
          onError: (error) => {
            logger.error('📋 Failed to create divider:', error)
            reject(error)
          },
        }
      )
    })
  }

  // ============================================================================
  // Render
  // ============================================================================

  const activeSegment = localSegments.find((s) => s.id === activeId)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* DnD Context wraps BOTH CommandToolbar and SegmentList */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Command Toolbar (outside Paper) */}
        <Box sx={{ px: 2, pt: 2, pb: 2, pr: `${16 + scrollbarWidth}px` }}>
          <CommandToolbar />
        </Box>

        {/* Segment List Paper */}
        <Paper elevation={0} sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: 'transparent' }}>
          {/* Segment List with SortableContext */}
          <SortableContext items={localSegments.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <List ref={listRef} sx={{ flex: 1, overflow: 'auto', px: 2, py: 0 }}>
            {localSegments.length === 0 ? (
              <Box
                sx={{
                  p: 4,
                  m: 2,
                  border: 2,
                  borderStyle: 'dashed',
                  borderColor: activeId ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  backgroundColor: activeId ? 'action.hover' : 'transparent',
                  transition: 'all 0.2s ease',
                  minHeight: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Description sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography
                  variant="body2"
                  color={activeId ? 'primary.main' : 'text.secondary'}
                  align="center"
                  sx={{ fontWeight: activeId ? 600 : 400 }}
                >
                  {activeId ? t('segments.dropZone.dropToCreate') : t('segments.noSegments')}
                </Typography>
              </Box>
            ) : (
              <>
                {localSegments.map((segment, index) => (
                  <React.Fragment key={segment.id}>
                    {/* Drop zone before each segment */}
                    <InlineDropZone id={`drop-zone-before-${index}`} isActive={!!activeId} />

                    <div
                      ref={(el) => {
                        if (el) segmentRefs.current.set(segment.id, el)
                        else segmentRefs.current.delete(segment.id)
                      }}
                    >
                      <SortableSegmentItem
                        segment={segment}
                        isPlaying={segment.id === playingSegmentId}
                        isSelected={segment.id === selectedSegmentId}
                        isOver={false}
                        hasSpeakers={hasSpeakers}
                        speakers={speakers || []}
                        onSegmentClick={onSegmentClick || (() => {})}
                        onSegmentPlay={onSegmentPlay}
                        onSegmentEdit={onSegmentEdit}
                        onSegmentEditSettings={onSegmentEditSettings}
                        onSegmentDelete={onSegmentDelete}
                        onSegmentRegenerate={onSegmentRegenerate}
                        onUpdatePause={handleUpdatePause}
                      />
                    </div>
                  </React.Fragment>
                ))}
              </>
            )}

            {/* Drop Zone for appending at end */}
            {localSegments.length > 0 && <DropZone isActive={!!activeId} />}
          </List>
        </SortableContext>
        </Paper>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeId ? (
            <Chip
              icon={
                activeSegment ? (
                  activeSegment.segmentType === 'divider' ? <HorizontalRule /> : <TextFields />
                ) : activeId === 'cmd-text-segment' ? (
                  <TextFields />
                ) : (
                  <HorizontalRule />
                )
              }
              label={
                activeSegment
                  ? activeSegment.segmentType === 'divider'
                    ? t('segments.drag.pause', { seconds: activeSegment.pauseDuration / 1000 })
                    : t('segments.drag.segment', { number: activeSegment.orderIndex + 1 })
                  : activeId === 'cmd-text-segment'
                  ? t('segments.drag.newSegment')
                  : activeId === 'cmd-divider'
                  ? t('segments.drag.newPause')
                  : t('segments.drag.dragging')
              }
              color="primary"
              sx={{
                cursor: 'grabbing',
                boxShadow: 8,
                minWidth: 140,
              }}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Quick Create Dialogs */}
      <QuickCreateSegmentDialog
        open={showCreateSegmentDialog}
        chapterId={chapterId}
        orderIndex={pendingDropIndex}
        onClose={() => setShowCreateSegmentDialog(false)}
        onConfirm={handleCreateTextSegment}
      />

      <QuickCreateDividerDialog
        open={showCreateDividerDialog}
        chapterId={chapterId}
        orderIndex={pendingDropIndex}
        onClose={() => setShowCreateDividerDialog(false)}
        onConfirm={handleCreateDivider}
      />

      {/* Snackbar for feedback */}
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSnackbarMessage(null)}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  )
}
