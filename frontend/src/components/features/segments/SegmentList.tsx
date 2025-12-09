/**
 * SegmentList with Drag & Drop support
 * Supports reordering segments and creating new segments via Command Toolbar
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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
  Lock,
  Description,
  TextFields,
  HorizontalRule,
  Warning,
  Error as ErrorIcon,
  CheckCircle,
  Rule as RuleIcon,
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

import CommandToolbar from '@components/layout/CommandToolbar'
import DividerSegmentItem from './DividerSegmentItem'
import SegmentMenu from './SegmentMenu'
import QuickCreateSegmentDialog from '@components/dialogs/QuickCreateSegmentDialog'
import QuickCreateDividerDialog from '@components/dialogs/QuickCreateDividerDialog'
import { QualityStatusIndicator } from '@components/features/stt/QualityStatusIndicator'
import { GenericQualityTooltip } from '@components/features/quality'
import { useReorderSegments, useCreateSegment } from '@hooks/useDragDropMutations'
import { useUpdateSegment, useFreezeSegment, useUnfreezeSegment } from '@hooks/useSegmentsQuery'
import { useAnalyzeSegmentQuality } from '@hooks/useQualityQuery'
import { useAllEnginesStatus } from '@hooks/useEnginesQuery'
import { useSnackbar } from '@hooks/useSnackbar'
import { useAppStore } from '@store/appStore'
import { fetchSpeakers } from '@services/settingsApi'
import { queryKeys } from '@services/queryKeys'
import { isActiveSpeaker } from '@utils/speakerHelpers'
import { useDefaultSpeaker } from '@hooks/useSpeakersQuery'
import { logger } from '@utils/logger'
import type { Segment, SegmentWithQuality, Speaker } from '@types'

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
  speakers: Speaker[]
  canAnalyzeQuality: boolean // Whether quality analysis is available (STT or Audio engine)
  onSegmentClick: (segment: Segment) => void
  onSegmentPlay?: (segment: Segment, continuous?: boolean) => void
  onSegmentEdit?: (segment: Segment) => void
  onSegmentEditSettings?: (segment: Segment) => void
  onSegmentDelete?: (segment: Segment) => void
  onSegmentRegenerate?: (segment: Segment) => void
  onAnalyzeWithWhisper?: (segment: Segment) => void
  onUpdatePause?: (segmentId: string, pauseDuration: number) => void
  onSegmentFreeze: (segmentId: string, chapterId: string) => void
  onSegmentUnfreeze: (segmentId: string, chapterId: string) => void
}

const SortableSegmentItem = React.memo(({
  segment,
  isPlaying,
  isSelected,
  isOver,
  hasSpeakers,
  speakers,
  canAnalyzeQuality,
  onSegmentClick,
  onSegmentPlay,
  onSegmentEdit,
  onSegmentEditSettings,
  onSegmentDelete,
  onSegmentRegenerate,
  onAnalyzeWithWhisper,
  onUpdatePause,
  onSegmentFreeze,
  onSegmentUnfreeze,
}: SortableSegmentItemProps) => {
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

  // Memoize speaker validation (avoids O(n) lookup on every render)
  const speakerIsActive = useMemo(
    () => isActiveSpeaker(segment.ttsSpeakerName, speakers),
    [segment.ttsSpeakerName, speakers]
  )

  // Memoize isDisabled calculation (including frozen check)
  const isDisabled = useMemo(
    () => segment.status === 'processing' || segment.status === 'queued' || !hasSpeakers || !speakerIsActive || segment.isFrozen,
    [segment.status, hasSpeakers, speakerIsActive, segment.isFrozen]
  )

  // Memoize icon to prevent re-creating on every render (performance optimization for 200+ segments)
  const regenerateIcon = useMemo(
    () => segment.isFrozen ? <Lock fontSize="small" /> : <Refresh fontSize="small" />,
    [segment.isFrozen]
  )

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

  // Cast to SegmentWithQuality to access quality indicators
  const segmentWithQuality = segment as SegmentWithQuality

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
      data-testid={`segment-${segment.id}`}
      data-segment-type="text"
      elevation={isSelected ? 2 : 0}
      sx={{
        mb: 1,
        bgcolor: segment.isFrozen
          ? 'rgba(33, 150, 243, 0.08)'  // Light blue for frozen
          : (isSelected ? 'action.selected' : 'background.paper'),
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
            data-testid="drag-handle"
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
                  data-testid="play-button"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
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

              {onSegmentRegenerate && (
                <IconButton
                  data-testid="segment-generate-button"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!segment.isFrozen) {
                      onSegmentRegenerate(segment)
                    }
                  }}
                  disabled={isDisabled}
                  title={
                    segment.isFrozen
                      ? t('segments.frozen')
                      : !hasSpeakers
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
                  {regenerateIcon}
                </IconButton>
              )}

              <IconButton
                size="small"
                data-testid="segment-menu-button"
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
            {/* Column 1: Segment Number (status-colored chip with tooltip, double-click to freeze) */}
            <Box sx={{ flexShrink: 0 }}>
              <Tooltip title={segment.isFrozen ? t('segments.frozen') : getStatusText(segment.status)} arrow>
                <Chip
                  label={segment.orderIndex + 1}
                  size="small"
                  data-testid="segment-status"
                  onClick={(e) => {
                    e.stopPropagation() // Prevent segment selection on chip click
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (!segment.isFrozen && segment.status === 'completed') {
                      onSegmentFreeze(segment.id, segment.chapterId)
                    }
                  }}
                  sx={{
                    minWidth: 45,
                    height: 24,
                    fontSize: '0.8rem',
                    fontWeight: isPlaying ? 'bold' : 'medium',
                    cursor: (!segment.isFrozen && segment.status === 'completed') ? 'pointer' : 'default',
                    bgcolor: segment.isFrozen ? '#2196F3' : getStatusBgColor(segment.status),
                    color: 'white',
                    '& .MuiChip-label': {
                      px: 1,
                    },
                    '&:hover': (!segment.isFrozen && segment.status === 'completed') ? {
                      opacity: 0.8,
                      bgcolor: segment.isFrozen ? '#2196F3' : getStatusBgColor(segment.status),
                    } : {
                      // Prevent default MUI Chip hover effect
                      bgcolor: segment.isFrozen ? '#2196F3' : getStatusBgColor(segment.status),
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
                data-testid="segment-text"
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

              {/* Quality indicator */}
              {!segment.isFrozen && segmentWithQuality.qualityAnalyzed && segmentWithQuality.engineResults && segmentWithQuality.engineResults.length > 0 && (
                <Box display="flex" gap={0.75} alignItems="center" mt={0.5}>
                  <GenericQualityTooltip
                    qualityScore={segmentWithQuality.qualityScore ?? 0}
                    qualityStatus={segmentWithQuality.qualityStatus ?? 'perfect'}
                    engines={segmentWithQuality.engineResults}
                  >
                    <Box display="inline-flex">
                      <QualityStatusIndicator
                        status={segmentWithQuality.qualityStatus}
                        size="small"
                        showTooltip={false}
                      />
                    </Box>
                  </GenericQualityTooltip>
                </Box>
              )}
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
        onAnalyzeWithWhisper={() => onAnalyzeWithWhisper?.(segment)}
        onDelete={() => onSegmentDelete?.(segment)}
        onUnfreeze={() => onSegmentUnfreeze(segment.id, segment.chapterId)}
        segmentType="standard"
        hasAudio={hasAudio}
        isFrozen={segment.isFrozen}
        canAnalyzeQuality={canAnalyzeQuality}
      />
    </Paper>
  )
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if relevant segment properties changed
  // This prevents re-rendering all 400 segments when only one segment updates
  return (
    prevProps.segment.id === nextProps.segment.id &&
    prevProps.segment.status === nextProps.segment.status &&
    prevProps.segment.audioPath === nextProps.segment.audioPath &&
    prevProps.segment.text === nextProps.segment.text &&
    prevProps.segment.orderIndex === nextProps.segment.orderIndex &&
    prevProps.segment.ttsSpeakerName === nextProps.segment.ttsSpeakerName &&
    prevProps.segment.segmentType === nextProps.segment.segmentType &&
    prevProps.segment.pauseDuration === nextProps.segment.pauseDuration &&
    prevProps.segment.isFrozen === nextProps.segment.isFrozen &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isOver === nextProps.isOver &&
    prevProps.hasSpeakers === nextProps.hasSpeakers &&
    prevProps.canAnalyzeQuality === nextProps.canAnalyzeQuality &&
    // Compare quality indicators
    (prevProps.segment as SegmentWithQuality).qualityAnalyzed === (nextProps.segment as SegmentWithQuality).qualityAnalyzed &&
    (prevProps.segment as SegmentWithQuality).qualityScore === (nextProps.segment as SegmentWithQuality).qualityScore &&
    (prevProps.segment as SegmentWithQuality).qualityStatus === (nextProps.segment as SegmentWithQuality).qualityStatus
  )
})

SortableSegmentItem.displayName = 'SortableSegmentItem'

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
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [localSegments, setLocalSegments] = useState(segments)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  // Dialog states
  const [showCreateSegmentDialog, setShowCreateSegmentDialog] = useState(false)
  const [showCreateDividerDialog, setShowCreateDividerDialog] = useState(false)
  const [pendingDropIndex, setPendingDropIndex] = useState(0)

  // Get TTS default settings from DB (for new segment creation)
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine())
  const getDefaultTtsModel = useAppStore((state) => state.getDefaultTtsModel)
  const defaultModelName = getDefaultTtsModel(defaultEngine)
  const defaultLanguage = useAppStore((state) => state.getDefaultLanguage())
  const settings = useAppStore((state) => state.settings)

  // Check engine availability for quality analysis (needs at least STT or Audio engine)
  const engineAvailability = useAppStore((state) => state.engineAvailability)
  const canAnalyzeQuality = engineAvailability.stt.hasEnabled || engineAvailability.audio.hasEnabled

  // Default speaker from speakers table (single source of truth)
  const { data: defaultSpeakerData } = useDefaultSpeaker()
  const defaultSpeaker = defaultSpeakerData?.name || ''

  // Fetch engines and models for validation (only enabled engines)
  const { data: enginesStatus } = useAllEnginesStatus()
  const engines = (enginesStatus?.tts ?? []).filter(e => e.isEnabled)
  const engineInfo = engines.find((e) => e.name === defaultEngine)
  const models = engineInfo?.availableModels ?? []

  // Calculate available languages: supportedLanguages + defaultLanguage from DB (if not already included)
  const availableLanguages = React.useMemo(() => {
    if (!engineInfo) return []

    const supported = engineInfo.supportedLanguages || []
    const engineConfig = settings?.tts.engines[defaultEngine]
    const dbDefaultLanguage = engineConfig?.defaultLanguage

    // Add DB default language if it's not already in supported languages
    if (dbDefaultLanguage && !supported.includes(dbDefaultLanguage)) {
      return [dbDefaultLanguage, ...supported]
    }

    return supported
  }, [engineInfo, settings, defaultEngine])

  // Validate and get effective model: use DB default if available, otherwise first available
  const effectiveModelName = React.useMemo(() => {
    if (models.length === 0) return defaultModelName

    const defaultModelAvailable = models.includes(defaultModelName)
    if (defaultModelAvailable) {
      return defaultModelName
    }

    // Fallback to first available model
    return models[0] || defaultModelName
  }, [models, defaultModelName])

  // Validate and get effective language: use DB default if in availableLanguages, otherwise first available
  const effectiveLanguage = React.useMemo(() => {
    if (availableLanguages.length === 0) return defaultLanguage

    if (availableLanguages.includes(defaultLanguage)) {
      return defaultLanguage
    }

    // Fallback to first available language
    return availableLanguages[0] || defaultLanguage
  }, [availableLanguages, defaultLanguage])

  // Query speakers to check availability
  const { data: speakers } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
  })

  // Memoize active speakers filter to avoid redundant array operations
  const activeSpeakers = useMemo(
    () => speakers?.filter(s => s.isActive) ?? [],
    [speakers]
  )

  // Derive hasSpeakers from memoized array
  const hasSpeakers = activeSpeakers.length > 0

  // React Query mutations
  const reorderMutation = useReorderSegments()
  const createSegmentMutation = useCreateSegment()
  const updateSegmentMutation = useUpdateSegment()
  const analyzeSegmentMutation = useAnalyzeSegmentQuality()
  const freezeSegmentMutation = useFreezeSegment()
  const unfreezeSegmentMutation = useUnfreezeSegment()

  // Stable references for default props (prevents unnecessary re-renders)
  const emptySpeakersArray = useMemo(() => [], [])
  const emptyOnSegmentClick = useCallback(() => {}, [])

  // Refs for auto-scroll and scrollbar detection
  const segmentRefs = useRef<Map<string, HTMLElement>>(new Map())
  const listRef = useRef<HTMLDivElement>(null) // Changed to div for useVirtualizer

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    })
  )

  // Virtualization with @tanstack/react-virtual
  // This renders only visible items for 95% DOM reduction
  const rowVirtualizer = useVirtualizer({
    count: localSegments.length,
    getScrollElement: () => listRef.current,
    estimateSize: useCallback((index) => {
      // Estimate row height including DropZone + Segment + Margin
      // DropZone: ~10-40px (collapsed/expanded)
      // Divider: ~50px
      // Segment: ~80-120px (depending on quality indicators and text wrapping)
      const segment = localSegments[index]
      if (segment?.segmentType === 'divider') {
        return 70 // DropZone (~20px) + Divider (~50px)
      }
      return 120 // DropZone (~20px) + Segment (~80-100px) + margin
    }, [localSegments]),
    overscan: 10, // Render 10 extra items above/below viewport for smooth fast scrolling
    measureElement: typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
      ? (element) => element?.getBoundingClientRect().height
      : undefined, // Enable dynamic measurement (auto-corrects estimates)
  })

  // Sync local state with props
  useEffect(() => {
    setLocalSegments(segments)
  }, [segments])

  // Auto-scroll to playing segment (with virtualization)
  // Always scroll to playing segment for better UX (user can see current text)
  useEffect(() => {
    if (playingSegmentId) {
      const index = localSegments.findIndex(s => s.id === playingSegmentId)
      if (index !== -1) {
        // Use 'center' align for better visibility of surrounding segments
        rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
      }
    }
  }, [playingSegmentId, localSegments, rowVirtualizer])

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
  // Analyze segment with Quality system (creates job)
  // ============================================================================

  const handleAnalyzeWithWhisper = useCallback((segment: Segment) => {
    analyzeSegmentMutation.mutate(
      {
        segmentId: segment.id,
        // sttEngine, sttModelName, audioEngine use backend defaults
      },
      {
        onSuccess: () => {
          showSnackbar(
            t('segments.messages.qualityJobCreated'),
            { severity: 'success' }
          )
        },
        onError: (error) => {
          logger.error('[SegmentList] Failed to create quality analysis job', { error })
          showSnackbar(t('segments.messages.qualityJobFailed'), { severity: 'error' })
        },
      }
    )
  }, [analyzeSegmentMutation, showSnackbar, t])

  // ============================================================================
  // Freeze segment
  // ============================================================================

  const handleFreezeSegment = useCallback((segmentId: string, chapterId: string) => {
    freezeSegmentMutation.mutate({ segmentId, chapterId })
  }, [freezeSegmentMutation])

  // ============================================================================
  // Unfreeze segment
  // ============================================================================

  const handleUnfreezeSegment = useCallback((segmentId: string, chapterId: string) => {
    unfreezeSegmentMutation.mutate({ segmentId, chapterId })
  }, [unfreezeSegmentMutation])

  // ============================================================================
  // Update pause duration
  // ============================================================================

  const handleUpdatePause = useCallback((segmentId: string, pauseDuration: number) => {
    updateSegmentMutation.mutate(
      {
        segmentId,
        chapterId,
        data: { pauseDuration },
      },
      {
        onSuccess: () => {
          showSnackbar(t('segments.pauseUpdated', { seconds: pauseDuration / 1000 }), { severity: 'success' })
        },
        onError: (error) => {
          logger.error('[SegmentList] Failed to update pause', { error })
          showSnackbar(t('segments.pauseUpdateFailed'), { severity: 'error' })
        },
      }
    )
  }, [updateSegmentMutation, chapterId, t, showSnackbar])

  // ============================================================================
  // Dialog Handlers
  // ============================================================================

  const handleCreateTextSegment = useCallback(async (text: string) => {
    // Check if speakers are available
    if (!hasSpeakers || !defaultSpeaker) {
      showSnackbar(t('audioGeneration.noSpeakers.title'), { severity: 'error' })
      const error: Error = new Error('No speakers available')
      return Promise.reject(error)
    }

    return new Promise<void>((resolve, reject) => {
      createSegmentMutation.mutate(
        {
          chapterId: chapterId,
          text,
          orderIndex: pendingDropIndex,
          ttsEngine: defaultEngine,
          ttsModelName: effectiveModelName,
          ttsSpeakerName: defaultSpeaker,
          language: effectiveLanguage,
          segmentType: 'standard',
        },
        {
          onSuccess: () => {
            showSnackbar(t('segments.textSegmentCreated'), { severity: 'success' })
            resolve()
          },
          onError: (error) => {
            logger.error('[SegmentList] Failed to create text segment', { error })
            reject(error)
          },
        }
      )
    })
  }, [hasSpeakers, defaultSpeaker, createSegmentMutation, chapterId, pendingDropIndex, defaultEngine, effectiveModelName, effectiveLanguage, t, showSnackbar])

  const handleCreateDivider = useCallback(async (pauseDuration: number) => {
    return new Promise<void>((resolve, reject) => {
      createSegmentMutation.mutate(
        {
          chapterId: chapterId,
          text: '',
          orderIndex: pendingDropIndex,
          ttsEngine: defaultEngine,
          ttsModelName: effectiveModelName,
          ttsSpeakerName: defaultSpeaker,
          language: effectiveLanguage,
          segmentType: 'divider',
          pauseDuration: pauseDuration,
        },
        {
          onSuccess: () => {
            showSnackbar(t('segments.pauseCreated', { seconds: pauseDuration / 1000 }), { severity: 'success' })
            resolve()
          },
          onError: (error) => {
            logger.error('[SegmentList] Failed to create divider', { error })
            reject(error)
          },
        }
      )
    })
  }, [createSegmentMutation, chapterId, pendingDropIndex, defaultEngine, effectiveModelName, defaultSpeaker, effectiveLanguage, t, showSnackbar])

  // ============================================================================
  // Render
  // ============================================================================

  const activeSegment = localSegments.find((s) => s.id === activeId)

  return (
    <Box data-testid="segment-list" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
            <Box
              ref={listRef}
              sx={{
                flex: 1,
                overflow: 'auto',
                px: 2,
                py: 0,
                position: 'relative',
              }}
            >
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
                <Box
                  sx={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {/* Render only visible items for performance */}
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const segment = localSegments[virtualRow.index]
                    const index = virtualRow.index

                    return (
                      <Box
                        key={segment.id}
                        sx={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                      >
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
                            speakers={speakers ?? emptySpeakersArray}
                            canAnalyzeQuality={canAnalyzeQuality}
                            onSegmentClick={onSegmentClick ?? emptyOnSegmentClick}
                            onSegmentPlay={onSegmentPlay}
                            onSegmentEdit={onSegmentEdit}
                            onSegmentEditSettings={onSegmentEditSettings}
                            onSegmentDelete={onSegmentDelete}
                            onSegmentRegenerate={onSegmentRegenerate}
                            onAnalyzeWithWhisper={handleAnalyzeWithWhisper}
                            onUpdatePause={handleUpdatePause}
                            onSegmentFreeze={handleFreezeSegment}
                            onSegmentUnfreeze={handleUnfreezeSegment}
                          />
                        </div>
                      </Box>
                    )
                  })}

                  {/* Drop Zone for appending at end */}
                  <Box
                    sx={{
                      position: 'absolute',
                      top: `${rowVirtualizer.getTotalSize()}px`,
                      left: 0,
                      width: '100%',
                    }}
                  >
                    <DropZone isActive={!!activeId} />
                  </Box>
                </Box>
              )}
            </Box>
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
      <SnackbarComponent />
    </Box>
  )
}
