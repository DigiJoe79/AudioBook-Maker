/**
 * SegmentMenu - Dropdown menu for secondary segment actions
 * Accessed via the ⋮ (more) icon in segment items
 *
 * Performance optimized with React.memo and useCallback
 * to prevent unnecessary re-renders (rendered 400+ times)
 */

import React, { useCallback } from 'react'
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material'
import { Edit, Delete, Settings, Mic, LockOpen } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface SegmentMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onEditSettings?: () => void
  onAnalyzeWithWhisper?: () => void
  onDelete: () => void
  onUnfreeze?: () => void
  segmentType?: 'standard' | 'divider'
  hasAudio?: boolean
  isFrozen?: boolean
  /** Whether quality analysis is available (requires STT or Audio engine) */
  canAnalyzeQuality?: boolean
}

function SegmentMenu({
  anchorEl,
  open,
  onClose,
  onEdit,
  onEditSettings,
  onAnalyzeWithWhisper,
  onDelete,
  onUnfreeze,
  segmentType = 'standard',
  hasAudio = false,
  isFrozen = false,
  canAnalyzeQuality = true,
}: SegmentMenuProps) {
  const { t } = useTranslation()

  const handleEdit = useCallback(() => {
    onEdit()
    onClose()
  }, [onEdit, onClose])

  const handleEditSettings = useCallback(() => {
    onEditSettings?.()
    onClose()
  }, [onEditSettings, onClose])

  const handleAnalyzeWithWhisper = useCallback(() => {
    onAnalyzeWithWhisper?.()
    onClose()
  }, [onAnalyzeWithWhisper, onClose])

  const handleDelete = useCallback(() => {
    onDelete()
    onClose()
  }, [onDelete, onClose])

  const handleUnfreeze = useCallback(() => {
    onUnfreeze?.()
    onClose()
  }, [onUnfreeze, onClose])

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      data-testid="segment-menu"
    >
      <MenuItem onClick={handleEdit} disabled={isFrozen} data-testid="segment-menu-edit">
        <ListItemIcon>
          <Edit fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {segmentType === 'divider' ? t('segmentMenu.editPauseDuration') : t('segmentMenu.editText')}
        </ListItemText>
      </MenuItem>

      {/* Settings option only for standard segments */}
      {segmentType === 'standard' && onEditSettings && (
        <MenuItem onClick={handleEditSettings} disabled={isFrozen} data-testid="segment-menu-settings">
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('segmentMenu.editSettings')}</ListItemText>
        </MenuItem>
      )}

      {/* Quality analysis - only for standard segments */}
      {segmentType === 'standard' && onAnalyzeWithWhisper && (
        <Tooltip
          title={
            !canAnalyzeQuality
              ? t('quality.noEngineAvailable')
              : !hasAudio
              ? t('quality.generateFirst')
              : ''
          }
          placement="left"
        >
          <span>
            <MenuItem
              onClick={handleAnalyzeWithWhisper}
              disabled={isFrozen || !hasAudio || !canAnalyzeQuality}
              data-testid="segment-menu-analyze"
            >
              <ListItemIcon>
                <Mic fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('segmentMenu.analyzeQuality')}</ListItemText>
            </MenuItem>
          </span>
        </Tooltip>
      )}

      {/* Unfreeze option - only shown for frozen segments */}
      {isFrozen && onUnfreeze && (
        <MenuItem onClick={handleUnfreeze}>
          <ListItemIcon>
            <LockOpen fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('segmentMenu.unfreeze')}</ListItemText>
        </MenuItem>
      )}

      <Divider />

      <MenuItem onClick={handleDelete} disabled={isFrozen} data-testid="segment-menu-delete">
        <ListItemIcon>
          <Delete fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t('segmentMenu.deleteSegment')}</ListItemText>
      </MenuItem>
    </Menu>
  )
}

// Memoize component with custom comparison to prevent unnecessary re-renders
// Returns true when props are EQUAL (no re-render needed)
export default React.memo(SegmentMenu, (prevProps, nextProps) => {
  return (
    prevProps.open === nextProps.open &&
    prevProps.anchorEl === nextProps.anchorEl &&
    prevProps.segmentType === nextProps.segmentType &&
    prevProps.hasAudio === nextProps.hasAudio &&
    prevProps.isFrozen === nextProps.isFrozen &&
    prevProps.canAnalyzeQuality === nextProps.canAnalyzeQuality
  )
})
