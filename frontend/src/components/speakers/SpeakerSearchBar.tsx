/**
 * SpeakerSearchBar - Search and Filter Component
 *
 * Features:
 * - Debounced search (300ms)
 * - Clear button
 * - Search icon
 * - Responsive width
 */

import React, { useState, useEffect, useCallback } from 'react'
import { TextField, InputAdornment, IconButton } from '@mui/material'
import { Search as SearchIcon, Close as CloseIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface SpeakerSearchBarProps {
  onSearch: (query: string) => void
  placeholder?: string
}

export default function SpeakerSearchBar({ onSearch, placeholder }: SpeakerSearchBarProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')

  // Debounced search (300ms delay)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onSearch(inputValue.toLowerCase().trim())
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [inputValue, onSearch])

  const handleClear = useCallback(() => {
    setInputValue('')
  }, [])

  return (
    <TextField
      fullWidth
      size="small"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      placeholder={placeholder || t('speakers.search.placeholder')}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" color="action" />
          </InputAdornment>
        ),
        endAdornment: inputValue && (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={handleClear}
              edge="end"
              sx={{ mr: -0.5 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ),
      }}
      sx={{
        maxWidth: 400,
        bgcolor: 'background.paper',
      }}
    />
  )
}
