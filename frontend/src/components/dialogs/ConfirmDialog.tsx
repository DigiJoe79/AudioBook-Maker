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
  Box,
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

  /** Optional icon to display in title */
  icon?: React.ReactNode

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
 * import { Warning as WarningIcon } from '@mui/icons-material'
 *
 * <ConfirmDialog
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Project?"
 *   message="This action cannot be undone."
 *   icon={<WarningIcon color="error" />}
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
  icon,
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
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      data-testid="confirm-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {icon ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {icon}
            <Typography variant="h6">{title}</Typography>
          </Box>
        ) : (
          title
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Typography sx={{ color: 'text.primary' }}>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button data-testid="confirm-dialog-cancel" onClick={onClose}>{cancelText || t('common.cancel')}</Button>
        <Button data-testid="confirm-dialog-confirm" onClick={handleConfirm} color={confirmColor} variant="contained">
          {confirmText || t('common.ok')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
