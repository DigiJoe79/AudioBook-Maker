/**
 * ChapterMenu - Dropdown menu for chapter actions
 * Accessed via the ⋮ (more) icon in chapter items
 */

import React from 'react'
import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material'
import { Edit, Delete } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface ChapterMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ChapterMenu({
  anchorEl,
  open,
  onClose,
  onEdit,
  onDelete,
}: ChapterMenuProps) {
  const { t } = useTranslation()

  const handleEdit = () => {
    onEdit()
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
        <ListItemText>{t('chapters.edit')}</ListItemText>
      </MenuItem>

      <MenuItem onClick={handleDelete}>
        <ListItemIcon>
          <Delete fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t('chapters.delete')}</ListItemText>
      </MenuItem>
    </Menu>
  )
}
