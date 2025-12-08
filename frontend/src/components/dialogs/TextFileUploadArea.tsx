/**
 * TextFileUploadArea - Drag & Drop Upload Zone for Text Files
 *
 * Features:
 * - Drag & Drop support with visual feedback
 * - File picker fallback (click to upload)
 * - File validation (format, size)
 * - File info display (name, size)
 * - Error handling with inline messages
 * - Clear/remove file button
 * - Direct text paste support
 */

import React, { useState, useCallback, useRef, memo } from 'react'
import {
  Box,
  Typography,
  Button,
  Stack,
  IconButton,
  Paper,
} from '@mui/material'
import {
  UploadFile as UploadIcon,
  Description as FileIcon,
  Close as CloseIcon,
  ErrorOutline as ErrorIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useTauriFileDrop } from '@/hooks/useTauriFileDrop'

interface TextFileUploadAreaProps {
  onFileSelect: (file: File | null) => void
  selectedFile: File | null
  error?: string | null
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_EXTENSIONS = ['.txt']

/**
 * Format file size to human-readable string (KB/MB)
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
}

const TextFileUploadArea = memo(({ onFileSelect, selectedFile, error }: TextFileUploadAreaProps) => {
  const { t } = useTranslation()
  const [validationError, setValidationError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Combine external and internal errors
  const displayError = error || validationError

  /**
   * Validate a text file
   */
  const validateFile = useCallback(
    (file: File): { valid: boolean; error?: string } => {
      // Check file extension
      const extension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        return {
          valid: false,
          error: t('textUpload.errors.invalidType'),
        }
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return {
          valid: false,
          error: t('textUpload.errors.tooLarge'),
        }
      }

      return { valid: true }
    },
    [t]
  )

  /**
   * Handle file selection (from drag or click)
   */
  const handleFile = useCallback(
    (file: File | null) => {
      if (!file) {
        setValidationError(null)
        onFileSelect(null)
        return
      }

      const validation = validateFile(file)
      if (validation.valid) {
        setValidationError(null)
        onFileSelect(file)
      } else {
        setValidationError(validation.error || null)
        onFileSelect(null)
      }
    },
    [validateFile, onFileSelect]
  )

  /**
   * Handle file input change (click to browse)
   */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFile(files[0])
      }
      // Reset input to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [handleFile]
  )

  /**
   * Handle files from Tauri drop
   */
  const handleFileDrop = useCallback(
    (files: File[]) => {
      if (files.length > 0) {
        handleFile(files[0])
      }
    },
    [handleFile]
  )

  /**
   * Tauri 2.0 File Drop via shared hook
   */
  const { isDragging } = useTauriFileDrop({
    onDrop: handleFileDrop,
    componentName: 'TextFileUploadArea',
    singleFile: true,
  })

  /**
   * Click to browse files
   */
  const handleClick = useCallback(() => {
    if (!selectedFile && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [selectedFile])

  /**
   * Clear selected file
   */
  const handleClear = useCallback(() => {
    handleFile(null)
  }, [handleFile])

  return (
    <Box data-testid="text-file-upload-area">
      {/* Upload Zone or File Info - Keep consistent height */}
      <Box
        sx={{
          height: 120, // Fixed height for consistent sizing
        }}
      >
        {!selectedFile ? (
          <Box
            onClick={handleClick}
            data-testid="upload-zone"
            sx={{
              border: 2,
              borderStyle: 'dashed',
              borderColor: displayError
                ? 'error.main'
                : isDragging
                ? 'primary.main'
                : 'divider',
              borderRadius: (theme) => theme.custom.borderRadius.md,
              bgcolor: isDragging ? 'action.selected' : 'background.paper',
              py: 2,
              px: 2,
              height: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              cursor: 'pointer',
              transition: (theme) => `all ${theme.custom.transitions.duration} ${theme.custom.transitions.easing}`,
              '&:hover': {
                borderColor: displayError ? 'error.main' : 'primary.main',
                bgcolor: 'action.hover',
              },
            }}
          >
            <Stack direction="row" spacing={2} alignItems="center" sx={{ pointerEvents: 'none' }}>
              {/* Upload Icon */}
              <UploadIcon
                sx={{
                  fontSize: 36,
                  color: displayError ? 'error.main' : isDragging ? 'primary.main' : 'text.secondary',
                  transition: (theme) => `color ${theme.custom.transitions.duration}`,
                  flexShrink: 0,
                }}
              />

              {/* Main Text */}
              <Box>
                <Typography variant="body2" fontWeight="medium" gutterBottom>
                  {isDragging ? t('textUpload.fileUpload.dropHere') : t('textUpload.fileUpload.dragDrop')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('textUpload.fileUpload.supportedFormats')}: {ACCEPTED_EXTENSIONS.join(', ')}
                </Typography>
                {/* Browse Button */}
                {!isDragging && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UploadIcon />}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleClick()
                    }}
                    sx={{ pointerEvents: 'auto', mt: 1 }}
                  >
                    {t('textUpload.fileUpload.browse')}
                  </Button>
                )}
              </Box>
            </Stack>
          </Box>
        ) : (
          /* Selected File Info - Same height as upload zone */
          <Paper
            data-testid="selected-file-info"
            sx={{
              p: 2,
              height: 120,
              display: 'flex',
              alignItems: 'center',
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              borderRadius: (theme) => theme.custom.borderRadius.md,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={2} width="100%">
              {/* File Icon */}
              <FileIcon
                sx={{
                  fontSize: 36,
                  color: 'primary.main',
                  flexShrink: 0,
                }}
              />

              {/* File Info */}
              <Box flex={1} minWidth={0}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('textUpload.fileUpload.selected')}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight="medium"
                  sx={{
                    wordBreak: 'break-all',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {selectedFile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(selectedFile.size)}
                </Typography>
              </Box>

              {/* Remove Button */}
              <IconButton
                onClick={handleClear}
                size="small"
                data-testid="remove-file-button"
                sx={{
                  color: 'text.secondary',
                  flexShrink: 0,
                  '&:hover': {
                    color: 'error.main',
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <CloseIcon />
              </IconButton>
            </Stack>
          </Paper>
        )}
      </Box>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        data-testid="file-input"
      />

      {/* Error Message */}
      {displayError && (
        <Box
          data-testid="upload-error"
          sx={{
            mt: 2,
            p: 1.5,
            bgcolor: 'action.hover',
            border: 1,
            borderColor: 'error.main',
            borderRadius: (theme) => theme.custom.borderRadius.sm,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
          <Typography variant="body2" color="error.main">
            {displayError}
          </Typography>
        </Box>
      )}
    </Box>
  )
})

TextFileUploadArea.displayName = 'TextFileUploadArea'

export default TextFileUploadArea
