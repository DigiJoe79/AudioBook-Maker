/**
 * ConfirmDialog - Generic confirmation dialog
 *
 * Reusable dialog component for confirming actions before execution.
 * Used for destructive or important actions that need user confirmation.
 */

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean

  /** Callback when dialog should close (cancel) */
  onClose: () => void

  /** Callback when user confirms the action */
  onConfirm: () => void

  /** Dialog title */
  title: string

  /** Dialog message/description */
  message: string

  /** Text for the confirm button (default: "Confirm") */
  confirmText?: string

  /** Color of the confirm button (default: "primary") */
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning'

  /** Text for the cancel button (default: "Cancel") */
  cancelText?: string
}

/**
 * Generic confirmation dialog
 *
 * @example
 * ```tsx
 * <ConfirmDialog
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Project?"
 *   message="This action cannot be undone."
 *   confirmText="Delete"
 *   confirmColor="error"
 * />
 * ```
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  confirmColor = 'primary',
  cancelText,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelText || t('common.cancel')}</Button>
        <Button onClick={handleConfirm} color={confirmColor} variant="contained">
          {confirmText || t('common.ok')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
