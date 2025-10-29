
import React, { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Slider,
} from '@mui/material'
import { PauseCircle } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store/appStore'

interface QuickCreateDividerDialogProps {
  open: boolean
  chapterId?: string
  orderIndex?: number
  initialDuration?: number
  mode?: 'create' | 'edit'
  onClose: () => void
  onConfirm: (pauseDuration: number) => Promise<void>
}

const MARKS = [
  { value: 0, label: '0s' },
  { value: 2000, label: '2s' },
  { value: 5000, label: '5s' },
  { value: 10000, label: '10s' },
]

export default function QuickCreateDividerDialog({
  open,
  chapterId,
  orderIndex,
  initialDuration,
  mode = 'create',
  onClose,
  onConfirm,
}: QuickCreateDividerDialogProps) {
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const defaultDuration = initialDuration ?? settings?.audio.defaultDividerDuration ?? 2000

  const [pauseDuration, setPauseDuration] = useState(defaultDuration)
  const [loading, setLoading] = useState(false)

  React.useEffect(() => {
    if (open) {
      setPauseDuration(defaultDuration)
    }
  }, [open, defaultDuration])

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm(pauseDuration)
      if (mode === 'create') {
        setPauseDuration(settings?.audio.defaultDividerDuration ?? 2000)
      }
      onClose()
    } catch (err) {
      console.error('Failed to', mode, 'divider:', err)
      alert(t(`quickCreateDivider.failed${mode === 'create' ? 'Create' : 'Edit'}`))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (mode === 'create') {
      setPauseDuration(settings?.audio.defaultDividerDuration ?? 2000)
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <PauseCircle />
          {mode === 'create' ? t('quickCreateDivider.titleCreate') : t('quickCreateDivider.titleEdit')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {mode === 'create'
              ? t('quickCreateDivider.descriptionCreate')
              : t('quickCreateDivider.descriptionEdit')}
          </Typography>

          <Box sx={{ mt: 3 }}>
            <Typography variant="h5" align="center" gutterBottom>
              {(pauseDuration / 1000).toFixed(1)}s
            </Typography>

            <Slider
              value={pauseDuration}
              onChange={(_, val) => setPauseDuration(val as number)}
              min={0}
              max={10000}
              step={500}
              marks={MARKS}
              valueLabelDisplay="auto"
              valueLabelFormat={(val) => `${(val / 1000).toFixed(1)}s`}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
          disabled={loading}
        >
          {loading
            ? (mode === 'create' ? t('quickCreateDivider.creating') : t('quickCreateDivider.saving'))
            : (mode === 'create' ? t('quickCreateDivider.addPause') : t('common.save'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
