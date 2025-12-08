/**
 * SingleEngineSelector - Simple dropdown for single-engine types (STT, Audio, Text)
 *
 * For engine types where only ONE engine can be active at a time (or none).
 * The selected engine becomes the default AND is automatically enabled.
 * Selecting "Deactivated" clears the default and disables the feature.
 *
 * Used for:
 * - STT (Speech-to-Text) - Quality Worker uses ONE STT engine
 * - Audio Analysis - Quality Worker uses ONE audio engine
 * - Text Processing - Segmentation uses ONE text engine
 *
 * NOT used for TTS which supports multiple concurrent engines.
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
  PowerOff as PowerOffIcon,
  Check as CheckIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useStartEngine, useStopEngine } from '@hooks/useEnginesQuery'
import type { EngineStatusInfo, EngineType } from '@/types/engines'
import EngineStatusBadge from './EngineStatusBadge'

export interface SingleEngineSelectorProps {
  /** Engine type (stt, text, audio) - NOT tts */
  engineType: Exclude<EngineType, 'tts'>
  /** Title for this engine type */
  title: string
  /** All available engines of this type */
  engines: EngineStatusInfo[]
  /** Currently active engine name (empty string = deactivated) */
  currentActive?: string
  /** Callback when active engine changes (empty string to deactivate) */
  onActiveChange: (engineName: string) => void
  /** Whether change is in progress */
  isChanging?: boolean
  /** Callback when settings icon is clicked */
  onSettingsClick?: (engine: EngineStatusInfo) => void
}

const SingleEngineSelector = memo(({
  engineType,
  title,
  engines,
  currentActive = '',
  onActiveChange,
  isChanging = false,
  onSettingsClick,
}: SingleEngineSelectorProps) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const open = Boolean(anchorEl)

  // Start/Stop mutations
  const startMutation = useStartEngine()
  const stopMutation = useStopEngine()

  // Find the active engine (if any)
  const activeEngine = currentActive ? engines.find(e => e.name === currentActive) : null
  const isDeactivated = !activeEngine

  // Can start/stop logic
  const canStart = activeEngine && !activeEngine.isRunning
  const canStop = activeEngine?.isRunning

  const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }, [])

  const handleClose = useCallback(() => {
    setAnchorEl(null)
  }, [])

  const handleSelectEngine = useCallback((engineName: string) => {
    if (engineName !== currentActive) {
      onActiveChange(engineName)
    }
    handleClose()
  }, [currentActive, onActiveChange, handleClose])

  const handleDeactivate = useCallback(() => {
    onActiveChange('')
    handleClose()
  }, [onActiveChange, handleClose])

  const handleSettingsClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (onSettingsClick && activeEngine) {
      onSettingsClick(activeEngine)
    }
  }, [onSettingsClick, activeEngine])

  const handleStartClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (activeEngine) {
      startMutation.mutate({
        engineType: activeEngine.engineType,
        engineName: activeEngine.name,
      })
    }
  }, [activeEngine, startMutation])

  const handleStopClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (activeEngine) {
      stopMutation.mutate({
        engineType: activeEngine.engineType,
        engineName: activeEngine.name,
      })
    }
  }, [activeEngine, stopMutation])

  return (
    <>
      <Card
        ref={cardRef}
        variant="outlined"
        onClick={handleClick}
        sx={{
          height: '100%',
          transition: 'all 0.2s ease',
          cursor: 'pointer',
          opacity: isDeactivated ? 0.7 : 1,
          '&:hover': {
            borderColor: theme.palette.primary.main,
            boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
          },
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
              {onSettingsClick && activeEngine && (
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
              <ExpandMoreIcon
                sx={{
                  fontSize: 18,
                  color: 'text.secondary',
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </Stack>
          </Stack>

          {/* Engine Name or Deactivated */}
          {isDeactivated ? (
            <>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <PowerOffIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                <Typography variant="h6" component="div" color="text.disabled">
                  {t('engines.deactivated')}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('engines.deactivatedHint')}
              </Typography>
            </>
          ) : (
            <>
              {/* Engine Name + Status Badge */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="h6" component="div">
                  {activeEngine.displayName}
                </Typography>
                <EngineStatusBadge
                  status={activeEngine.status}
                  port={activeEngine.port}
                  errorMessage={activeEngine.errorMessage}
                />
              </Box>

              {/* Version + Auto-Stop Countdown */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                {activeEngine.version && (
                  <Typography variant="caption" color="text.secondary">
                    {t('engines.version')}: {activeEngine.version}
                  </Typography>
                )}
                {activeEngine.secondsUntilAutoStop != null && activeEngine.secondsUntilAutoStop > 0 && (
                  <Typography variant="caption" color="warning.main">
                    {t('engines.autoStopIn', {
                      time: `${Math.floor(activeEngine.secondsUntilAutoStop / 60)}:${(activeEngine.secondsUntilAutoStop % 60).toString().padStart(2, '0')}`,
                    })}
                  </Typography>
                )}
              </Box>

              {/* Device & Port Info (when running) */}
              {activeEngine.isRunning && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                  <DeviceIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {activeEngine.device?.toUpperCase()}
                    {activeEngine.port && ` • Port ${activeEngine.port}`}
                  </Typography>
                </Box>
              )}

            </>
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
            width: cardRef.current?.offsetWidth || 300,
            minWidth: 280,
          }
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
          {t('engines.selectActiveEngine')}
        </Typography>
        <Divider />

        {/* Deactivate Option */}
        <MenuItem
          onClick={handleDeactivate}
          disabled={isChanging}
          selected={isDeactivated}
          sx={{ py: 1.5 }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
            <PowerOffIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
            <ListItemText
              primary={t('engines.deactivated')}
              secondary={t('engines.deactivatedDesc')}
              primaryTypographyProps={{ fontWeight: isDeactivated ? 600 : 400 }}
            />
            {isDeactivated && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
          </Stack>
        </MenuItem>

        <Divider />

        {/* Available Engines */}
        {engines.map((engine) => {
          const isSelected = engine.name === currentActive

          return (
            <MenuItem
              key={engine.name}
              onClick={() => handleSelectEngine(engine.name)}
              disabled={isChanging}
              selected={isSelected}
              sx={{ py: 1.5 }}
            >
              <ListItemText
                primaryTypographyProps={{ component: 'div' }}
                secondaryTypographyProps={{ component: 'div' }}
                primary={
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: isSelected ? 600 : 500 }}
                    >
                      {engine.displayName}
                    </Typography>
                    {isSelected && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
                  </Stack>
                }
                secondary={
                  engine.version ? (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('engines.version')}: {engine.version}
                      </Typography>
                    </Box>
                  ) : undefined
                }
              />
            </MenuItem>
          )
        })}

        {isChanging && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </Menu>
    </>
  )
})

SingleEngineSelector.displayName = 'SingleEngineSelector'

export default SingleEngineSelector