/**
 * NoSpeakersOverlay
 *
 * Overlay shown when no speakers are available in the system.
 * Guides user to add speakers in Settings.
 */

import { Box, Paper, Typography, Button, Stack } from '@mui/material'
import { RecordVoiceOver as SpeakerIcon, Settings as SettingsIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface NoSpeakersOverlayProps {
  onOpenSettings: () => void
}

export function NoSpeakersOverlay({ onOpenSettings }: NoSpeakersOverlayProps) {
  const { t } = useTranslation()

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)',
      }}
    >
      <Paper
        elevation={8}
        sx={{
          maxWidth: 500,
          p: 4,
          textAlign: 'center',
        }}
      >
        <Stack spacing={3}>
          {/* Icon */}
          <Box>
            <SpeakerIcon
              sx={{
                fontSize: 80,
                color: 'primary.main',
                opacity: 0.8,
              }}
            />
          </Box>

          {/* Title */}
          <Typography variant="h5" fontWeight="bold">
            {t('noSpeakers.title')}
          </Typography>

          {/* Description */}
          <Typography variant="body1" color="text.secondary">
            {t('noSpeakers.description')}
          </Typography>

          {/* Steps */}
          <Box sx={{ textAlign: 'left', pl: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('noSpeakers.steps.title')}
            </Typography>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                <Typography variant="body2">{t('noSpeakers.steps.step1')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('noSpeakers.steps.step2')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('noSpeakers.steps.step3')}</Typography>
              </li>
            </ol>
          </Box>

          {/* Action Button */}
          <Button
            variant="contained"
            size="large"
            startIcon={<SettingsIcon />}
            onClick={onOpenSettings}
            sx={{ mt: 2 }}
          >
            {t('noSpeakers.openSettings')}
          </Button>

          {/* Help Text */}
          <Typography variant="caption" color="text.secondary">
            {t('noSpeakers.helpText')}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  )
}
