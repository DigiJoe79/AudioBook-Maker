/**
 * StartPage - Backend Connection & Profile Management
 *
 * This is the entry point of the application where users:
 * - Select/manage backend connection profiles
 * - Check backend status
 * - Connect to a backend before entering the main app
 */

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

  // Profile management state
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [manageDialogOpen, setManageDialogOpen] = useState(false)

  // Initialize profiles on mount
  useEffect(() => {
    initializeDefaultProfile()
    const loadedProfiles = loadProfiles()
    setProfiles(loadedProfiles)

    // Auto-select default profile or first available
    const defaultProfile = loadedProfiles.find((p) => p.isDefault)
    const profileToSelect = defaultProfile || loadedProfiles[0]
    if (profileToSelect) {
      setSelectedProfileId(profileToSelect.id)
    }
  }, [])

  // Listen to localStorage changes from other tabs
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

  // Backend health check (with polling)
  const { isOnline, version, ttsEngines, busy, activeJobs, isLoading, error } = useBackendHealth(
    selectedProfile?.url || null,
    {
      polling: true,
      interval: 5000,
      enabled: !!selectedProfile,
    }
  )

  // Handle connect button
  const handleConnect = async () => {
    logger.group(
      '🔌 Connection Request',
      'User clicked connect button',
      {
        'Profile Name': selectedProfile?.name || 'None',
        'Backend Online': isOnline,
        'Backend Version': version || 'Unknown',
        'Profile URL': selectedProfile?.url || 'N/A'
      },
      '#2196F3' // Blue for connection operations
    )

    if (!selectedProfile || !isOnline) {
      logger.group(
        '⚠️ Connection Blocked',
        'Missing requirements for connection',
        {
          'Has Profile': !!selectedProfile,
          'Backend Online': isOnline,
          'Reason': !selectedProfile ? 'No profile selected' : 'Backend offline'
        },
        '#FF9800' // Orange for warning
      )
      return
    }

    logger.group(
      '🔌 Connecting to Backend',
      'Establishing backend connection',
      {
        'Profile': selectedProfile.name,
        'URL': selectedProfile.url,
        'Version': version || 'unknown'
      },
      '#2196F3' // Blue for connection
    )

    // Update last connected timestamp
    markProfileAsConnected(selectedProfile.id)

    // Set backend connection in store
    // Use version if available, otherwise default to "unknown"
    setBackendConnection(selectedProfile, version || 'unknown')

    logger.group(
      '✅ Backend Connected',
      'Connection established in store',
      {
        'Profile': selectedProfile.name,
        'Version': version || 'unknown',
        'Store Updated': true
      },
      '#4CAF50' // Green for success
    )

    // Load global settings from backend
    try {
      const settings = await fetchSettings()
      loadSettings(settings)

      logger.group(
        '⚙️ Settings Loaded',
        'Global settings fetched from backend',
        {
          'Default Engine': settings.tts.defaultTtsEngine || 'Not set',
          'Default Model': settings.tts.defaultTtsModelName || 'Not set',
          'Default Speaker': settings.tts.defaultTtsSpeaker || 'Not set',
          'Source': 'Backend /api/settings'
        },
        '#607D8B' // Gray for settings
      )

      // If no default speaker is set in settings, get it from backend and save to settings
      if (!settings.tts.defaultTtsSpeaker) {
        logger.group(
          '🎤 Speaker Discovery',
          'No default speaker in settings, fetching from backend',
          {
            'Current Speaker': 'None',
            'Action': 'Query backend for default speaker',
            'Will Persist': true
          },
          '#9C27B0' // Purple for speaker operations
        )

        try {
          const defaultSpeaker = await getDefaultSpeaker()
          if (defaultSpeaker) {
            logger.group(
              '🎤 Default Speaker Found',
              'Speaker retrieved from backend',
              {
                'Speaker Name': defaultSpeaker.name,
                'Speaker ID': defaultSpeaker.id,
                'Action': 'Saving to settings'
              },
              '#9C27B0' // Purple for speaker
            )

            // Update settings in backend to persist the default speaker
            const updatedTtsSettings = {
              ...settings.tts,
              defaultTtsSpeaker: defaultSpeaker.name
            }
            await updateSettings('tts', updatedTtsSettings)
            // Update local store
            loadSettings({ ...settings, tts: updatedTtsSettings })

            logger.group(
              '✅ Speaker Saved',
              'Default speaker persisted to backend',
              {
                'Speaker': defaultSpeaker.name,
                'Updated in Backend': true,
                'Updated in Store': true
              },
              '#4CAF50' // Green for success
            )
          } else {
            logger.group(
              '⚠️ No Default Speaker',
              'Backend has no default speaker configured',
              {
                'Speakers Table': 'No rows with is_default=TRUE',
                'Action': 'Continuing without default speaker',
                'User Impact': 'Must select speaker manually'
              },
              '#FF9800' // Orange for warning
            )
          }
        } catch (error) {
          logger.group(
            '❌ Speaker Fetch Failed',
            'Failed to fetch/save default speaker',
            {
              'Error': error instanceof Error ? error.message : String(error),
              'Action': 'Continuing without default speaker'
            },
            '#F44336' // Red for error
          )
        }
      }

      // IMPORTANT: No longer setting session overrides here!
      // The appStore uses computed getters (getCurrentTtsEngine(), etc.) that automatically
      // read from settings.tts.defaultTtsEngine, settings.tts.defaultTtsSpeaker, etc.
      // Session overrides are only set when user explicitly changes values during session.
    } catch (error) {
      logger.group(
        '❌ Settings Load Failed',
        'Failed to load global settings from backend',
        {
          'Error': error instanceof Error ? error.message : String(error),
          'Action': 'Continuing with defaults',
          'User Impact': 'Will use hardcoded defaults'
        },
        '#F44336' // Red for error
      )
      // Continue anyway - will use defaults
    }

    // Navigate to main app
    logger.group(
      '🚀 Navigation',
      'Navigating to main application',
      {
        'Route': '/app',
        'Connection Established': true,
        'Settings Loaded': true
      },
      '#4CAF50' // Green for success/navigation
    )
    navigate('/app')
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
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography variant="h4" gutterBottom>
              🎙️ Audiobook Maker
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('startPage.subtitle')}
            </Typography>
          </Box>

          {/* Profile Selection */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
              {t('startPage.backendConnection')}
            </Typography>

            <Paper variant="outlined" sx={{ p: 3, mt: 1 }}>
              {/* Profile Dropdown */}
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

              {/* URL Display */}
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

              {/* Status Display */}
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

          {/* Backend Information (only when online) */}
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

          {/* Connect Button */}
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleConnect}
            disabled={!isOnline || isLoading}
          >
            {t('startPage.connect')}
          </Button>

          {/* Helper text */}
          {!selectedProfile && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block', textAlign: 'center' }}>
              {t('startPage.createProfileHint')}
            </Typography>
          )}
      </Paper>

      {/* Profile Manager Dialog */}
      <ProfileManagerDialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
        onProfilesChanged={() => {
          // Reload profiles when changed
          const loadedProfiles = loadProfiles()
          setProfiles(loadedProfiles)

          // If current selection was deleted, select first available
          if (!loadedProfiles.find((p) => p.id === selectedProfileId)) {
            setSelectedProfileId(loadedProfiles[0]?.id || null)
          }
        }}
      />
    </Box>
  )
}

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
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
