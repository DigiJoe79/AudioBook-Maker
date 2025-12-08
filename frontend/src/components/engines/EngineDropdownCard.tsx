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
  Chip,
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
  PowerSettingsNew as PowerIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useStartEngine, useStopEngine, useEnableEngine, useDisableEngine } from '@hooks/useEnginesQuery'
import type { EngineStatusInfo, EngineType } from '@/types/engines'
import EngineStatusBadge from './EngineStatusBadge'

export interface EngineDropdownCardProps {
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
  /** Callback when engine enabled state changes */
  onToggleEnabled?: (engineName: string, enabled: boolean) => void
  /** Whether toggle is in progress */
  isTogglingEnabled?: boolean
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
  onToggleEnabled,
  isTogglingEnabled = false,
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

  // Enable/Disable mutations
  const enableMutation = useEnableEngine()
  const disableMutation = useDisableEngine()

  // Find the default engine, or fall back to first engine if no default is set
  // This handles both: engines with no default concept AND engines where default isn't set yet
  const foundDefault = currentDefault ? engines.find(e => e.name === currentDefault) : null
  const defaultEngine = foundDefault || engines[0]

  // Filter engines: exclude displayed engine from dropdown list
  const displayedEngineName = defaultEngine?.name
  const otherEngines = engines.filter(e => e.name !== displayedEngineName)

  // Show dropdown if there are other engines OR if there's only one engine (to show the hint)
  const hasEngines = engines.length > 0
  const hasOtherEngines = otherEngines.length > 0

  // Can start/stop logic - all engines can be started/stopped
  const canStart = defaultEngine?.isEnabled && !defaultEngine?.isRunning
  const canStop = defaultEngine?.isRunning

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
        engineName: defaultEngine.name,
      })
    }
  }, [defaultEngine, startMutation])

  const handleStopClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (defaultEngine) {
      stopMutation.mutate({
        engineType: defaultEngine.engineType,
        engineName: defaultEngine.name,
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
      engineName: engine.name,
    })
  }, [startMutation])

  const handleEngineStopClick = useCallback((event: React.MouseEvent, engine: EngineStatusInfo) => {
    event.stopPropagation()
    stopMutation.mutate({
      engineType: engine.engineType,
      engineName: engine.name,
    })
  }, [stopMutation])

  const handleToggleEnabled = useCallback((event: React.MouseEvent, engine: EngineStatusInfo) => {
    event.stopPropagation()
    if (engine.isEnabled) {
      disableMutation.mutate({
        engineType: engine.engineType,
        engineName: engine.name,
      })
    } else {
      enableMutation.mutate({
        engineType: engine.engineType,
        engineName: engine.name,
      })
    }
  }, [enableMutation, disableMutation])

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
          '&:hover': hasEngines ? {
            borderColor: theme.palette.primary.main,
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
                      disabled={startMutation.isPending}
                      color="primary"
                      sx={{ p: 0.5 }}
                    >
                      {startMutation.isPending ? (
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
                      disabled={stopMutation.isPending}
                      color="error"
                      sx={{ p: 0.5 }}
                    >
                      {stopMutation.isPending ? (
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

          {/* Engine Name + Status Badge */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="h6" component="div">
              {defaultEngine.displayName}
            </Typography>
            <EngineStatusBadge
              status={defaultEngine.status}
              port={defaultEngine.port}
              errorMessage={defaultEngine.errorMessage}
            />
          </Box>

          {/* Version + Auto-Stop Countdown */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            {defaultEngine.version && (
              <Typography variant="caption" color="text.secondary">
                {t('engines.version')}: {defaultEngine.version}
              </Typography>
            )}
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <DeviceIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                {defaultEngine.device?.toUpperCase()}
                {defaultEngine.port && ` • Port ${defaultEngine.port}`}
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
            <Divider key="divider" />,
            ...otherEngines.map((engine) => {
              const canSelect = engine.isEnabled
              const canEngineStart = engine.isEnabled && !engine.isRunning
              const canEngineStop = engine.isRunning
              const showStartStop = engineType === 'tts'

              return (
                <MenuItem
                  key={engine.name}
                  onClick={() => canSelect && handleSelectEngine(engine.name)}
                  disabled={isChangingDefault}
                  sx={{
                    cursor: canSelect ? 'pointer' : 'default',
                    py: 1.5,
                    '&:hover': !canSelect ? { backgroundColor: alpha(theme.palette.action.hover, 0.04) } : {},
                  }}
                >
                  <ListItemText
                    primaryTypographyProps={{ component: 'div' }}
                    secondaryTypographyProps={{ component: 'div' }}
                    primary={
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
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
                        </Box>
                        {/* Action buttons */}
                        <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()}>
                          {/* Start/Stop for TTS engines */}
                          {showStartStop && canEngineStart && (
                            <Tooltip title={t('engines.actions.start')}>
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={(e) => handleEngineStartClick(e, engine)}
                                  disabled={startMutation.isPending}
                                  color="primary"
                                  sx={{ p: 0.5 }}
                                >
                                  {startMutation.isPending ? (
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
                                  disabled={stopMutation.isPending}
                                  color="error"
                                  sx={{ p: 0.5 }}
                                >
                                  {stopMutation.isPending ? (
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
                          {/* Enable/Disable button */}
                          <Tooltip title={engine.isEnabled ? t('engines.actions.disable') : t('engines.actions.enable')}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={(e) => handleToggleEnabled(e, engine)}
                                disabled={enableMutation.isPending || disableMutation.isPending}
                                sx={{
                                  p: 0.5,
                                  color: engine.isEnabled ? 'success.main' : 'text.disabled',
                                }}
                              >
                                {(enableMutation.isPending || disableMutation.isPending) ? (
                                  <CircularProgress size={14} />
                                ) : (
                                  <PowerIcon sx={{ fontSize: 16 }} />
                                )}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </Stack>
                    }
                    secondary={
                      <Box sx={{ mt: 0.5 }}>
                        <EngineStatusBadge
                          status={engine.status}
                          port={engine.port}
                          errorMessage={engine.errorMessage}
                        />
                      </Box>
                    }
                  />
                </MenuItem>
              )
            })
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
