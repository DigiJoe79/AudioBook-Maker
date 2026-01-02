/**
 * SampleUploadZone - Drag & Drop Upload Zone for Audio Samples
 *
 * Features:
 * - Drag & Drop support with visual feedback
 * - File picker fallback (click to upload)
 * - File validation (format, size)
 * - Upload progress tracking per file
 * - Error handling with inline messages
 */

import React, { useState, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  Alert,
  Stack,
  Chip,
} from '@mui/material'
import {
  CloudUpload as UploadIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useTauriFileDrop } from '@/hooks/useTauriFileDrop'

interface FileToUpload {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

interface SampleUploadZoneProps {
  onFilesAdded: (files: File[]) => void
  disabled?: boolean
  maxFiles?: number
  maxSizeBytes?: number
  acceptedFormats?: string[]
}

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024 // 50MB
const DEFAULT_ACCEPTED_FORMATS = ['.wav', '.mp3', '.m4a', '.flac']

export default function SampleUploadZone({
  onFilesAdded,
  disabled = false,
  maxFiles = 10,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  acceptedFormats = DEFAULT_ACCEPTED_FORMATS,
}: SampleUploadZoneProps) {
  const { t } = useTranslation()
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Validate file before upload
  const validateFile = useCallback(
    (file: File): { valid: boolean; error?: string } => {
      // Check file size
      if (file.size > maxSizeBytes) {
        return {
          valid: false,
          error: t('speakers.uploadZone.fileTooLarge', {
            name: file.name,
            maxMB: (maxSizeBytes / 1024 / 1024).toFixed(0)
          }),
        }
      }

      // Check file extension
      const extension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (!acceptedFormats.includes(extension)) {
        return {
          valid: false,
          error: t('speakers.uploadZone.unsupportedFormat', {
            name: file.name,
            formats: acceptedFormats.join(', ')
          }),
        }
      }

      return { valid: true }
    },
    [maxSizeBytes, acceptedFormats, t]
  )

  // Handle file selection (drag or click)
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return

      const errors: string[] = []
      const validFiles: File[] = []

      // Validate each file
      Array.from(files).forEach((file) => {
        const validation = validateFile(file)
        if (validation.valid) {
          validFiles.push(file)
        } else if (validation.error) {
          errors.push(validation.error)
        }
      })

      // Check max files limit
      if (validFiles.length > maxFiles) {
        errors.push(t('speakers.uploadZone.tooManyFiles', { maxFiles }))
        validFiles.splice(maxFiles)
      }

      // Update errors
      setValidationErrors(errors)

      // Notify parent of valid files
      if (validFiles.length > 0) {
        onFilesAdded(validFiles)
      }

      // Clear errors after 5 seconds
      if (errors.length > 0) {
        setTimeout(() => setValidationErrors([]), 5000)
      }
    },
    [validateFile, maxFiles, onFilesAdded]
  )

  /**
   * Handle files from Tauri drop - convert to FileList-like for validation
   */
  const handleFileDrop = useCallback(
    (files: File[]) => {
      // Use existing validation logic via FileList-like object
      const fileList = {
        length: files.length,
        item: (index: number) => files[index],
        [Symbol.iterator]: function* () {
          for (let i = 0; i < files.length; i++) {
            yield files[i]
          }
        },
      } as FileList

      handleFiles(fileList)
    },
    [handleFiles]
  )

  /**
   * Tauri 2.0 File Drop via shared hook
   */
  const { isDragging } = useTauriFileDrop({
    onDrop: handleFileDrop,
    componentName: 'SampleUploadZone',
    disabled,
  })

  // Click to upload
  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files)
      // Reset input to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [handleFiles]
  )

  return (
    <Box>
      {/* Upload Zone */}
      <Box
        onClick={handleClick}
        sx={{
          border: 2,
          borderStyle: 'dashed',
          borderColor: isDragging
            ? 'primary.main'
            : disabled
            ? 'action.disabled'
            : 'divider',
          borderRadius: 2,
          bgcolor: isDragging
            ? (theme) => theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.15)' : 'rgba(25, 118, 210, 0.08)'
            : disabled
            ? 'action.disabledBackground'
            : 'background.paper',
          py: 4,
          px: 3,
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          '&:hover': disabled
            ? {}
            : {
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
              },
        }}
      >
        <Stack spacing={2} alignItems="center" sx={{ pointerEvents: 'none' }}>
          {/* Upload Icon */}
          <UploadIcon
            sx={{
              fontSize: 48,
              color: isDragging ? 'primary.main' : 'text.secondary',
              transition: 'color 0.2s ease',
            }}
          />

          {/* Main Text */}
          <Box>
            <Typography variant="body1" fontWeight="medium" gutterBottom>
              {isDragging
                ? t('speakers.upload.dropHere')
                : t('speakers.upload.dragOrClick')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('speakers.upload.supportedFormats')}: {acceptedFormats.join(', ')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              {t('speakers.uploadZone.limits', {
                maxMB: (maxSizeBytes / 1024 / 1024).toFixed(0),
                maxFiles
              })}
            </Typography>
          </Box>

          {/* Upload Button */}
          {!isDragging && (
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation()
                handleClick()
              }}
              sx={{ pointerEvents: 'auto' }}
            >
              {t('speakers.upload.selectFiles')}
            </Button>
          )}
        </Stack>
      </Box>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        disabled={disabled}
        data-testid="speaker-sample-file-input"
      />

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Box mt={2}>
          {validationErrors.map((error, index) => (
            <Alert severity="error" key={`error-${index}-${error.slice(0, 20)}`} sx={{ mb: 1 }}>
              {error}
            </Alert>
          ))}
        </Box>
      )}
    </Box>
  )
}
