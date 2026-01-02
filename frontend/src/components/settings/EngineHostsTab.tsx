/**
 * EngineHostsTab - Manage engine hosts and their engines
 *
 * Unified view for all engine hosts (local subprocess, Docker local, Docker remote)
 * and their associated engines with install/discover functionality.
 */

import React, { useState, useCallback, useMemo, memo, useEffect } from 'react'
import {
  Box,
  Typography,
  Button,
  IconButton,
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Collapse,
  Badge,
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Computer as ComputerIcon,
  Cloud as CloudIcon,
  Storage as DockerIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Sync as SyncIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { engineHostsApi, engineApi, type EngineHost } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import { SettingsSection } from '@components/settings/SettingsComponents'
import HostEnginesSection from '@components/settings/HostEnginesSection'
import AddImagePopover from '@components/settings/AddImagePopover'
import AddHostDialog from '@components/settings/AddHostDialog'
import HostSettingsDialog from '@components/settings/HostSettingsDialog'
import { useConfirm } from '@hooks/useConfirm'
import { useSnackbar } from '@hooks/useSnackbar'
import { useAllEnginesStatus } from '@hooks/useEnginesQuery'
import { translateBackendError } from '@utils/translateBackendError'
import { logger } from '@utils/logger'
import type { EngineStatusInfo } from '@/types/engines'

// ============================================================================
// Session-level flag for auto-update check (resets on page refresh)
// ============================================================================

let hasCheckedUpdatesThisSession = false

// ============================================================================
// Host Icon Component
// ============================================================================

const HostIcon = memo(({ hostType }: { hostType: string }) => {
  if (hostType === 'subprocess') {
    return <ComputerIcon />
  }
  if (hostType === 'docker:local') {
    return <DockerIcon />
  }
  return <CloudIcon />
})

HostIcon.displayName = 'HostIcon'

// ============================================================================
// EngineHostsTab Component
// ============================================================================

const EngineHostsTab = memo(() => {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const queryClient = useQueryClient()

  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({})
  const [addImageAnchor, setAddImageAnchor] = useState<{ el: HTMLElement; hostId: string } | null>(null)
  const [showAddHostDialog, setShowAddHostDialog] = useState(false)
  const [settingsDialogHost, setSettingsDialogHost] = useState<EngineHost | null>(null)

  // Update check state (shared with HostEnginesSection)
  const [updateStatus, setUpdateStatus] = useState<Record<string, { checking: boolean; updateAvailable: boolean | null; error: string | null }>>({})
  const [checkingAllHosts, setCheckingAllHosts] = useState<Record<string, boolean>>({})

  // Fetch Engine Hosts
  const { data: hostsData, isLoading: hostsLoading, error: hostsError } = useQuery({
    queryKey: queryKeys.engineHosts.all(),
    queryFn: engineHostsApi.getAll,
    staleTime: 30000,
  })

  // Fetch all engines status (to group by host)
  const { data: enginesData, isLoading: enginesLoading } = useAllEnginesStatus()

  // Delete host mutation
  const deleteMutation = useMutation({
    mutationFn: engineHostsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engineHosts.all() })
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      showSnackbar(t('settings.dockerHosts.messages.deleted'), { severity: 'success' })
    },
    onError: (err: Error) => {
      logger.error('[EngineHostsTab] Delete failed:', err)
      showSnackbar(translateBackendError(err.message, t), { severity: 'error' })
    },
  })

  // Delete handler
  const handleDelete = useCallback(async (host: EngineHost) => {
    if (host.hostId === 'local') {
      showSnackbar(t('settings.dockerHosts.messages.cannotDeleteLocal'), { severity: 'warning' })
      return
    }

    const confirmed = await confirm(
      t('settings.dockerHosts.deleteTitle'),
      t('settings.dockerHosts.deleteConfirm', { name: host.displayName }),
      { confirmColor: 'error' }
    )

    if (confirmed) {
      deleteMutation.mutate(host.hostId)
    }
  }, [confirm, deleteMutation, showSnackbar, t])

  // Toggle host expansion
  const handleToggleHost = useCallback((hostId: string) => {
    setExpandedHosts(prev => ({ ...prev, [hostId]: !prev[hostId] }))
  }, [])

  // Handle single engine update check
  const handleCheckUpdate = useCallback(async (engine: EngineStatusInfo) => {
    if (!engine.dockerImage) return

    const variantId = engine.variantId
    setUpdateStatus(prev => ({
      ...prev,
      [variantId]: { checking: true, updateAvailable: null, error: null }
    }))

    try {
      const result = await engineApi.checkUpdate(variantId)
      setUpdateStatus(prev => ({
        ...prev,
        [variantId]: {
          checking: false,
          updateAvailable: result.updateAvailable,
          error: result.error
        }
      }))

      if (result.updateAvailable === true) {
        showSnackbar(t('settings.engineHosts.updateAvailable', 'Update available!'), { severity: 'info' })
      } else if (result.updateAvailable === false) {
        showSnackbar(t('settings.engineHosts.upToDate', 'Image is up to date'), { severity: 'success' })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('settings.engineHosts.checkFailed', 'Check failed')
      setUpdateStatus(prev => ({
        ...prev,
        [variantId]: {
          checking: false,
          updateAvailable: null,
          error: errorMsg
        }
      }))
      showSnackbar(translateBackendError(errorMsg, t), { severity: 'error' })
    }
  }, [showSnackbar, t])

  // Handle check all updates for a host
  const handleCheckAllUpdates = useCallback(async (hostId: string, hostEngines: EngineStatusInfo[]) => {
    const dockerEngines = hostEngines.filter(
      e => e.runnerType?.startsWith('docker') && e.isInstalled && e.dockerImage
    )

    if (dockerEngines.length === 0) return

    setCheckingAllHosts(prev => ({ ...prev, [hostId]: true }))

    // Set all to checking state
    const initialStatus: Record<string, { checking: boolean; updateAvailable: boolean | null; error: string | null }> = {}
    for (const engine of dockerEngines) {
      initialStatus[engine.variantId] = { checking: true, updateAvailable: null, error: null }
    }
    setUpdateStatus(prev => ({ ...prev, ...initialStatus }))

    // Check all in parallel
    const results = await Promise.allSettled(
      dockerEngines.map(async (engine) => {
        const result = await engineApi.checkUpdate(engine.variantId)
        return { variantId: engine.variantId, result }
      })
    )

    // Process results
    let updatesAvailable = 0
    let upToDate = 0

    const newStatus: Record<string, { checking: boolean; updateAvailable: boolean | null; error: string | null }> = {}
    for (const res of results) {
      if (res.status === 'fulfilled') {
        const { variantId, result } = res.value
        newStatus[variantId] = {
          checking: false,
          updateAvailable: result.updateAvailable,
          error: result.error
        }
        if (result.updateAvailable === true) updatesAvailable++
        else if (result.updateAvailable === false) upToDate++
      }
    }

    setUpdateStatus(prev => ({ ...prev, ...newStatus }))
    setCheckingAllHosts(prev => ({ ...prev, [hostId]: false }))

    // Show summary
    if (updatesAvailable > 0) {
      showSnackbar(
        t('settings.engineHosts.checkAllResult', '{{updates}} updates available, {{upToDate}} up to date', {
          updates: updatesAvailable,
          upToDate: upToDate
        }),
        { severity: 'info' }
      )
    } else if (upToDate > 0) {
      showSnackbar(
        t('settings.engineHosts.allUpToDate', 'All {{count}} images are up to date', { count: upToDate }),
        { severity: 'success' }
      )
    }
  }, [showSnackbar, t])

  // Handle update complete - clear update status for the variant
  const handleUpdateComplete = useCallback((variantId: string) => {
    setUpdateStatus(prev => {
      const next = { ...prev }
      delete next[variantId]
      return next
    })
  }, [])

  // Group engines by host
  const enginesByHost = useMemo(() => {
    const grouped: Record<string, EngineStatusInfo[]> = {}

    const allEngines = [
      ...(enginesData?.tts || []),
      ...(enginesData?.stt || []),
      ...(enginesData?.text || []),
      ...(enginesData?.audio || []),
    ]

    for (const engine of allEngines) {
      // Determine host from runnerType (subprocess | docker:local | docker:remote)
      let hostId = 'local'
      if (engine.runnerType === 'docker:local') {
        hostId = 'docker:local'
      } else if (engine.runnerType === 'docker:remote') {
        hostId = engine.runnerHost ? `docker:${engine.runnerHost}` : 'docker:remote'
      }

      if (!grouped[hostId]) {
        grouped[hostId] = []
      }
      grouped[hostId].push(engine)
    }

    return grouped
  }, [enginesData])

  // Auto-check all Docker engines for updates on first session load
  useEffect(() => {
    // Skip if already checked this session, still loading, or no data
    if (hasCheckedUpdatesThisSession || hostsLoading || enginesLoading) return
    if (!hostsData?.hosts || !enginesData) return

    // Collect all Docker engines across all hosts
    const allDockerEngines: Array<{ hostId: string; engines: EngineStatusInfo[] }> = []

    for (const host of hostsData.hosts) {
      const hostEngines = enginesByHost[host.hostId] || []
      const dockerEngines = hostEngines.filter(
        e => e.runnerType?.startsWith('docker') && e.isInstalled && e.dockerImage
      )
      if (dockerEngines.length > 0) {
        allDockerEngines.push({ hostId: host.hostId, engines: dockerEngines })
      }
    }

    // Skip if no Docker engines to check
    if (allDockerEngines.length === 0) {
      hasCheckedUpdatesThisSession = true
      return
    }

    // Mark as checked before starting (prevent re-runs)
    hasCheckedUpdatesThisSession = true
    logger.info(`[EngineHostsTab] Auto-checking updates for ${allDockerEngines.reduce((sum, h) => sum + h.engines.length, 0)} Docker engines on ${allDockerEngines.length} hosts`)

    // Check all hosts in parallel
    for (const { hostId, engines } of allDockerEngines) {
      handleCheckAllUpdates(hostId, engines)
    }
  }, [hostsData, enginesData, hostsLoading, enginesLoading, enginesByHost, handleCheckAllUpdates])

  const isLoading = hostsLoading || enginesLoading

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (hostsError) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {t('settings.dockerHosts.messages.loadError')}
      </Alert>
    )
  }

  const hosts = hostsData?.hosts || []

  return (
    <Box>
      <SettingsSection
        title={t('settings.engineHosts.title', 'Engine Hosts')}
        sx={{ mb: (theme) => theme.custom.spacing.lg }}
      >
        <Box sx={{ mb: (theme) => theme.custom.spacing.md }}>
          <Typography variant="body2" color="text.secondary">
            {t('settings.engineHosts.description', 'Manage hosts where engines run. Local engines run as subprocesses, Docker engines run in containers.')}
          </Typography>
        </Box>

        {/* Hosts List */}
        <Stack spacing={2}>
          {hosts.map((host) => {
            const hostEngines = enginesByHost[host.hostId] || []
            const isExpanded = expandedHosts[host.hostId] ?? true
            const isLocal = host.hostId === 'local'

            return (
              <Paper
                key={host.hostId}
                variant="outlined"
                sx={{ p: (theme) => theme.custom.spacing.md }}
              >
                {/* Host Header Row */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: (theme) => theme.custom.spacing.md }}>
                  {/* Icon with connection status badge (Docker hosts only) */}
                  <Tooltip
                    title={host.hostType !== 'subprocess'
                      ? (host.isAvailable ? t('settings.dockerHosts.status.connected', 'Connected') : t('settings.dockerHosts.status.disconnected', 'Disconnected'))
                      : ''
                    }
                  >
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      badgeContent={
                        host.hostType !== 'subprocess' ? (
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              bgcolor: host.isAvailable ? 'success.main' : 'error.main',
                              border: '2px solid',
                              borderColor: 'background.paper',
                            }}
                          />
                        ) : null
                      }
                    >
                      <Box sx={{ color: 'text.primary', display: 'flex' }}>
                        <HostIcon hostType={host.hostType} />
                      </Box>
                    </Badge>
                  </Tooltip>

                  {/* Info */}
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={600}>{host.displayName}</Typography>
                    {(host.sshUrl || host.hasGpu != null) && (
                      <Typography variant="caption" color="text.secondary">
                        {host.sshUrl}
                        {host.sshUrl && host.hasGpu != null && ' | '}
                        {host.hasGpu === true && (
                          <Box component="span" sx={{ color: 'success.main' }}>
                            {t('settings.engineHosts.gpu', 'GPU')}
                          </Box>
                        )}
                        {host.hasGpu === false && (
                          <Box component="span" sx={{ color: 'text.disabled' }}>
                            {t('settings.engineHosts.noGpu', 'No GPU')}
                          </Box>
                        )}
                      </Typography>
                    )}
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: (theme) => theme.custom.spacing.xs }}>
                    {/* Add Image Button (only for Docker hosts) */}
                    {(host.hostType === 'docker:local' || host.hostType === 'docker:remote') && (
                      <>
                        <Tooltip title={t('settings.addImage.buttonTooltip', 'Add engine from catalog')}>
                          <IconButton
                            onClick={(e) => setAddImageAnchor({ el: e.currentTarget, hostId: host.hostId })}
                            size="small"
                            color="primary"
                            aria-label={t('settings.addImage.buttonTooltip', 'Add engine from catalog')}
                            sx={{ p: 0.5 }}
                          >
                            <AddIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                        {/* Check All Updates Button */}
                        {hostEngines.some(e => e.runnerType?.startsWith('docker') && e.isInstalled) && (
                          <Tooltip title={t('settings.engineHosts.checkAllUpdates', 'Check all images for updates')}>
                            <IconButton
                              onClick={() => handleCheckAllUpdates(host.hostId, hostEngines)}
                              disabled={checkingAllHosts[host.hostId]}
                              size="small"
                              aria-label={t('settings.engineHosts.checkAllUpdates', 'Check all images for updates')}
                              sx={{ p: 0.5 }}
                            >
                              {checkingAllHosts[host.hostId] ? (
                                <CircularProgress size={16} />
                              ) : (
                                <SyncIcon sx={{ fontSize: 18 }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={t('settings.hostSettings.title', 'Host Settings')}>
                          <IconButton
                            onClick={() => setSettingsDialogHost(host)}
                            size="small"
                            aria-label={t('settings.hostSettings.title', 'Host Settings')}
                            sx={{ p: 0.5 }}
                          >
                            <SettingsIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}

                    {/* Delete (only for remote hosts) */}
                    {!isLocal && host.hostType !== 'docker:local' && (
                      <Tooltip title={t('common.delete')}>
                        <IconButton
                          onClick={() => handleDelete(host)}
                          color="error"
                          size="small"
                          aria-label={t('common.delete')}
                          sx={{ p: 0.5 }}
                        >
                          <DeleteIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* Expand/Collapse */}
                    <Tooltip title={isExpanded ? t('common.collapse') : t('common.expand')}>
                      <IconButton
                        onClick={() => handleToggleHost(host.hostId)}
                        size="small"
                        aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
                        sx={{ p: 0.5 }}
                      >
                        {isExpanded ? <CollapseIcon sx={{ fontSize: 18 }} /> : <ExpandIcon sx={{ fontSize: 18 }} />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Warning banner for unavailable Docker hosts */}
                {host.hostType !== 'subprocess' && !host.isAvailable && (
                  <Alert severity="warning" sx={{ mt: 1, mb: 1 }}>
                    {t('settings.engineHosts.hostUnavailable', 'Host not reachable - engines cannot be started')}
                  </Alert>
                )}

                {/* Engines Section */}
                <Collapse in={isExpanded}>
                  <HostEnginesSection
                    hostId={host.hostId}
                    engines={hostEngines}
                    hostAvailable={host.hostType === 'subprocess' || host.isAvailable}
                    updateStatus={updateStatus}
                    onCheckUpdate={handleCheckUpdate}
                    onUpdateComplete={handleUpdateComplete}
                  />
                </Collapse>
              </Paper>
            )
          })}
        </Stack>

        {/* Add Host Button */}
        <Button
          startIcon={<AddIcon />}
          onClick={() => setShowAddHostDialog(true)}
          sx={{ mt: (theme) => theme.custom.spacing.md }}
        >
          {t('settings.dockerHosts.addHost')}
        </Button>
      </SettingsSection>

      <ConfirmDialog />
      <SnackbarComponent />

      {/* Add Image Popover */}
      <AddImagePopover
        anchorEl={addImageAnchor?.el ?? null}
        onClose={() => setAddImageAnchor(null)}
        hostId={addImageAnchor?.hostId ?? ''}
      />

      {/* Add Host Dialog */}
      <AddHostDialog
        open={showAddHostDialog}
        onClose={() => setShowAddHostDialog(false)}
      />

      {/* Host Settings Dialog */}
      {settingsDialogHost && (
        <HostSettingsDialog
          open={!!settingsDialogHost}
          onClose={() => setSettingsDialogHost(null)}
          host={settingsDialogHost}
        />
      )}
    </Box>
  )
})

EngineHostsTab.displayName = 'EngineHostsTab'

export default EngineHostsTab
