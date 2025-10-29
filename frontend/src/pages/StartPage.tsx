
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Paper,
  Select,
  MenuItem,
  FormControl,
  Button,
  Chip,
  CircularProgress,
  Tooltip,
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'
import { useBackendHealth } from '../hooks/useBackendHealth'
import {
  loadProfiles,
  initializeDefaultProfile,
  markProfileAsConnected,
} from '../services/backendProfiles'
import type { BackendProfile } from '../types/backend'
import { useAppStore } from '../store/appStore'
import { ProfileManagerDialog } from '../components/dialogs/ProfileManagerDialog'
import { getDefaultSpeaker, fetchSettings, updateSettings } from '../services/settingsApi'
import { useTranslation } from 'react-i18next'
import { logger } from '../utils/logger'

export default function StartPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setBackendConnection = useAppStore((state) => state.setBackendConnection)
  const loadSettings = useAppStore((state) => state.loadSettings)

  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [manageDialogOpen, setManageDialogOpen] = useState(false)

  useEffect(() => {
    initializeDefaultProfile()
    const loadedProfiles = loadProfiles()
    setProfiles(loadedProfiles)

    const defaultProfile = loadedProfiles.find((p) => p.isDefault)
    const profileToSelect = defaultProfile || loadedProfiles[0]
    if (profileToSelect) {
      setSelectedProfileId(profileToSelect.id)
    }
  }, [])

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'audiobook-maker:backend-profiles') {
        setProfiles(loadProfiles())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)

  const { isOnline, version, ttsEngines, busy, activeJobs, isLoading, error } = useBackendHealth(
    selectedProfile?.url || null,
    {
      polling: true,
      interval: 5000,
      enabled: !!selectedProfile,
    }
  )

  const handleConnect = async () => {
    logger.info('[StartPage] Connect button clicked', {
      profileName: selectedProfile?.name,
      isOnline,
      version,
    })

    if (!selectedProfile || !isOnline) {
      logger.debug('[StartPage] Connect blocked - missing requirements')
      return
    }

    logger.info('[StartPage] Connecting to backend...')

    markProfileAsConnected(selectedProfile.id)

    setBackendConnection(selectedProfile, version || 'unknown')
    logger.info('[StartPage] Backend connection set in store')

    try {
      const settings = await fetchSettings()
      loadSettings(settings)

      logger.info('[StartPage] Global settings loaded from backend:', {
        engine: settings.tts.defaultEngine,
        model: settings.tts.defaultModelName,
        speaker: settings.tts.defaultSpeaker,
      })

      if (!settings.tts.defaultSpeaker) {
        logger.debug('[StartPage] No default speaker in settings, fetching from backend...')
        try {
          const defaultSpeaker = await getDefaultSpeaker()
          if (defaultSpeaker) {
            logger.info('[StartPage] Found default speaker from backend:', defaultSpeaker.name)
            const updatedTtsSettings = {
              ...settings.tts,
              defaultSpeaker: defaultSpeaker.name
            }
            await updateSettings('tts', updatedTtsSettings)
            loadSettings({ ...settings, tts: updatedTtsSettings })
            logger.info('[StartPage] Default speaker saved to settings:', defaultSpeaker.name)
          } else {
            logger.warn('[StartPage] No default speaker found in backend (no speakers with is_default=TRUE)')
          }
        } catch (error) {
          logger.warn('[StartPage] Failed to fetch/save default speaker:', error)
        }
      }

    } catch (error) {
      logger.warn('[StartPage] Failed to load global settings:', error)
    }

    navigate('/app')
    logger.info('[StartPage] Navigating to /app')
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        p: 3,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 600,
          width: '100%',
        }}
      >
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography variant="h4" gutterBottom>
              🎙️ Audiobook Maker
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('startPage.subtitle')}
            </Typography>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
              {t('startPage.backendConnection')}
            </Typography>

            <Paper variant="outlined" sx={{ p: 3, mt: 1 }}>
              <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                <FormControl size="small" sx={{ flex: '0 1 65%' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('startPage.profile')}
                  </Typography>
                  <Select
                    value={selectedProfileId || ''}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    displayEmpty
                  >
                    {profiles.length === 0 ? (
                      <MenuItem value="">{t('startPage.noProfiles')}</MenuItem>
                    ) : (
                      profiles.map((profile) => (
                        <MenuItem key={profile.id} value={profile.id}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography>{profile.name}</Typography>
                            {profile.isDefault && (
                              <Chip label={t('startPage.default')} size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
                            )}
                          </Box>
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>

                <Button
                  variant="outlined"
                  startIcon={<SettingsIcon />}
                  onClick={() => setManageDialogOpen(true)}
                  sx={{
                    whiteSpace: 'nowrap',
                    mt: '24px',
                    flex: '1 1 auto',
                    height: '40px'
                  }}
                >
                  {t('startPage.manage')}
                </Button>
              </Box>

              {selectedProfile && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('startPage.url')}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      bgcolor: 'background.default',
                      p: 1,
                      borderRadius: 1,
                      mt: 0.5,
                    }}
                  >
                    {selectedProfile.url}
                  </Typography>
                </Box>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('startPage.status')}:
                </Typography>
                {isLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" color="text.secondary">
                      {t('startPage.checking')}
                    </Typography>
                  </Box>
                ) : isOnline ? (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label={t('startPage.online')}
                    color="success"
                    size="small"
                  />
                ) : (
                  <Tooltip
                    title={error?.message || t('startPage.notReachable')}
                    arrow
                    placement="top"
                  >
                    <Chip
                      icon={<ErrorIcon />}
                      label={t('startPage.offline')}
                      color="error"
                      size="small"
                    />
                  </Tooltip>
                )}
              </Box>
            </Paper>
          </Box>

          {isOnline && version && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                {t('startPage.backendInfo')}
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('startPage.version')}:
                    </Typography>
                    <Typography variant="body2">{version}</Typography>
                  </Box>

                  {ttsEngines.length > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('startPage.engines')}:
                      </Typography>
                      <Typography variant="body2">{ttsEngines.join(', ')}</Typography>
                    </Box>
                  )}

                  {busy && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('startPage.status')}:
                      </Typography>
                      <Typography variant="body2" color="warning.main">
                        {t('startPage.busy', { count: activeJobs })}
                      </Typography>
                    </Box>
                  )}

                  {selectedProfile?.lastConnected && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('startPage.lastConnected')}:
                      </Typography>
                      <Typography variant="body2">
                        {formatRelativeTime(selectedProfile.lastConnected, t)}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            </Box>
          )}

          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleConnect}
            disabled={!isOnline || isLoading}
          >
            {t('startPage.connect')}
          </Button>

          {!selectedProfile && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block', textAlign: 'center' }}>
              {t('startPage.createProfileHint')}
            </Typography>
          )}
      </Paper>

      <ProfileManagerDialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
        onProfilesChanged={() => {
          const loadedProfiles = loadProfiles()
          setProfiles(loadedProfiles)

          if (!loadedProfiles.find((p) => p.id === selectedProfileId)) {
            setSelectedProfileId(loadedProfiles[0]?.id || null)
          }
        }}
      />
    </Box>
  )
}

function formatRelativeTime(date: Date, t: any): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return t('startPage.timeAgo.justNow')
  if (diffMinutes < 60) return t('startPage.timeAgo.minutesAgo', { count: diffMinutes })
  if (diffHours < 24) return t('startPage.timeAgo.hoursAgo', { count: diffHours })
  if (diffDays < 7) return t('startPage.timeAgo.daysAgo', { count: diffDays })
  return date.toLocaleDateString()
}
