/**
 * ErrorDialog - Generic error dialog
 *
 * Reusable dialog component for displaying error messages.
 * Used as a replacement for native alert() with Material-UI theming.
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
import { Error as ErrorIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

export interface ErrorDialogProps {
  /** Whether the dialog is open */
  open: boolean

  /** Callback when dialog should close */
  onClose: () => void

  /** Dialog title */
  title: string

  /** Error message/description */
  message: string

  /** Optional custom icon to display in title */
  icon?: React.ReactNode

  /** Text for the close button (default: "OK") */
  closeText?: string
}

/**
 * Generic error dialog
 *
 * @example
 * ```tsx
 * <ErrorDialog
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="Generation Failed"
 *   message="Failed to start audio generation. Please try again."
 * />
 * ```
 */
export function ErrorDialog({
  open,
  onClose,
  title,
  message,
  icon,
  closeText,
}: ErrorDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {icon || <ErrorIcon color="error" />}
          <Typography variant="h6">{title}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Typography sx={{ color: 'text.primary' }}>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={onClose} color="primary" variant="contained">
          {closeText || t('common.ok')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
