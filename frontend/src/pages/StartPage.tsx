/**
 * StartPage - Backend Connection & Profile Management
 *
 * This is the entry point of the application where users:
 * - Select/manage backend connection profiles
 * - Check backend status
 * - Connect to a backend before entering the main app
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
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
import { useBackendHealth } from '@hooks/useBackendHealth'
import {
  loadProfiles,
  initializeDefaultProfile,
  markProfileAsConnected,
} from '@services/backendProfiles'
import type { BackendProfile } from '@types'
import { useAppStore } from '@store/appStore'
import { ProfileManagerDialog } from '@components/dialogs/ProfileManagerDialog'
import { fetchSettings, updateSettings } from '@services/settingsApi'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { logger } from '@utils/logger'
import { useError } from '@hooks/useError'

export default function StartPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setBackendConnection = useAppStore((state) => state.setBackendConnection)
  const loadSettings = useAppStore((state) => state.loadSettings)
  const updateEngineAvailability = useAppStore((state) => state.updateEngineAvailability)
  const { showError, ErrorDialog } = useError()

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
  const {
    isOnline,
    version,
    ttsEngines,
    busy,
    activeJobs,
    hasTtsEngine,
    hasTextEngine,
    hasSttEngine,
    isLoading,
    error
  } = useBackendHealth(
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

    // Update engine availability for feature-gating
    // Note: hasAudioEngine comes from engine.status SSE events, not health check
    updateEngineAvailability({
      hasTtsEngine,
      hasTextEngine,
      hasSttEngine,
      hasAudioEngine: false,  // Will be updated via engine.status SSE
    })

    logger.group(
      '✅ Backend Connected',
      'Connection established in store',
      {
        'Profile': selectedProfile.name,
        'Version': version || 'unknown',
        'Store Updated': true,
        'TTS Engines': ttsEngines.length
      },
      '#4CAF50' // Green for success
    )

    // Load global settings from backend (audio export, text segmentation, quality settings)
    // Note: Default engines are managed via engines.is_default (Single Source of Truth)
    try {
      const settings = await fetchSettings()
      loadSettings(settings)

      logger.group(
        '⚙️ Settings Loaded',
        'Global settings fetched from backend',
        { 'Source': 'Backend /api/settings' },
        '#607D8B' // Gray for settings
      )
    } catch (error) {
      logger.group(
        '❌ Settings Load Failed',
        'Failed to load global settings from backend',
        {
          'Error': error instanceof Error ? error.message : String(error),
          'Action': 'Continuing with defaults'
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
    <>
      <ErrorDialog />
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
    </>
  )
}

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
function formatRelativeTime(date: Date, t: TFunction): string {
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
