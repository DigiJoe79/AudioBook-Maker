/**
 * ProfileManagerDialog - Backend Profile CRUD Management
 *
 * Allows users to create, edit, and delete backend connection profiles.
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Checkbox,
  FormControlLabel,
  Alert,
  Paper,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Close as CloseIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import {
  loadProfiles,
  saveProfile,
  updateProfile,
  deleteProfile,
  validateUrl,
} from '@services/backendProfiles'
import type { BackendProfile } from '@types'
import { useConfirm } from '@hooks/useConfirm'
import { useError } from '@hooks/useError'
import { useSnackbar } from '@hooks/useSnackbar'
import { useTranslation } from 'react-i18next'
import { logger } from '@utils/logger'

interface ProfileManagerDialogProps {
  open: boolean
  onClose: () => void
  onProfilesChanged: () => void
}

interface ProfileFormData {
  name: string
  url: string
  isDefault: boolean
}

export function ProfileManagerDialog({ open, onClose, onProfilesChanged }: ProfileManagerDialogProps) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [formData, setFormData] = useState<ProfileFormData>({
    name: '',
    url: '',
    isDefault: false,
  })
  const [formErrors, setFormErrors] = useState<{ name?: string; url?: string }>({})
  const [isFormVisible, setIsFormVisible] = useState(false)

  // Confirmation dialog hook
  const { confirm, ConfirmDialog } = useConfirm()
  const { showError, ErrorDialog } = useError()
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  // Load profiles on mount and when dialog opens
  useEffect(() => {
    if (open) {
      setProfiles(loadProfiles())
      setIsFormVisible(false)
      setEditingProfileId(null)
    }
  }, [open])

  // Handle add new profile
  const handleAdd = () => {
    setEditingProfileId(null)
    setFormData({ name: '', url: 'http://127.0.0.1:8765', isDefault: false })
    setFormErrors({})
    setIsFormVisible(true)
  }

  // Handle edit existing profile
  const handleEdit = (profile: BackendProfile) => {
    setEditingProfileId(profile.id)
    setFormData({
      name: profile.name,
      url: profile.url,
      isDefault: profile.isDefault,
    })
    setFormErrors({})
    setIsFormVisible(true)
  }

  // Handle delete profile
  const handleDelete = async (profile: BackendProfile) => {
    const confirmed = await confirm(
      t('profileManager.deleteTitle'),
      t('profileManager.deleteConfirm', { name: profile.name }),
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )
    if (confirmed) {
      logger.group('🔧 Profile Manager', 'Deleting profile', { profileId: profile.id, name: profile.name }, '#FF5722')
      try {
        deleteProfile(profile.id)
        setProfiles(loadProfiles())
        onProfilesChanged()
        showSnackbar(t('profileManager.deleted'), { severity: 'success' })
      } catch (err) {
        await showError(
          t('profileManager.deleteTitle'),
          err instanceof Error ? err.message : t('profileManager.deleteFailed')
        )
      }
    }
  }

  // Handle toggle default
  const handleToggleDefault = async (profile: BackendProfile) => {
    logger.group('🔧 Profile Manager', 'Toggling default profile', { profileId: profile.id, name: profile.name, newDefault: !profile.isDefault }, '#2196F3')
    try {
      updateProfile(profile.id, { isDefault: !profile.isDefault })
      setProfiles(loadProfiles())
      onProfilesChanged()
    } catch (err) {
      await showError(
        t('profileManager.updateFailed'),
        err instanceof Error ? err.message : t('profileManager.updateError')
      )
    }
  }

  // Validate form
  const validateForm = (): boolean => {
    const errors: { name?: string; url?: string } = {}

    // Validate name
    if (!formData.name.trim()) {
      errors.name = t('profileManager.nameRequired')
    } else {
      // Check for duplicate name (excluding current profile if editing)
      const isDuplicate = profiles.some(
        (p) => p.id !== editingProfileId && p.name.toLowerCase() === formData.name.toLowerCase()
      )
      if (isDuplicate) {
        errors.name = t('profileManager.nameDuplicate')
      }
    }

    // Validate URL
    const urlValidation = validateUrl(formData.url)
    if (!urlValidation.valid) {
      errors.url = urlValidation.error
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Handle save
  const handleSave = async () => {
    if (!validateForm()) return

    if (editingProfileId) {
      logger.group('🔧 Profile Manager', 'Updating profile', { profileId: editingProfileId, name: formData.name, url: formData.url }, '#4CAF50')
    } else {
      logger.group('🔧 Profile Manager', 'Creating profile', { name: formData.name, url: formData.url, isDefault: formData.isDefault }, '#4CAF50')
    }

    try {
      if (editingProfileId) {
        // Update existing
        updateProfile(editingProfileId, formData)
        showSnackbar(t('profileManager.updated'), { severity: 'success' })
      } else {
        // Create new - add lastConnected: null
        saveProfile({ ...formData, lastConnected: null })
        showSnackbar(t('profileManager.created'), { severity: 'success' })
      }

      setProfiles(loadProfiles())
      setIsFormVisible(false)
      setEditingProfileId(null)
      onProfilesChanged()
    } catch (err) {
      await showError(
        editingProfileId ? t('profileManager.updateFailed') : t('profileManager.createFailed'),
        err instanceof Error ? err.message : t('profileManager.saveFailed')
      )
    }
  }

  // Handle cancel
  const handleCancel = () => {
    setIsFormVisible(false)
    setEditingProfileId(null)
    setFormErrors({})
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{t('profileManager.title')}</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Profiles Table */}
        {!isFormVisible && (
          <Box>
            {profiles.length === 0 ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('profileManager.noProfiles')}
              </Alert>
            ) : (
              <Paper variant="outlined" sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('profileManager.default')}</TableCell>
                      <TableCell>{t('profileManager.name')}</TableCell>
                      <TableCell>{t('profileManager.url')}</TableCell>
                      <TableCell align="right">{t('profileManager.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {profiles.map((profile) => (
                      <TableRow key={profile.id} hover>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => handleToggleDefault(profile)}
                            color={profile.isDefault ? 'primary' : 'default'}
                          >
                            {profile.isDefault ? <StarIcon /> : <StarBorderIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{profile.name}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {profile.url}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => handleEdit(profile)} color="primary">
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(profile)}
                            color="error"
                            disabled={profiles.length === 1}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}

            <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAdd} fullWidth>
              {t('profileManager.addNew')}
            </Button>
          </Box>
        )}

        {/* Profile Form */}
        {isFormVisible && (
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
              {editingProfileId ? t('profileManager.editProfile') : t('profileManager.newProfile')}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t('profileManager.profileName')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                error={!!formErrors.name}
                helperText={formErrors.name || t('profileManager.profileNameHint')}
                fullWidth
                autoFocus
              />

              <TextField
                label={t('profileManager.backendUrl')}
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                error={!!formErrors.url}
                helperText={formErrors.url || t('profileManager.backendUrlHint')}
                fullWidth
                placeholder="http://127.0.0.1:8765"
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  />
                }
                label={t('profileManager.setDefault')}
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button variant="outlined" onClick={handleCancel} fullWidth>
                {t('common.cancel')}
              </Button>
              <Button variant="contained" onClick={handleSave} fullWidth>
                {editingProfileId ? t('profileManager.saveChanges') : t('profileManager.createProfile')}
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>

      {/* Confirmation Dialog */}
      <ConfirmDialog />

      {/* Error Dialog */}
      <ErrorDialog />

      {/* Snackbar Notifications */}
      <SnackbarComponent />
    </Dialog>
  )
}
