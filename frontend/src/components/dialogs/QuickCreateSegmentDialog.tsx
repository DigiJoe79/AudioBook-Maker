/**
 * Quick Create Segment Dialog
 * Opens after dragging "Text Segment" from CommandToolbar
 */

import React, { useState, useEffect } from 'react'
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
import { useError } from '@hooks/useError'
import { useAppStore } from '@store/appStore'
import { useSegmentLimits } from '@hooks/useSettings'
import { logger } from '@utils/logger'

interface QuickCreateSegmentDialogProps {
  open: boolean
  chapterId: string
  orderIndex: number
  onClose: () => void
  onConfirm: (text: string) => Promise<void>
}

// Fallback limit if API call fails or while loading
const DEFAULT_MAX_LENGTH = 250

export default function QuickCreateSegmentDialog({
  open,
  chapterId,
  orderIndex,
  onClose,
  onConfirm,
}: QuickCreateSegmentDialogProps) {
  const { t } = useTranslation()
  const { showError, ErrorDialog } = useError()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  // Get default engine from app store (DB)
  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine())

  // Fetch segment limits based on default engine
  const { data: limits } = useSegmentLimits(defaultEngine)

  // Use effective limit from API or fallback to default
  const maxSegmentLength = limits?.effectiveLimit || DEFAULT_MAX_LENGTH

  // Reset text after dialog closes (after animation completes)
  useEffect(() => {
    if (!open) {
      // Wait for closing animation to complete (300ms)
      const timer = setTimeout(() => {
        setText('')
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleConfirm = async () => {
    if (!text.trim()) return

    setLoading(true)
    try {
      logger.group(
        '✂️ Segment',
        'Creating segment',
        {
          'Text Length': text.trim().length,
          'Max Length': maxSegmentLength,
          'Chapter ID': chapterId,
          'Order Index': orderIndex,
          'Text Preview': text.trim().substring(0, 50) + (text.trim().length > 50 ? '...' : '')
        },
        '#FF9800'  // Orange badge color
      )

      await onConfirm(text.trim())
      setText('')
      onClose()
    } catch (err) {
      logger.error('[QuickCreateSegmentDialog] Failed to create segment:', err)
      await showError(
        t('quickCreateSegment.title'),
        t('quickCreateSegment.failed')
      )
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    // State will be reset after successful creation (see handleConfirm Line 75)
    onClose()
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && text.trim()) {
      handleConfirm()
    }
  }

  // Validation
  const isTextValid = text.trim().length > 0 && text.trim().length <= maxSegmentLength
  const isOverLimit = text.length > maxSegmentLength

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="quick-create-segment-dialog"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1}>
          <Add />
          {t('quickCreateSegment.title')}
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
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
              maxLength: maxSegmentLength + 50, // Allow typing over limit to show error
              'data-testid': 'quick-create-segment-text-input',
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!isTextValid || loading}
          data-testid="quick-create-segment-submit"
        >
          {loading ? t('quickCreateSegment.creating') : t('quickCreateSegment.create')}
        </Button>
      </DialogActions>

      {/* Error Dialog */}
      <ErrorDialog />
    </Dialog>
  )
}
