/**
 * NavigationSidebar - Teams-Style Navigation Sidebar
 *
 * Vertical navigation bar with icon + label layout (72px wide).
 * Provides quick access to different views with keyboard shortcuts.
 *
 * Features:
 * - 7 navigation views (Activity, Import, Main, Settings, Pronunciation, Speakers, Jobs)
 * - Active state highlighting
 * - Tooltips with keyboard shortcuts
 * - Responsive design with Material-UI
 * - Performance optimized with React.memo
 */

import React, { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Box, Tooltip, Typography, useTheme, Badge, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress } from '@mui/material'
import {
  NotificationsActive as ActivityIcon,
  Upload as ImportIcon,
  LibraryMusic as MainIcon,
  Settings as SettingsIcon,
  Spellcheck as PronunciationIcon,
  RecordVoiceOver as SpeakersIcon,
  Assignment as JobsIcon,
  PowerSettingsNew as DisconnectIcon,
  Info as InfoIcon,
  PowerOff as ShutdownIcon,
  LinkOff as DisconnectOnlyIcon,
} from '@mui/icons-material'
import { useNavigationStore } from '@store/navigationStore'
import { useAppStore } from '@store/appStore'
import { getCurrentSessionState } from '@utils/sessionHelpers'
import type { ViewType } from '@types'
import { useTranslation } from 'react-i18next'
import { eventLogStore } from '@services/eventLog'
import { useActiveTTSJobs, useSpeakers } from '@hooks/useTTSQuery'
import { useActiveQualityJobs } from '@hooks/useQualityQuery'
import { logger } from '@utils/logger'
import { systemApi } from '@services/api'

const SIDEBAR_WIDTH = 72

interface NavigationItem {
  id: ViewType
  icon: React.ReactNode
  labelKey: string
  shortcut: string
}

// Main navigation items (top section) - Workflow-based order
const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: 'main', icon: <MainIcon />, labelKey: 'navigation.main', shortcut: 'Ctrl+1' },
  { id: 'import', icon: <ImportIcon />, labelKey: 'navigation.import', shortcut: 'Ctrl+2' },
  { id: 'speakers', icon: <SpeakersIcon />, labelKey: 'navigation.speakers', shortcut: 'Ctrl+3' },
  { id: 'pronunciation', icon: <PronunciationIcon />, labelKey: 'navigation.pronunciation', shortcut: 'Ctrl+4' },
  { id: 'monitoring', icon: <ActivityIcon />, labelKey: 'navigation.monitoring', shortcut: 'Ctrl+5' },
]

// Bottom navigation items (settings group)
const BOTTOM_NAVIGATION_ITEMS: NavigationItem[] = [
  { id: 'settings', icon: <SettingsIcon />, labelKey: 'navigation.settings', shortcut: 'Ctrl+6' },
]

// Special action item (not a view)
const DISCONNECT_ITEM = {
  icon: <DisconnectIcon />,
  labelKey: 'navigation.disconnect',
  shortcut: 'Ctrl+D',
}

/**
 * Navigation Item Button Component
 * Memoized for optimal performance with large navigation lists
 */
const NavigationItemButton = React.memo<{
  item: NavigationItem
  isActive: boolean
  onClick: () => void
  badgeCount?: number
  badgeColor?: 'primary' | 'error' | 'success' | 'warning'
  hideLabel?: boolean
  disabled?: boolean
  showWarning?: boolean
  warningTooltip?: string
}>(({ item, isActive, onClick, badgeCount = 0, badgeColor = 'primary', hideLabel = false, disabled = false, showWarning = false, warningTooltip }) => {
  const theme = useTheme()
  const { t } = useTranslation()

  const tooltipTitle = disabled
    ? t('navigation.requiresSpeaker')
    : showWarning && warningTooltip
    ? `${t(item.labelKey)} (${item.shortcut})\n${warningTooltip}`
    : `${t(item.labelKey)} (${item.shortcut})`

  return (
    <Tooltip
      title={tooltipTitle}
      placement="right"
      arrow
    >
      <Box
        onClick={disabled ? undefined : onClick}
        data-testid={`nav-${item.id}`}
        aria-selected={isActive}
        aria-disabled={disabled}
        sx={{
          width: SIDEBAR_WIDTH,
          height: 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          color: isActive ? theme.palette.primary.main : theme.palette.text.secondary,
          bgcolor: isActive ? theme.palette.action.selected : 'transparent',
          borderLeft: isActive ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
          transition: 'all 0.2s ease-in-out',
          position: 'relative',
          '&:hover': disabled ? {} : {
            bgcolor: theme.palette.action.hover,
            color: theme.palette.primary.main,
          },
          // Warning indicator dot
          ...(showWarning && {
            '&::after': {
              content: '""',
              position: 'absolute',
              right: 8,
              top: 8,
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'warning.main',
            }
          })
        }}
      >
        {/* Icon with Badge */}
        <Badge
          badgeContent={badgeCount}
          color={badgeColor}
          max={99}
          data-testid={badgeCount > 0 ? `${item.id}-badge` : undefined}
          sx={{
            '& .MuiBadge-badge': {
              fontSize: '0.6rem',
              height: 16,
              minWidth: 16,
              padding: '0 4px',
            },
          }}
        >
          <Box
            sx={{
              fontSize: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              '& > svg': {
                fontSize: 24,
              },
            }}
          >
            {item.icon}
          </Box>
        </Badge>

        {/* Label (optional) */}
        {!hideLabel && (
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.65rem',
              fontWeight: isActive ? 600 : 400,
              textAlign: 'center',
              lineHeight: 1.2,
              maxWidth: 60,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t(item.labelKey)}
          </Typography>
        )}
      </Box>
    </Tooltip>
  )
})

NavigationItemButton.displayName = 'NavigationItemButton'

/**
 * Main NavigationSidebar Component
 */
export const NavigationSidebar = React.memo(() => {
  const theme = useTheme()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const currentView = useNavigationStore((state) => state.currentView)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const disconnectBackend = useAppStore((state) => state.disconnectBackend)
  const saveSessionState = useAppStore((state) => state.saveSessionState)
  const currentProfile = useAppStore((state) => state.connection.profile)
  const canUseImport = useAppStore((state) => state.canUseImport())

  // Get badge counts for Monitoring tab
  // Show combined active jobs count (TTS + Quality)
  const { data: activeTTSJobsData } = useActiveTTSJobs()
  const { data: activeQualityJobsData } = useActiveQualityJobs()
  const activeTTSJobCount = activeTTSJobsData?.jobs.length || 0
  const activeQualityJobCount = activeQualityJobsData?.jobs.length || 0
  const activeJobCount = activeTTSJobCount + activeQualityJobCount

  // Check if any active speakers exist
  const { data: speakers } = useSpeakers()
  const hasActiveSpeakers = useMemo(() => {
    return speakers ? speakers.some((s) => s.isActive) : false
  }, [speakers])

  // Memoized badge counts to prevent unnecessary re-renders
  // Monitoring badge: Only active jobs count
  const badgeCounts = useMemo(
    () => ({
      monitoring: activeJobCount,
    }),
    [activeJobCount]
  )

  // Memoized click handlers for each view
  // Block navigation to certain views if no active speakers exist
  const handleClick = useCallback(
    (view: ViewType) => {
      // Views that require at least one active speaker
      const requiresSpeaker: ViewType[] = ['main', 'import', 'pronunciation', 'monitoring']

      if (requiresSpeaker.includes(view) && !hasActiveSpeakers) {
        // Stay on speakers view - don't allow navigation
        return
      }

      navigateTo(view)
    },
    [navigateTo, hasActiveSpeakers]
  )

  // Disconnect dialog state
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)
  const [isShuttingDown, setIsShuttingDown] = useState(false)

  // Open disconnect dialog
  const handleDisconnectClick = useCallback(() => {
    setDisconnectDialogOpen(true)
  }, [])

  // Close disconnect dialog
  const handleDisconnectCancel = useCallback(() => {
    setDisconnectDialogOpen(false)
  }, [])

  // Disconnect only (keep backend running)
  const handleDisconnectOnly = useCallback(() => {
    logger.group(
      '🔌 Backend Connection',
      'User Initiated Disconnect',
      {
        'Profile': currentProfile?.name || 'Unknown',
        'Action': 'Disconnecting (backend keeps running)'
      },
      '#2196F3'
    )

    // Save current session state for later restore
    const sessionState = getCurrentSessionState()
    saveSessionState(sessionState)

    // Disconnect from backend
    disconnectBackend()

    setDisconnectDialogOpen(false)

    // Navigate back to start page
    navigate('/', { replace: true })
  }, [currentProfile, saveSessionState, disconnectBackend, navigate])

  // Shutdown backend completely
  const handleShutdownBackend = useCallback(async () => {
    setIsShuttingDown(true)

    logger.group(
      '🔌 Backend Connection',
      'User Initiated Shutdown',
      {
        'Profile': currentProfile?.name || 'Unknown',
        'Action': 'Shutting down backend and all engines'
      },
      '#F44336'
    )

    try {
      // Call shutdown API
      await systemApi.shutdown()

      // Save session state
      const sessionState = getCurrentSessionState()
      saveSessionState(sessionState)

      // Wait a moment for backend to start shutdown
      await new Promise(resolve => setTimeout(resolve, 500))

      // Disconnect from frontend side
      disconnectBackend()

      setDisconnectDialogOpen(false)

      // Navigate back to start page
      navigate('/', { replace: true })
    } catch (error) {
      logger.error('Failed to shutdown backend', error)
      // Even if shutdown API fails, disconnect from frontend
      disconnectBackend()
      setDisconnectDialogOpen(false)
      navigate('/', { replace: true })
    } finally {
      setIsShuttingDown(false)
    }
  }, [currentProfile, saveSessionState, disconnectBackend, navigate])

  // Helper function to check if item should be disabled
  const isItemDisabled = useCallback(
    (itemId: ViewType) => {
      const requiresSpeaker: ViewType[] = ['main', 'import', 'pronunciation', 'monitoring']
      return requiresSpeaker.includes(itemId) && !hasActiveSpeakers
    },
    [hasActiveSpeakers]
  )

  // Helper function to get badge props for each item
  const getBadgeProps = useCallback(
    (itemId: ViewType) => {
      switch (itemId) {
        case 'monitoring':
          return {
            badgeCount: badgeCounts.monitoring,
            badgeColor: 'primary' as const,
            showWarning: false,
          }
        case 'import':
          return {
            badgeCount: 0,
            badgeColor: 'primary' as const,
            showWarning: !canUseImport,
            warningTooltip: !canUseImport ? t('nav.importWarning') : undefined,
          }
        default:
          return {
            badgeCount: 0,
            badgeColor: 'primary' as const,
            showWarning: false,
          }
      }
    },
    [badgeCounts, canUseImport, t]
  )

  return (
    <Box
      sx={{
        width: SIDEBAR_WIDTH,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Main Navigation Items (Top) */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
        }}
      >
        {NAVIGATION_ITEMS.map((item) => (
          <NavigationItemButton
            key={item.id}
            item={item}
            isActive={currentView === item.id}
            onClick={() => handleClick(item.id)}
            disabled={isItemDisabled(item.id)}
            {...getBadgeProps(item.id)}
          />
        ))}
      </Box>

      {/* Bottom Navigation Group (Settings + Disconnect) */}
      <Box
        sx={{
          mt: 'auto',
        }}
      >
        {/* Settings Button */}
        {BOTTOM_NAVIGATION_ITEMS.map((item) => (
          <NavigationItemButton
            key={item.id}
            item={item}
            isActive={currentView === item.id}
            onClick={() => handleClick(item.id)}
            {...getBadgeProps(item.id)}
          />
        ))}

        {/* Disconnect Button */}
        <Tooltip
          title={`${t(DISCONNECT_ITEM.labelKey)} (${DISCONNECT_ITEM.shortcut})`}
          placement="right"
          arrow
        >
          <Box
            onClick={handleDisconnectClick}
            data-testid="nav-disconnect"
            sx={{
              width: SIDEBAR_WIDTH,
              height: 72,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              cursor: 'pointer',
              color: theme.palette.text.secondary,
              bgcolor: 'transparent',
              borderLeft: '3px solid transparent',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                bgcolor: theme.palette.action.hover,
                color: theme.palette.error.main,
              },
            }}
          >
            {/* Icon */}
            <Box
              sx={{
                fontSize: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '& > svg': {
                  fontSize: 24,
                },
              }}
            >
              {DISCONNECT_ITEM.icon}
            </Box>

            {/* Label */}
            <Typography
              variant="caption"
              sx={{
                fontSize: '0.65rem',
                fontWeight: 400,
                textAlign: 'center',
                lineHeight: 1.2,
                maxWidth: 60,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {t(DISCONNECT_ITEM.labelKey)}
            </Typography>
          </Box>
        </Tooltip>
      </Box>

      {/* Disconnect Options Dialog */}
      <Dialog
        open={disconnectDialogOpen}
        onClose={handleDisconnectCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoIcon color="primary" />
          {t('disconnect.confirmTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('disconnect.confirmMessage', {
              name: currentProfile?.name || t('disconnect.unknownBackend')
            })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button
            onClick={handleDisconnectCancel}
            color="inherit"
            disabled={isShuttingDown}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDisconnectOnly}
            color="primary"
            variant="outlined"
            startIcon={<DisconnectOnlyIcon />}
            disabled={isShuttingDown}
          >
            {t('disconnect.disconnectOnly')}
          </Button>
          <Button
            onClick={handleShutdownBackend}
            color="error"
            variant="contained"
            startIcon={isShuttingDown ? <CircularProgress size={16} color="inherit" /> : <ShutdownIcon />}
            disabled={isShuttingDown}
          >
            {isShuttingDown ? t('disconnect.shuttingDown') : t('disconnect.shutdownBackend')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
})

NavigationSidebar.displayName = 'NavigationSidebar'
