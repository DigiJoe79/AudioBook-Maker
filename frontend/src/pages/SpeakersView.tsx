/**
 * SpeakersView - Speaker Management
 *
 * Full-screen speaker management with grid layout.
 * Uses View Pattern System for consistent UI.
 *
 * Features:
 * - Grid layout for speaker cards
 * - Search/filter functionality
 * - Speaker CRUD operations
 * - Audio sample management
 * - Preview player
 */

import React, { useState, useMemo, useCallback } from 'react'
import {
  Button,
  CircularProgress,
  Alert,
  Menu,
  MenuItem as MenuItemMui,
  IconButton,
  Box,
  Typography,
} from '@mui/material'
import {
  RecordVoiceOver as SpeakersIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@services/queryKeys'
import {
  fetchSpeakers,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
  uploadSpeakerSample,
  deleteSpeakerSample,
  setDefaultSpeaker,
} from '@services/settingsApi'
import { useConfirm } from '@hooks/useConfirm'
import { useSnackbar } from '@hooks/useSnackbar'
import { logger } from '@utils/logger'
import { translateBackendError } from '@utils/translateBackendError'
import type { Speaker } from '@types'
import {
  ViewContainer,
  ViewHeader,
  ViewToolbar,
  ViewContent,
  ViewFooter,
} from '@components/layout/ViewComponents'
import { EmptySpeakersState } from '@components/speakers/EmptySpeakersState'
import SpeakerGrid from '@components/speakers/SpeakerGrid'
import SpeakerSearchBar from '@components/speakers/SpeakerSearchBar'
import SpeakerPreviewPlayer from '@components/speakers/SpeakerPreviewPlayer'
import SpeakerEditModal, { type SpeakerFormData } from '@components/speakers/SpeakerEditModal'

const SpeakersView: React.FC = () => {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const { showSnackbar, SnackbarComponent } = useSnackbar()
  const queryClient = useQueryClient()

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(null)
  const [contextMenuAnchor, setContextMenuAnchor] = useState<{
    element: HTMLElement
    speaker: Speaker
  } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewSpeaker, setPreviewSpeaker] = useState<Speaker | null>(null)

  // Query speakers
  const {
    data: speakers,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.speakers.lists(),
    queryFn: fetchSpeakers,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: createSpeaker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
      setEditModalOpen(false)
      setEditingSpeaker(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Speaker> }) =>
      updateSpeaker(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
      setEditModalOpen(false)
      setEditingSpeaker(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSpeaker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
    },
  })

  const uploadSampleMutation = useMutation({
    mutationFn: ({
      speakerId,
      file,
      transcript,
    }: {
      speakerId: string
      file: File
      transcript?: string
    }) => uploadSpeakerSample(speakerId, file, transcript),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
    },
  })

  const deleteSampleMutation = useMutation({
    mutationFn: ({ speakerId, sampleId }: { speakerId: string; sampleId: string }) =>
      deleteSpeakerSample(speakerId, sampleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (speakerId: string) => setDefaultSpeaker(speakerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
    },
  })

  // Handlers
  const handleCreate = useCallback(() => {
    setEditingSpeaker(null)
    setEditModalOpen(true)
  }, [])

  const handleEdit = useCallback((speaker: Speaker) => {
    setEditingSpeaker(speaker)
    setEditModalOpen(true)
  }, [])

  const handleModalClose = useCallback(() => {
    setEditModalOpen(false)
    setEditingSpeaker(null)
  }, [])

  const handleSave = useCallback(
    async (formData: SpeakerFormData, samplesToUpload: File[]) => {
      try {
        let speakerId: string
        const isUpdate = !!editingSpeaker

        if (editingSpeaker) {
          // Update existing speaker
          await updateMutation.mutateAsync({
            id: editingSpeaker.id,
            data: {
              name: formData.name,
              description: formData.description || undefined,
              gender: formData.gender || undefined,
              tags: formData.tags,
            },
          })
          speakerId = editingSpeaker.id
        } else {
          // Create new speaker
          const speakerData: Omit<
            Speaker,
            'id' | 'isActive' | 'isDefault' | 'createdAt' | 'updatedAt' | 'samples' | 'sampleCount'
          > = {
            name: formData.name,
            description: formData.description || undefined,
            gender: formData.gender || undefined,
            languages: [],
            tags: formData.tags,
          }
          const newSpeaker = await createMutation.mutateAsync(speakerData)
          speakerId = newSpeaker.id
        }

        // Upload new samples
        for (const file of samplesToUpload) {
          await uploadSampleMutation.mutateAsync({
            speakerId,
            file,
          })
        }

        queryClient.invalidateQueries({ queryKey: queryKeys.speakers.all })

        // Show success message
        if (samplesToUpload.length > 0 && !isUpdate) {
          showSnackbar(
            t('speakers.messages.createdWithSamples', { count: samplesToUpload.length }),
            { severity: 'success' }
          )
        } else {
          showSnackbar(
            isUpdate ? t('speakers.messages.updated') : t('speakers.messages.created'),
            { severity: 'success' }
          )
        }
      } catch (error: unknown) {
        logger.error('[SpeakersView] Speaker save error', { error })
        const errorMessage = translateBackendError(
          error instanceof Error ? error.message : (editingSpeaker ? t('speakers.messages.updateFailed') : t('speakers.messages.createFailed')),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
        throw error
      }
    },
    [editingSpeaker, createMutation, updateMutation, uploadSampleMutation, queryClient, showSnackbar, t]
  )

  const handleDeleteSample = useCallback(
    async (sampleId: string) => {
      if (!editingSpeaker) return

      const confirmed = await confirm(
        t('speakers.deleteSample'),
        t('speakers.messages.deleteSampleConfirm'),
        {
          icon: <WarningIcon color="error" />,
          confirmColor: 'error',
        }
      )

      if (confirmed) {
        try {
          await deleteSampleMutation.mutateAsync({
            speakerId: editingSpeaker.id,
            sampleId,
          })
          showSnackbar(t('speakers.messages.sampleDeleted'), { severity: 'success' })
        } catch (error: unknown) {
          logger.error('[SpeakersView] Delete sample error', { error })
          const errorMessage = translateBackendError(error instanceof Error ? error.message : t('speakers.messages.sampleDeleteFailed'), t)
          showSnackbar(errorMessage, { severity: 'error' })
        }
      }
    },
    [editingSpeaker, confirm, deleteSampleMutation, showSnackbar, t]
  )

  const handleDelete = useCallback(
    async (speaker: Speaker) => {
      setContextMenuAnchor(null)

      const confirmed = await confirm(
        t('speakers.delete'),
        t('speakers.messages.deleteConfirm', { name: speaker.name }),
        {
          icon: <WarningIcon color="error" />,
          confirmColor: 'error',
        }
      )

      if (confirmed) {
        try {
          await deleteMutation.mutateAsync(speaker.id)
          showSnackbar(t('speakers.messages.deleted'), { severity: 'success' })
        } catch (error: unknown) {
          logger.error('[SpeakersView] Delete speaker error', { error })
          const errorMessage = translateBackendError(error instanceof Error ? error.message : t('speakers.messages.deleteFailed'), t)
          showSnackbar(errorMessage, { severity: 'error' })
        }
      }
    },
    [confirm, deleteMutation, showSnackbar, t]
  )

  const handleSetDefault = useCallback(
    async (speakerId: string) => {
      try {
        await setDefaultMutation.mutateAsync(speakerId)
        setContextMenuAnchor(null)
        showSnackbar(t('speakers.messages.defaultSet'), { severity: 'success' })
      } catch (error: unknown) {
        logger.error('[SpeakersView] Set default speaker error', { error })
        const errorMessage = translateBackendError(error instanceof Error ? error.message : t('speakers.messages.defaultSetFailed'), t)
        showSnackbar(errorMessage, { severity: 'error' })
      }
    },
    [setDefaultMutation, showSnackbar, t]
  )

  const handleMenuClick = useCallback((event: React.MouseEvent<HTMLElement>, speaker: Speaker) => {
    setContextMenuAnchor({ element: event.currentTarget, speaker })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuAnchor(null)
  }, [])

  const handlePreview = useCallback((speaker: Speaker) => {
    setPreviewSpeaker(speaker)
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewSpeaker(null)
  }, [])

  // Context menu handlers - stable references for Menu items
  const handleMenuSetDefault = useCallback(() => {
    if (contextMenuAnchor?.speaker) {
      handleSetDefault(contextMenuAnchor.speaker.id)
    }
  }, [contextMenuAnchor?.speaker, handleSetDefault])

  const handleMenuDelete = useCallback(() => {
    if (contextMenuAnchor?.speaker) {
      handleDelete(contextMenuAnchor.speaker)
    }
  }, [contextMenuAnchor?.speaker, handleDelete])

  // Filter speakers by search query
  const filteredSpeakers = useMemo(() => {
    if (!speakers || !searchQuery) return speakers || []

    const query = searchQuery.toLowerCase()
    return speakers.filter(
      (speaker) =>
        speaker.name.toLowerCase().includes(query) ||
        speaker.description?.toLowerCase().includes(query) ||
        speaker.gender?.toLowerCase().includes(query) ||
        speaker.tags.some((tag) => tag.toLowerCase().includes(query))
    )
  }, [speakers, searchQuery])

  const hasSpeakers = speakers && speakers.length > 0
  const hasFilteredResults = filteredSpeakers.length > 0

  // Loading state
  if (isLoading) {
    return (
      <ViewContainer>
        <ViewHeader title={t('speakers.title')} />
        <ViewContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        </ViewContent>
      </ViewContainer>
    )
  }

  // Error state
  if (error) {
    return (
      <ViewContainer>
        <ViewHeader title={t('speakers.title')} />
        <ViewContent>
          <Alert severity="error">{t('speakers.messages.error')}</Alert>
        </ViewContent>
      </ViewContainer>
    )
  }

  // Empty state (no speakers at all)
  if (!hasSpeakers) {
    return (
      <ViewContainer>
        <ViewHeader title={t('speakers.title')} />
        <ViewContent>
          <EmptySpeakersState onCreateFirst={handleCreate} />
        </ViewContent>

        {/* Edit Modal */}
        <SpeakerEditModal
          open={editModalOpen}
          speaker={editingSpeaker}
          onClose={handleModalClose}
          onSave={handleSave}
          onDeleteSample={handleDeleteSample}
          isSaving={
            createMutation.isPending || updateMutation.isPending || uploadSampleMutation.isPending
          }
        />

        <ConfirmDialog />
      </ViewContainer>
    )
  }

  // Main view with speakers
  return (
    <ViewContainer>
      {/* Header */}
      <ViewHeader
        title={t('speakers.title')}
        actions={
          <Button
            data-testid="speaker-add-button"
            startIcon={<AddIcon />}
            onClick={handleCreate}
            variant="contained"
            size="small"
            sx={{ minWidth: 120 }}
          >
            {t('speakers.add')}
          </Button>
        }
      />

      {/* Toolbar with Search */}
      <ViewToolbar variant="filters">
        <SpeakerSearchBar onSearch={setSearchQuery} />
      </ViewToolbar>

      {/* Content */}
      <ViewContent>
        {!hasFilteredResults ? (
          // No search results
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="300px"
            bgcolor="action.hover"
            borderRadius={2}
            p={4}
          >
            <Typography variant="body1" color="text.secondary">
              {searchQuery
                ? t('speakers.search.noResults', { query: searchQuery })
                : t('speakers.list')}
            </Typography>
          </Box>
        ) : (
          // Speaker Grid
          <SpeakerGrid
            speakers={filteredSpeakers}
            defaultSpeakerId={speakers?.find((s) => s.isDefault)?.id}
            onEdit={handleEdit}
            onPreview={handlePreview}
            onMenuClick={handleMenuClick}
          />
        )}
      </ViewContent>

      {/* Footer with Status */}
      <ViewFooter
        status={
          <Typography variant="body2" color="text.secondary">
            {hasFilteredResults
              ? t('speakers.count', { count: filteredSpeakers.length })
              : t('speakers.noSpeakers')}
          </Typography>
        }
      />

      {/* Preview Player Modal */}
      {previewSpeaker && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            width: 400,
            maxWidth: 'calc(100vw - 32px)',
            zIndex: 1300,
            boxShadow: 6,
          }}
        >
          <Box
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              p: 2,
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" noWrap>
                {previewSpeaker.name}
              </Typography>
              <IconButton size="small" onClick={handleClosePreview}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>

            <SpeakerPreviewPlayer speaker={previewSpeaker} autoPlay compact />
          </Box>
        </Box>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor?.element}
        open={Boolean(contextMenuAnchor)}
        onClose={handleCloseContextMenu}
        data-testid="speaker-context-menu"
      >
        <MenuItemMui
          data-testid="speaker-menu-set-default"
          onClick={handleMenuSetDefault}
          disabled={!contextMenuAnchor?.speaker?.isActive}
        >
          {t('speakers.setAsDefault')}
        </MenuItemMui>
        <MenuItemMui
          data-testid="speaker-menu-delete"
          onClick={handleMenuDelete}
          sx={{ color: 'error.main' }}
        >
          {t('speakers.delete')}
        </MenuItemMui>
      </Menu>

      {/* Edit Modal */}
      <SpeakerEditModal
        open={editModalOpen}
        speaker={editingSpeaker}
        onClose={handleModalClose}
        onSave={handleSave}
        onDeleteSample={handleDeleteSample}
        isSaving={
          createMutation.isPending || updateMutation.isPending || uploadSampleMutation.isPending
        }
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </ViewContainer>
  )
}

SpeakersView.displayName = 'SpeakersView'

export default SpeakersView
