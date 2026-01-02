/**
 * AddImagePopover - Lightweight popover for installing Docker images
 *
 * Replaces the dialog with a contextual popover that appears next to the host.
 * Shows all available engines in a flat list grouped by type.
 */

import React, { useMemo, memo, useEffect, useRef, useState, useCallback } from 'react'
import {
  Popover,
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Stack,
  Chip,
  Paper,
} from '@mui/material'
import { Download as DownloadIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { engineApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import { useSnackbar } from '@hooks/useSnackbar'
import { translateBackendError } from '@utils/translateBackendError'
import { logger } from '@utils/logger'
import type { DockerImageInfo, EngineType } from '@/types/engines'

// ============================================================================
// Types
// ============================================================================

interface AddImagePopoverProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  hostId: string
}

const ENGINE_TYPE_ORDER: EngineType[] = ['tts', 'stt', 'text', 'audio']

const ENGINE_TYPE_LABELS: Record<EngineType, string> = {
  tts: 'TTS',
  stt: 'STT',
  text: 'Text',
  audio: 'Audio',
}

// ============================================================================
// Engine Row Component (compact)
// ============================================================================

interface EngineRowProps {
  image: DockerImageInfo
  isPulling: boolean
  onInstall: (engineName: string) => void
}

const EngineRow = memo(({ image, isPulling, onInstall }: EngineRowProps) => {
  return (
    <Paper
      variant="outlined"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.75,
        px: 1.5,
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        transition: 'border-color 0.2s, background-color 0.2s',
      }}
    >
      {/* Name */}
      <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1, minWidth: 0 }}>
        {image.displayName}
      </Typography>

      {/* GPU Badge */}
      {image.requiresGpu && (
        <Chip
          label="GPU"
          size="small"
          color="warning"
          sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600 }}
        />
      )}

      {/* Install Button */}
      <Button
        variant="contained"
        size="small"
        onClick={() => onInstall(image.engineName)}
        disabled={isPulling}
        sx={{ minWidth: 32, minHeight: 26, px: 1, py: 0.25 }}
      >
        {isPulling ? (
          <CircularProgress size={14} color="inherit" />
        ) : (
          <DownloadIcon sx={{ fontSize: 16 }} />
        )}
      </Button>
    </Paper>
  )
})

EngineRow.displayName = 'EngineRow'

// ============================================================================
// Main Popover Component
// ============================================================================

const AddImagePopover = memo(({ anchorEl, onClose, hostId }: AddImagePopoverProps) => {
  const { t } = useTranslation()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const queryClient = useQueryClient()
  const hasSyncedRef = useRef(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const open = Boolean(anchorEl)

  // Fetch catalog
  const { data: catalogData, isLoading: catalogLoading, error, refetch } = useQuery({
    queryKey: queryKeys.engines.catalog(),
    queryFn: engineApi.getCatalog,
    enabled: open,
    staleTime: 60000,
  })

  // Sync catalog when popover opens (once per open)
  useEffect(() => {
    if (!open) {
      hasSyncedRef.current = false
      return
    }

    if (hasSyncedRef.current) return
    hasSyncedRef.current = true

    const syncCatalog = async () => {
      setIsSyncing(true)
      try {
        await engineApi.syncCatalog()
        await refetch()
      } catch (err) {
        logger.warn('[AddImagePopover] Catalog sync failed:', err)
      } finally {
        setIsSyncing(false)
      }
    }

    syncCatalog()
  }, [open, refetch])

  const isLoading = isSyncing || catalogLoading

  // Fetch installed engines
  const { data: enginesData } = useQuery({
    queryKey: queryKeys.engines.all(),
    queryFn: engineApi.getAllStatus,
    enabled: open,
    staleTime: 10000,
  })

  // Build sets for installed and pulling variants
  const { installedEngines, pullingVariants } = useMemo(() => {
    const installed = new Set<string>()
    const pulling = new Set<string>()
    if (!enginesData) return { installedEngines: installed, pullingVariants: pulling }

    const allEngines = [
      ...(enginesData.tts || []),
      ...(enginesData.stt || []),
      ...(enginesData.text || []),
      ...(enginesData.audio || []),
    ]

    const hostSuffix = hostId.replace('docker:', '')

    for (const engine of allEngines) {
      if (engine.variantId?.includes(hostSuffix)) {
        if (engine.isInstalled) {
          // Extract engine name from variantId (e.g., "xtts:docker:local" -> "xtts")
          const engineName = engine.variantId.split(':')[0]
          installed.add(engineName)
        }
        if (engine.isPulling) {
          pulling.add(engine.variantId)
        }
      }
    }

    return { installedEngines: installed, pullingVariants: pulling }
  }, [enginesData, hostId])

  // Group available images by type (excluding installed)
  const enginesByType = useMemo(() => {
    const result: Record<EngineType, DockerImageInfo[]> = {
      tts: [],
      stt: [],
      text: [],
      audio: [],
    }

    if (!catalogData?.images) return result

    for (const image of catalogData.images) {
      // Skip debug engines in production
      if (!import.meta.env.DEV && image.engineName.startsWith('debug-')) continue
      // Skip already installed
      if (installedEngines.has(image.engineName)) continue

      const typeList = result[image.engineType]
      if (typeList) {
        typeList.push(image)
      }
    }

    return result
  }, [catalogData, installedEngines])

  // Check if any engines available
  const totalAvailable = useMemo(() => {
    return Object.values(enginesByType).reduce((sum, list) => sum + list.length, 0)
  }, [enginesByType])

  // Install handler
  const installMutation = useMutation({
    mutationFn: ({ variantId, tag }: { variantId: string; tag: string }) =>
      engineApi.installDockerImage(variantId, { tag }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engines.all() })
      showSnackbar(t('settings.addImage.installStarted', 'Installation started'), { severity: 'success' })
    },
    onError: (err: Error) => {
      showSnackbar(translateBackendError(err.message, t), { severity: 'error' })
    },
  })

  const handleInstall = useCallback((engineName: string) => {
    const hostSuffix = hostId.replace('docker:', '')
    const variantId = `${engineName}:docker:${hostSuffix}`
    const image = catalogData?.images.find(img => img.engineName === engineName)
    const tag = image?.defaultTag || 'latest'

    logger.info('[AddImagePopover] Installing:', variantId, 'tag:', tag)
    installMutation.mutate({ variantId, tag })
    onClose()
  }, [hostId, catalogData, installMutation, onClose])

  return (
    <>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              width: 360,
              maxHeight: 400,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              ml: '-60px',
            },
          },
        }}
      >
        {/* Header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            {t('settings.addImage.titleSimple', 'Add Engine')}
          </Typography>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
          {isLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={28} />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ my: 1 }}>
              {t('settings.addImage.loadError', 'Failed to load catalog')}
            </Alert>
          ) : totalAvailable === 0 ? (
            <Box py={3} textAlign="center">
              <Typography variant="body2" color="text.secondary">
                {t('settings.addImage.allInstalled', 'All engines are already installed')}
              </Typography>
            </Box>
          ) : (
            <Stack spacing={2}>
              {ENGINE_TYPE_ORDER.map((type) => {
                const engines = enginesByType[type]
                if (engines.length === 0) return null

                const hostSuffix = hostId.replace('docker:', '')

                return (
                  <Box key={type}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      fontWeight={600}
                      sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75, display: 'block' }}
                    >
                      {ENGINE_TYPE_LABELS[type]}
                    </Typography>
                    <Stack spacing={1}>
                      {engines.map((image) => {
                        const variantId = `${image.engineName}:docker:${hostSuffix}`
                        const isPulling = pullingVariants.has(variantId)

                        return (
                          <EngineRow
                            key={image.engineName}
                            image={image}
                            isPulling={isPulling}
                            onInstall={handleInstall}
                          />
                        )
                      })}
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          )}
        </Box>
      </Popover>

      <SnackbarComponent />
    </>
  )
})

AddImagePopover.displayName = 'AddImagePopover'

export default AddImagePopover
