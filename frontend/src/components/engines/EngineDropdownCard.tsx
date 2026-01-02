/**
 * EngineDropdownCard - Engine card that acts as a dropdown selector
 *
 * Shows the current default engine for a type, clicking opens a menu
 * to select a different engine as default. Settings icon opens engine config dialog.
 *
 * Features:
 * - Displays current default engine info (name, version, status)
 * - Start/Stop buttons for engine control
 * - Auto-stop countdown timer
 * - Device and port info when running
 * - Click to open menu with all available engines (enabled + disabled)
 * - Select different engine to set as new default
 * - Settings icon to open engine configuration dialog
 */

import React, { memo, useCallback, useState, useRef } from 'react'
import {
  Card,
  CardContent,
  Box,
  Typography,
  Stack,
  Menu,
  MenuItem,
  ListItemText,
  CircularProgress,
  Divider,
  alpha,
  useTheme,
  IconButton,
  Tooltip,
} from '@mui/material'
import {
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
  Devices as DeviceIcon,
  Add as AddIcon,
  Computer as ComputerIcon,
  Storage as DockerIcon,
  Cloud as CloudIcon,
  PowerOff as PowerOffIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useStartEngine, useStopEngine } from '@hooks/useEnginesQuery'
import type { EngineStatusInfo, EngineType } from '@/types/engines'
import { useStatusBorderColor, getStatusBorderColor } from './EngineStatusBadge'

interface EngineDropdownCardProps {
  /** Engine type (tts, stt, text, audio) */
  engineType: EngineType
  /** Title for this engine type */
  title: string
  /** All engines of this type */
  engines: EngineStatusInfo[]
  /** Current default engine name (optional for audio engines which have no default) */
  currentDefault?: string
  /** Callback when default engine changes (optional for audio engines) */
  onDefaultChange?: (engineName: string) => void
  /** Whether default change is in progress */
  isChangingDefault?: boolean
  /** Callback when settings icon is clicked */
  onSettingsClick?: (engine: EngineStatusInfo) => void
  /** Callback when settings icon is clicked for a non-default engine in dropdown */
  onEngineSettingsClick?: (engine: EngineStatusInfo) => void
}

const EngineDropdownCard = memo(({
  engineType,
  title,
  engines,
  currentDefault,
  onDefaultChange,
  isChangingDefault,
  onSettingsClick,
  onEngineSettingsClick,
}: EngineDropdownCardProps) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const open = Boolean(anchorEl)

  // Start/Stop mutations
  const startMutation = useStartEngine()
  const stopMutation = useStopEngine()

  // Find the default engine, or fall back to first engine if no default is set
  // This handles both: engines with no default concept AND engines where default isn't set yet
  // Note: currentDefault is now the full variantId (e.g., 'xtts:local') matching e.name
  const foundDefault = currentDefault ? engines.find(e => e.variantId === currentDefault) : null
  const defaultEngine = foundDefault || engines[0]

  // Status border color for the card
  const statusBorderColor = useStatusBorderColor(defaultEngine?.status ?? 'stopped')

  // Filter engines: exclude displayed engine from dropdown list
  const displayedEngineName = defaultEngine?.variantId
  const otherEngines = engines.filter(e => e.variantId !== displayedEngineName)

  // Show dropdown if there are other engines OR if there's only one engine (to show the hint)
  const hasEngines = engines.length > 0
  const hasOtherEngines = otherEngines.length > 0

  // Can start/stop logic - all engines can be started/stopped
  const canStart = defaultEngine?.isEnabled && !defaultEngine?.isRunning
  const canStop = defaultEngine?.isRunning

  // Check if THIS specific engine (on the card) is being started/stopped
  const isStartingDefault = startMutation.isPending && startMutation.variables?.engineName === defaultEngine?.variantId
  const isStoppingDefault = stopMutation.isPending && stopMutation.variables?.engineName === defaultEngine?.variantId

  const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (hasEngines) {
      setAnchorEl(event.currentTarget)
    }
  }, [hasEngines])

  const handleClose = useCallback(() => {
    setAnchorEl(null)
  }, [])

  const handleSelectEngine = useCallback((engineName: string) => {
    if (onDefaultChange && engineName !== displayedEngineName) {
      onDefaultChange(engineName)
    }
    handleClose()
  }, [displayedEngineName, onDefaultChange, handleClose])

  const handleSettingsClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (onSettingsClick && defaultEngine) {
      onSettingsClick(defaultEngine)
    }
  }, [onSettingsClick, defaultEngine])

  const handleStartClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (defaultEngine) {
      startMutation.mutate({
        engineType: defaultEngine.engineType,
        engineName: defaultEngine.variantId,
      })
    }
  }, [defaultEngine, startMutation])

  const handleStopClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (defaultEngine) {
      stopMutation.mutate({
        engineType: defaultEngine.engineType,
        engineName: defaultEngine.variantId,
      })
    }
  }, [defaultEngine, stopMutation])

  const handleEngineSettingsClick = useCallback((event: React.MouseEvent, engine: EngineStatusInfo) => {
    event.stopPropagation()
    if (onEngineSettingsClick) {
      onEngineSettingsClick(engine)
    }
    handleClose()
  }, [onEngineSettingsClick, handleClose])

  const handleEngineStartClick = useCallback((event: React.MouseEvent, engine: EngineStatusInfo) => {
    event.stopPropagation()
    startMutation.mutate({
      engineType: engine.engineType,
      engineName: engine.variantId,
    })
  }, [startMutation])

  const handleEngineStopClick = useCallback((event: React.MouseEvent, engine: EngineStatusInfo) => {
    event.stopPropagation()
    stopMutation.mutate({
      engineType: engine.engineType,
      engineName: engine.variantId,
    })
  }, [stopMutation])

  if (!defaultEngine) {
    // No default engine - show empty state
    return (
      <Card
        variant="outlined"
        sx={{
          height: '100%',
          opacity: 0.6,
        }}
      >
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('engines.noEngineConfigured')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card
        ref={cardRef}
        variant="outlined"
        onClick={handleClick}
        sx={{
          height: '100%',
          transition: 'all 0.2s ease',
          cursor: hasEngines ? 'pointer' : 'default',
          borderLeft: `3px solid ${statusBorderColor}`,
          '&:hover': hasEngines ? {
            borderColor: theme.palette.primary.main,
            borderLeftColor: statusBorderColor,
            boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
          } : {},
        }}
      >
        <CardContent sx={{ height: '100%', minHeight: 160 }}>
          {/* Header: Type Label + Action Buttons */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight="medium">
              {title}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {/* Start Button */}
              {canStart && (
                <Tooltip title={t('engines.actions.start')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleStartClick}
                      disabled={isStartingDefault}
                      color="primary"
                      sx={{ p: 0.5 }}
                    >
                      {isStartingDefault ? (
                        <CircularProgress size={16} />
                      ) : (
                        <PlayArrowIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              )}

              {/* Stop Button */}
              {canStop && (
                <Tooltip title={t('engines.actions.stop')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleStopClick}
                      disabled={isStoppingDefault}
                      sx={{ p: 0.5 }}
                    >
                      {isStoppingDefault ? (
                        <CircularProgress size={16} />
                      ) : (
                        <StopIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              )}

              {/* Settings Icon */}
              {onSettingsClick && (engineType === 'tts' || engineType === 'stt') && (
                <Tooltip title={t('engines.openSettings')}>
                  <IconButton
                    size="small"
                    onClick={handleSettingsClick}
                    sx={{ p: 0.5 }}
                  >
                    <SettingsIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}

              {/* Dropdown Indicator */}
              {hasEngines && (
                <ExpandMoreIcon
                  sx={{
                    fontSize: 18,
                    color: 'text.secondary',
                    transform: open ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}
                />
              )}
            </Stack>
          </Stack>

          {/* Engine Name */}
          <Typography variant="h6" component="div" sx={{ mb: 0.5 }}>
            {defaultEngine.displayName}
          </Typography>

          {/* Version + Loaded Model + Auto-Stop Countdown */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {defaultEngine.version && (
                <Typography variant="caption" color="text.secondary">
                  {t('engines.version')}: {defaultEngine.version}
                </Typography>
              )}
              {defaultEngine.isRunning && defaultEngine.loadedModel && (
                <Typography variant="caption" color="text.secondary">
                  • {t('engines.model')}: {defaultEngine.loadedModel}
                </Typography>
              )}
            </Box>
            {defaultEngine.secondsUntilAutoStop != null && defaultEngine.secondsUntilAutoStop > 0 && (
              <Typography variant="caption" color="warning.main">
                {t('engines.autoStopIn', {
                  time: `${Math.floor(defaultEngine.secondsUntilAutoStop / 60)}:${(defaultEngine.secondsUntilAutoStop % 60).toString().padStart(2, '0')}`,
                })}
              </Typography>
            )}
          </Box>

          {/* Device & Port Info (when running) */}
          {defaultEngine.isRunning && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
              <DeviceIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                {defaultEngine.device?.toUpperCase()}
                {defaultEngine.port && ` • Port ${defaultEngine.port}`}
                {/* VRAM usage for CUDA engines */}
                {defaultEngine.device === 'cuda' && defaultEngine.gpuMemoryUsedMb != null && (
                  <> • VRAM: {defaultEngine.gpuMemoryUsedMb} MB{defaultEngine.gpuMemoryTotalMb && ` / ${defaultEngine.gpuMemoryTotalMb} MB`}</>
                )}
              </Typography>
            </Box>
          )}

        </CardContent>
      </Card>

      {/* Dropdown Menu */}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        PaperProps={{
          sx: {
            // Match the width of the card
            width: cardRef.current?.offsetWidth || 300,
            minWidth: 280,
          }
        }}
      >
        {hasOtherEngines ? [
          <Typography key="select-title" variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
            {t('engines.selectDefaultEngine')}
          </Typography>,
          <Divider key="top-divider" />,

          /* Deactivated Option (disabled for TTS - must always have a default) */
          <Tooltip key="deactivate-tooltip" title={t('engines.ttsRequiresDefault')} placement="right">
            <span>
              <MenuItem
                disabled
                sx={{ py: 1.5, opacity: 0.5 }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                  <PowerOffIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                  <ListItemText
                    primary={t('engines.deactivated')}
                    secondary={t('engines.ttsRequiresDefaultShort')}
                    primaryTypographyProps={{ color: 'text.disabled' }}
                    secondaryTypographyProps={{ color: 'text.disabled' }}
                  />
                </Stack>
              </MenuItem>
            </span>
          </Tooltip>,
          <Divider key="deactivate-divider" />,

          /* Available Engines */
          ...otherEngines.map((engine) => {
            const canSelect = engine.isEnabled
            const canEngineStart = engine.isEnabled && !engine.isRunning
            const canEngineStop = engine.isRunning
            const showStartStop = engineType === 'tts'

            // Check if THIS specific engine is being started/stopped
            const isStartingThis = startMutation.isPending && startMutation.variables?.engineName === engine.variantId
            const isStoppingThis = stopMutation.isPending && stopMutation.variables?.engineName === engine.variantId

            // Determine icon based on runner type
            const RunnerIcon = engine.runnerType === 'subprocess'
              ? ComputerIcon
              : engine.runnerHost === 'local'
                ? DockerIcon
                : CloudIcon

            // Left border color based on engine status (same as card bottom border)
            const leftBorderColor = getStatusBorderColor(engine.status, theme)

            return (
              <MenuItem
                key={engine.variantId}
                onClick={() => canSelect && handleSelectEngine(engine.variantId)}
                disabled={isChangingDefault}
                sx={{
                  cursor: canSelect ? 'pointer' : 'default',
                  py: 1.5,
                  borderLeft: `3px solid ${leftBorderColor}`,
                  '&:hover': !canSelect ? { backgroundColor: alpha(theme.palette.action.hover, 0.04) } : {},
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                  <RunnerIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                  {/* Left side: Name + Variant ID */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        color: engine.isEnabled ? 'text.primary' : 'text.disabled',
                      }}
                    >
                      {engine.displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {engine.variantId}
                    </Typography>
                  </Box>
                  {/* Right side: Action buttons */}
                  <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()}>
                      {/* Start/Stop for TTS engines */}
                      {showStartStop && canEngineStart && (
                        <Tooltip title={t('engines.actions.start')}>
                          <span>
                            <IconButton
                              size="small"
                              onClick={(e) => handleEngineStartClick(e, engine)}
                              disabled={isStartingThis}
                              color="primary"
                              sx={{ p: 0.5 }}
                            >
                              {isStartingThis ? (
                                <CircularProgress size={14} />
                              ) : (
                                <PlayArrowIcon sx={{ fontSize: 16 }} />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      {showStartStop && canEngineStop && (
                        <Tooltip title={t('engines.actions.stop')}>
                          <span>
                            <IconButton
                              size="small"
                              onClick={(e) => handleEngineStopClick(e, engine)}
                              disabled={isStoppingThis}
                              sx={{ p: 0.5 }}
                            >
                              {isStoppingThis ? (
                                <CircularProgress size={14} />
                              ) : (
                                <StopIcon sx={{ fontSize: 16 }} />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      {/* Settings button for TTS/STT */}
                      {(engineType === 'tts' || engineType === 'stt') && onEngineSettingsClick && (
                        <Tooltip title={t('engines.openSettings')}>
                          <IconButton
                            size="small"
                            onClick={(e) => handleEngineSettingsClick(e, engine)}
                            sx={{ p: 0.5 }}
                          >
                            <SettingsIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                  </Stack>
                </Stack>
              </MenuItem>
            )
          }),
        ] : (
          // No other engines - show hint
          <Box sx={{ px: 2, py: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ color: 'text.secondary' }}>
              <AddIcon sx={{ fontSize: 18 }} />
              <Typography variant="body2" color="text.secondary">
                {t('engines.noOtherEngines')}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1, ml: 3.5 }}>
              {t('engines.addEngineHint')}
            </Typography>
          </Box>
        )}
        {isChangingDefault && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </Menu>
    </>
  )
})

EngineDropdownCard.displayName = 'EngineDropdownCard'

export default EngineDropdownCard
