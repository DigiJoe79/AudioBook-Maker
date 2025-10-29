
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
  open: boolean

  onClose: () => void

  onConfirm: () => void

  title: string

  message: string

  confirmText?: string

  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning'

  cancelText?: string
}

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
