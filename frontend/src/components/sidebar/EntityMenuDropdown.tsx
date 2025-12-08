/**
 * EntityMenuDropdown - Generic dropdown menu for entity actions (edit/delete)
 * Used by ProjectMenu and ChapterMenu to avoid code duplication
 */

import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material'
import { Edit, Delete } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { memo, useCallback } from 'react'

interface EntityMenuDropdownProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  /** Translation key prefix (e.g., 'chapters' or 'projects') */
  i18nPrefix: string
}

function EntityMenuDropdown({
  anchorEl,
  open,
  onClose,
  onEdit,
  onDelete,
  i18nPrefix,
}: EntityMenuDropdownProps) {
  const { t } = useTranslation()

  const handleEdit = useCallback(() => {
    onEdit()
    onClose()
  }, [onEdit, onClose])

  const handleDelete = useCallback(() => {
    onDelete()
    onClose()
  }, [onDelete, onClose])

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
      data-testid={`${i18nPrefix}-menu`}
    >
      <MenuItem onClick={handleEdit} data-testid={`${i18nPrefix}-menu-edit`}>
        <ListItemIcon>
          <Edit fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t(`${i18nPrefix}.edit`)}</ListItemText>
      </MenuItem>

      <MenuItem onClick={handleDelete} data-testid={`${i18nPrefix}-menu-delete`}>
        <ListItemIcon>
          <Delete fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t(`${i18nPrefix}.delete`)}</ListItemText>
      </MenuItem>
    </Menu>
  )
}

export default memo(EntityMenuDropdown)
