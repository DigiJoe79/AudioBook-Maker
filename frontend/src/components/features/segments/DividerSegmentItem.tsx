/**
 * DividerSegmentItem - Visual representation of pause/scene break segments
 *
 * Performance optimizations:
 * - React.memo with custom comparison
 * - useCallback for all event handlers
 */

import React, { useState, useCallback, useMemo } from 'react'
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  Stack,
  Divider,
  ListItem,
  ListItemButton,
} from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SegmentMenu from './SegmentMenu'
import QuickCreateDividerDialog from '@components/dialogs/QuickCreateDividerDialog'
import type { Segment } from '@types'
import { useTranslation } from 'react-i18next'

/**
 * Props for drag handle - combination of DnD Kit's attributes and listeners
 * Using Record type since DnD Kit spreads both accessibility attributes and event handlers
 */
type DragHandleProps = Record<string, unknown>

interface DividerSegmentItemProps {
  segment: Segment
  isSelected: boolean
  isDragging?: boolean
  isOver?: boolean
  onSelect: () => void
  onDelete: () => void
  onUpdatePause: (pauseDuration: number) => void
  dragHandleProps?: DragHandleProps
}

/**
 * Divider Segment Item Component
 * Displays pause/scene break segments with editable duration
 */
const DividerSegmentItem = React.memo(function DividerSegmentItem({
  segment,
  isSelected,
  isDragging,
  isOver = false,
  onSelect,
  onDelete,
  onUpdatePause,
  dragHandleProps,
}: DividerSegmentItemProps) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)

  // Memoized handlers to prevent new function references
  const handleMenuClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    setMenuAnchorEl(e.currentTarget)
  }, [])

  const handleMenuClose = useCallback(() => {
    setMenuAnchorEl(null)
  }, [])

  const handleEditClick = useCallback(() => {
    setDialogOpen(true)
  }, [])

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false)
  }, [])

  const handleUpdatePause = useCallback(async (newDuration: number) => {
    onUpdatePause(newDuration)
    // Give mutation a moment to start
    await new Promise(resolve => setTimeout(resolve, 100))
  }, [onUpdatePause])

  const pauseSeconds = useMemo(() => segment.pauseDuration / 1000, [segment.pauseDuration])

  return (
    <Paper
      elevation={isSelected ? 2 : 0}
      onClick={onSelect}
      data-testid={`segment-${segment.id}`}
      data-segment-type="divider"
      sx={{
        mb: 1,
        bgcolor: isSelected ? 'action.selected' : 'background.paper',
        borderLeft: 3,
        borderColor: 'primary.main',
        transition: 'all 0.2s',
        opacity: isDragging ? 0.5 : 1,
        '&:hover': {
          bgcolor: 'action.hover',
          elevation: 1,
        },
      }}
    >
      <ListItem disablePadding>
        <ListItemButton sx={{ py: 1.5, px: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
            {/* Drag Handle - Left */}
            <Box
              {...dragHandleProps}
              data-testid="divider-icon"
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
              <DragIndicatorIcon fontSize="small" />
            </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {/* Invisible spacers to align More button with normal segments */}
            <IconButton size="small" sx={{ visibility: 'hidden' }} disabled>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" sx={{ visibility: 'hidden' }} disabled>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Tooltip title={t('segments.actions.moreActions')}>
              <IconButton
                size="small"
                onClick={handleMenuClick}
                data-testid="segment-menu-button"
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {/* Column Layout - Same as normal segments */}
        <Box sx={{ display: 'flex', gap: 2.5, flex: 1, alignItems: 'center', my: 0.5, ml: 0.5 }}>
          {/* Column 1: Segment Number (blue chip with tooltip) */}
          <Box sx={{ flexShrink: 0 }}>
            <Tooltip title={t('dividerSegment.sceneBreak')} arrow>
              <Chip
                label={segment.orderIndex + 1}
                size="small"
                sx={{
                  minWidth: 45,
                  height: 24,
                  fontSize: '0.8rem',
                  fontWeight: 'medium',
                  bgcolor: 'primary.main',
                  color: 'white',
                  '& .MuiChip-label': {
                    px: 1,
                  },
                }}
              />
            </Tooltip>
          </Box>

          {/* Vertical Divider */}
          <Divider orientation="vertical" flexItem sx={{ height: 24, alignSelf: 'center', borderRightWidth: 2, borderColor: 'white' }} />

          {/* Column 2: Description with duration */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.disabled" fontStyle="italic">
              {t('dividerSegment.description', { seconds: pauseSeconds })}
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
        onClose={handleMenuClose}
        onEdit={handleEditClick}
        onDelete={onDelete}
        segmentType="divider"
      />

      {/* Edit Pause Duration Dialog */}
      <QuickCreateDividerDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        onConfirm={handleUpdatePause}
        initialDuration={segment.pauseDuration}
        mode="edit"
      />
    </Paper>
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Only re-render if relevant props actually changed
  return (
    prevProps.segment.id === nextProps.segment.id &&
    prevProps.segment.pauseDuration === nextProps.segment.pauseDuration &&
    prevProps.segment.orderIndex === nextProps.segment.orderIndex &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.isOver === nextProps.isOver
  )
})

export default DividerSegmentItem
