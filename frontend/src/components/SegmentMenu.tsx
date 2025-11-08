/**
 * SegmentMenu - Dropdown menu for secondary segment actions
 * Accessed via the ⋮ (more) icon in segment items
 */

import React from 'react'
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material'
import { Edit, Delete, Settings } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface SegmentMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onEditSettings?: () => void
  onDelete: () => void
  segmentType?: 'standard' | 'divider'
}

export default function SegmentMenu({
  anchorEl,
  open,
  onClose,
  onEdit,
  onEditSettings,
  onDelete,
  segmentType = 'standard',
}: SegmentMenuProps) {
  const { t } = useTranslation()

  const handleEdit = () => {
    onEdit()
    onClose()
  }

  const handleEditSettings = () => {
    onEditSettings?.()
    onClose()
  }

  const handleDelete = () => {
    onDelete()
    onClose()
  }

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
    >
      <MenuItem onClick={handleEdit}>
        <ListItemIcon>
          <Edit fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {segmentType === 'divider' ? t('segmentMenu.editPauseDuration') : t('segmentMenu.editText')}
        </ListItemText>
      </MenuItem>

      {/* Settings option only for standard segments */}
      {segmentType === 'standard' && onEditSettings && (
        <MenuItem onClick={handleEditSettings}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('segmentMenu.editSettings')}</ListItemText>
        </MenuItem>
      )}

      <Divider />

      <MenuItem onClick={handleDelete}>
        <ListItemIcon>
          <Delete fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t('segmentMenu.deleteSegment')}</ListItemText>
      </MenuItem>
    </Menu>
  )
}
