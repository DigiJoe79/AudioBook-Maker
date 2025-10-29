
import React, { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
} from '@mui/material'
import { Add } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store/appStore'
import { useSegmentLimits } from '../../hooks/useSettings'

interface QuickCreateSegmentDialogProps {
  open: boolean
  chapterId: string
  orderIndex: number
  onClose: () => void
  onConfirm: (text: string) => Promise<void>
}

const DEFAULT_MAX_LENGTH = 250

export default function QuickCreateSegmentDialog({
  open,
  chapterId,
  orderIndex,
  onClose,
  onConfirm,
}: QuickCreateSegmentDialogProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  const currentEngine = useAppStore((state) => state.getCurrentEngine())

  const { data: limits } = useSegmentLimits(currentEngine)

  const maxSegmentLength = limits?.effectiveLimit || DEFAULT_MAX_LENGTH

  const handleConfirm = async () => {
    if (!text.trim()) return

    setLoading(true)
    try {
      await onConfirm(text.trim())
      setText('')
      onClose()
    } catch (err) {
      console.error('Failed to create segment:', err)
      alert(t('quickCreateSegment.failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setText('')
    onClose()
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && text.trim()) {
      handleConfirm()
    }
  }

  const isTextValid = text.trim().length > 0 && text.trim().length <= maxSegmentLength
  const isOverLimit = text.length > maxSegmentLength

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Add />
          {t('quickCreateSegment.title')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('quickCreateSegment.description')}
          </Typography>

          <TextField
            autoFocus
            label={t('quickCreateSegment.label')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyPress={handleKeyPress}
            fullWidth
            multiline
            rows={6}
            placeholder={t('quickCreateSegment.placeholder')}
            error={isOverLimit}
            sx={{ mt: 2 }}
            helperText={
              isOverLimit
                ? t('segments.textTooLong', { count: text.length - maxSegmentLength })
                : `${text.length}/${maxSegmentLength} ${t('segments.characters')}`
            }
            inputProps={{
              maxLength: maxSegmentLength + 50,
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!isTextValid || loading}
        >
          {loading ? t('quickCreateSegment.creating') : t('quickCreateSegment.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
