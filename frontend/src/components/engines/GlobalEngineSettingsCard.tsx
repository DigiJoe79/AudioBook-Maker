/**
 * GlobalEngineSettingsCard - Global Engine Settings Card
 *
 * Displays global engine settings as a card. Clicking opens an overlay menu
 * with all configurable options. Uses the same dropdown pattern as EngineDropdownCard.
 *
 * Features:
 * - Inactivity timeout slider
 * - Autostart keepRunning engines toggle
 * - TTS language selection with checkboxes
 */

import React, { memo, useCallback, useState, useRef, useMemo, useEffect } from 'react'
import {
  Card,
  CardContent,
  Box,
  Typography,
  Menu,
  Button,
  Checkbox,
  FormControlLabel,
  Divider,
  Slider,
  Grid,
  alpha,
  useTheme,
} from '@mui/material'
import {
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { SettingsToggle } from '@components/settings/SettingsComponents'

// =============================================================================
// Memoized Language Checkbox - prevents re-render of all checkboxes on toggle
// =============================================================================

interface LanguageCheckboxProps {
  lang: string
  checked: boolean
  onToggle: (lang: string) => void
  label: string
}

const LanguageCheckbox = memo(({ lang, checked, onToggle, label }: LanguageCheckboxProps) => {
  const handleChange = useCallback(() => {
    onToggle(lang)
  }, [lang, onToggle])

  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={checked}
          onChange={handleChange}
          size="small"
        />
      }
      label={
        <Typography variant="body2">
          {label}
        </Typography>
      }
      sx={{
        m: 0,
        '& .MuiFormControlLabel-label': {
          fontSize: '0.875rem',
        },
      }}
    />
  )
})

LanguageCheckbox.displayName = 'LanguageCheckbox'

// =============================================================================
// Main Component
// =============================================================================

interface GlobalEngineSettingsCardProps {
  /** Inactivity timeout in minutes */
  timeoutMinutes: number
  /** Callback when timeout changes */
  onTimeoutChange: (minutes: number) => void
  /** Whether to autostart keepRunning engines */
  autostart: boolean
  /** Callback when autostart changes */
  onAutostartChange: (enabled: boolean) => void
  /** All available languages (from TTS engines) */
  availableLanguages: string[]
  /** Currently selected/allowed languages */
  selectedLanguages: string[]
  /** Callback when selection changes */
  onSelectionChange: (languages: string[]) => void
}

const GlobalEngineSettingsCard = memo(({
  timeoutMinutes,
  onTimeoutChange,
  autostart,
  onAutostartChange,
  availableLanguages,
  selectedLanguages,
  onSelectionChange,
}: GlobalEngineSettingsCardProps) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const open = Boolean(anchorEl)

  // Local state for immediate UI feedback (prevents flicker from store updates)
  const [localSelection, setLocalSelection] = useState<string[]>(selectedLanguages)
  const [localTimeout, setLocalTimeout] = useState(timeoutMinutes)

  // Use ref to store current selection for stable callback
  const localSelectionRef = useRef(localSelection)
  localSelectionRef.current = localSelection

  // Sync local state with props only when closed (external changes)
  useEffect(() => {
    if (!open) {
      setLocalSelection(selectedLanguages)
      setLocalTimeout(timeoutMinutes)
    }
  }, [selectedLanguages, timeoutMinutes, open])

  // Memoize sorted languages to prevent flickering on re-render
  const sortedLanguages = useMemo(
    () => [...availableLanguages].sort(),
    [availableLanguages]
  )

  const selectedCount = localSelection.length

  // Memoize preview languages (first 5 selected, sorted)
  const previewLanguages = useMemo(
    () => localSelection.slice().sort().slice(0, 5),
    [localSelection]
  )
  const remainingCount = selectedCount - 5

  // Memoize card width for Menu
  const menuWidth = useMemo(
    () => cardRef.current?.offsetWidth || 400,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open] // Only recalculate when menu opens
  )

  const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }, [])

  const handleClose = useCallback(() => {
    setAnchorEl(null)
  }, [])

  // Stable toggle handler using ref - doesn't change on every render
  const handleToggleLanguage = useCallback((lang: string) => {
    const current = localSelectionRef.current
    const newSelection = current.includes(lang)
      ? current.filter(l => l !== lang)
      : [...current, lang]
    setLocalSelection(newSelection)
    onSelectionChange(newSelection)
  }, [onSelectionChange])

  const handleSelectAll = useCallback(() => {
    setLocalSelection([...sortedLanguages])
    onSelectionChange([...sortedLanguages])
  }, [sortedLanguages, onSelectionChange])

  const handleDeselectAll = useCallback(() => {
    setLocalSelection([])
    onSelectionChange([])
  }, [onSelectionChange])

  // Timeout handlers
  const handleTimeoutSliderChange = useCallback((_: Event, value: number | number[]) => {
    const newValue = Array.isArray(value) ? value[0] : value
    setLocalTimeout(newValue)
  }, [])

  const handleTimeoutChangeCommitted = useCallback((_: Event | React.SyntheticEvent, value: number | number[]) => {
    const newValue = Array.isArray(value) ? value[0] : value
    onTimeoutChange(newValue)
  }, [onTimeoutChange])

  // Memoize the selection Set for O(1) lookup
  const selectionSet = useMemo(
    () => new Set(localSelection),
    [localSelection]
  )

  return (
    <>
      <Card
        ref={cardRef}
        variant="outlined"
        onClick={handleClick}
        sx={{
          transition: 'all 0.2s ease',
          cursor: 'pointer',
          '&:hover': {
            borderColor: theme.palette.primary.main,
            boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
          },
        }}
      >
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: Icon + Title */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <SettingsIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="body1" fontWeight={600}>
                {t('engines.globalSettings')}
              </Typography>
            </Box>

            {/* Right: Summary + Dropdown Icon */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {/* Timeout preview */}
              <Typography variant="body2" color="text.secondary">
                {localTimeout === 0 ? t('engines.stopAfterJob') : `${localTimeout} min`}
              </Typography>

              {/* Language preview chips */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {previewLanguages.map((lang) => (
                  <Box
                    key={lang}
                    sx={{
                      minWidth: '32px',
                      px: 0.75,
                      py: 0.125,
                      borderRadius: 0.75,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'transparent',
                      textAlign: 'center',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" fontWeight={500}>
                      {lang.toUpperCase()}
                    </Typography>
                  </Box>
                ))}
                {remainingCount > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 0.5 }}>
                    +{remainingCount}
                  </Typography>
                )}
              </Box>

              {/* Dropdown indicator */}
              <ExpandMoreIcon
                sx={{
                  fontSize: 20,
                  color: 'text.secondary',
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </Box>
          </Box>
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
            width: menuWidth,
            minWidth: 400,
            maxHeight: 550,
          }
        }}
      >
        {/* Engine Lifecycle Settings */}
        <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
          <Grid container spacing={3}>
            {/* Inactivity Timeout Slider */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                {t('engines.inactivityTimeout')}
              </Typography>
              <Box sx={{ px: 1 }}>
                <Typography variant="body2" color="text.primary" sx={{ mb: 0.5 }}>
                  {localTimeout === 0 ? t('engines.stopAfterJob') : `${localTimeout} min`}
                </Typography>
                <Slider
                  value={localTimeout}
                  onChange={handleTimeoutSliderChange}
                  onChangeCommitted={handleTimeoutChangeCommitted}
                  min={0}
                  max={30}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 15, label: '15' },
                    { value: 30, label: '30' }
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => value === 0 ? t('engines.stopAfterJob') : `${value} min`}
                  size="small"
                />
              </Box>
            </Grid>

            {/* Autostart Toggle */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                {t('engines.engineStartup')}
              </Typography>
              <SettingsToggle
                label={t('engines.autostartKeepRunning')}
                checked={autostart}
                onChange={onAutostartChange}
              />
            </Grid>
          </Grid>
        </Box>

        <Divider />

        {/* TTS Languages Section */}
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
            {t('settings.tts.activatedLanguages')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('settings.general.allowedLanguagesDesc')}
          </Typography>
        </Box>

        {/* Action buttons */}
        <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 1 }}>
          <Button size="small" onClick={handleSelectAll} variant="outlined">
            {t('settings.general.selectAll')}
          </Button>
          <Button size="small" onClick={handleDeselectAll} variant="outlined">
            {t('settings.general.deselectAll')}
          </Button>
        </Box>

        {/* Language checkboxes grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 0.5,
            px: 2,
            pb: 2,
            maxHeight: 250,
            overflowY: 'auto',
          }}
        >
          {sortedLanguages.map((lang) => (
            <LanguageCheckbox
              key={lang}
              lang={lang}
              checked={selectionSet.has(lang)}
              onToggle={handleToggleLanguage}
              label={t(`languages.${lang}`, lang.toUpperCase())}
            />
          ))}
        </Box>
      </Menu>
    </>
  )
})

GlobalEngineSettingsCard.displayName = 'GlobalEngineSettingsCard'

export default GlobalEngineSettingsCard
