/**
 * EmptySpeakersState
 *
 * Empty state component shown in SpeakersView when no speakers exist.
 * Guides first-time users through creating their first speaker.
 */

import { Box, Paper, Typography, Button, Stack } from '@mui/material'
import { Mic as MicIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface EmptySpeakersStateProps {
  onCreateFirst: () => void
}

export function EmptySpeakersState({ onCreateFirst }: EmptySpeakersStateProps) {
  const { t } = useTranslation()

  return (
    <Box
      data-testid="empty-speakers-state"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        textAlign: 'center',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 600,
          p: 4,
          backgroundColor: 'transparent',
        }}
      >
        <Stack spacing={3}>
          {/* Hero Icon */}
          <Box>
            <MicIcon
              sx={{
                fontSize: 100,
                color: 'primary.main',
                opacity: 0.8,
              }}
            />
          </Box>

          {/* Title */}
          <Typography variant="h4" fontWeight="bold">
            {t('speakers.empty.title')}
          </Typography>

          {/* Description */}
          <Typography variant="body1" color="text.secondary">
            {t('speakers.empty.description')}
          </Typography>

          {/* Steps */}
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              textAlign: 'left',
              backgroundColor: 'background.default',
            }}
          >
            <Typography variant="subtitle2" color="primary" gutterBottom fontWeight="bold">
              {t('speakers.empty.steps.title')}
            </Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              {/* Step 1 */}
              <Box display="flex" alignItems="flex-start" gap={2}>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontWeight: 'bold',
                    fontSize: 16,
                  }}
                >
                  1
                </Box>
                <Box>
                  <Typography variant="body1" fontWeight="bold">
                    {t('speakers.empty.steps.step1.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('speakers.empty.steps.step1.description')}
                  </Typography>
                </Box>
              </Box>

              {/* Step 2 */}
              <Box display="flex" alignItems="flex-start" gap={2}>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontWeight: 'bold',
                    fontSize: 16,
                  }}
                >
                  2
                </Box>
                <Box>
                  <Typography variant="body1" fontWeight="bold">
                    {t('speakers.empty.steps.step2.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('speakers.empty.steps.step2.description')}
                  </Typography>
                </Box>
              </Box>

              {/* Step 3 */}
              <Box display="flex" alignItems="flex-start" gap={2}>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontWeight: 'bold',
                    fontSize: 16,
                  }}
                >
                  3
                </Box>
                <Box>
                  <Typography variant="body1" fontWeight="bold">
                    {t('speakers.empty.steps.step3.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('speakers.empty.steps.step3.description')}
                  </Typography>
                </Box>
              </Box>
            </Stack>
          </Paper>

          {/* CTA Button */}
          <Button
            data-testid="empty-speakers-create-button"
            variant="contained"
            size="large"
            startIcon={<MicIcon />}
            onClick={onCreateFirst}
            sx={{ mt: 2, px: 4, py: 1.5 }}
          >
            {t('speakers.empty.cta')}
          </Button>

          {/* Help Text */}
          <Typography variant="body2" color="text.secondary">
            {t('speakers.empty.helpText')}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  )
}
