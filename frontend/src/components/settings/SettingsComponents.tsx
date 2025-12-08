/**
 * Settings Components - Reusable components for SettingsView
 *
 * Provides consistent styling for settings sections and labels.
 * Reduces code duplication and ensures adherence to View Pattern System.
 */

import { Box, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Section Label - Styled caption for setting sections
 *
 * Consistent uppercase label with proper spacing and styling.
 * Internal helper - not exported
 */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: 'block',
        mb: (theme) => theme.custom.spacing.sm,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Typography>
  )
}

/**
 * Settings Section - Consistent box container for settings groups
 *
 * Provides standard padding, background, border, and border-radius.
 *
 * @example
 * ```tsx
 * <SettingsSection title="Display Settings">
 *   <TextField label="Theme" />
 * </SettingsSection>
 * ```
 */
interface SettingsSectionProps {
  children: ReactNode
  title?: string
  sx?: SxProps<Theme>
}

export function SettingsSection({ children, title, sx }: SettingsSectionProps) {
  return (
    <Box
      sx={{
        p: (theme) => theme.custom.spacing.lg,
        borderRadius: (theme) => theme.custom.borderRadius.xl,
        border: 1,
        borderColor: 'divider',
        ...sx,
      }}
    >
      {title && <SectionLabel>{title}</SectionLabel>}
      {children}
    </Box>
  )
}

/**
 * Settings Toggle - Toggle button group for on/off settings
 *
 * Modern toggle button design with "Aus" / "An" options.
 *
 * @example
 * ```tsx
 * <SettingsToggle
 *   label="Auto-analyze segments"
 *   checked={enabled}
 *   onChange={(checked) => setEnabled(checked)}
 * />
 * ```
 */
interface SettingsToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  labelOn?: string
  labelOff?: string
  sx?: SxProps<Theme>
}

export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  labelOn,
  labelOff,
  sx,
}: SettingsToggleProps) {
  const { t } = useTranslation()
  const resolvedLabelOn = labelOn ?? t('common.on')
  const resolvedLabelOff = labelOff ?? t('common.off')
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: (theme) => theme.custom.spacing.md,
        p: (theme) => theme.custom.spacing.sm,
        borderRadius: (theme) => theme.custom.borderRadius.md,
        opacity: disabled ? 0.5 : 1,
        ...sx,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body1"
          sx={{
            fontWeight: 500,
            color: 'text.primary',
          }}
        >
          {label}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mt: 0.5,
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <ToggleButtonGroup
        value={checked ? 'on' : 'off'}
        exclusive
        onChange={(_, newValue) => {
          if (newValue !== null) {
            onChange(newValue === 'on')
          }
        }}
        disabled={disabled}
        size="small"
        sx={{
          flexShrink: 0,
          '& .MuiToggleButton-root': {
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'none',
            borderColor: 'divider',
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
            },
          },
        }}
      >
        <ToggleButton value="off">{resolvedLabelOff}</ToggleButton>
        <ToggleButton value="on">{resolvedLabelOn}</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}

/**
 * Settings Number Toggle - Toggle button group for numeric options
 *
 * @example
 * ```tsx
 * <SettingsNumberToggle
 *   label="Max attempts"
 *   value={3}
 *   onChange={(value) => setValue(value)}
 *   options={[1, 2, 3, 4, 5]}
 * />
 * ```
 */
interface SettingsNumberToggleProps {
  label: string
  value: number
  onChange: (value: number) => void
  options: number[]
  disabled?: boolean
  sx?: SxProps<Theme>
}

export function SettingsNumberToggle({
  label,
  value,
  onChange,
  options,
  disabled = false,
  sx,
}: SettingsNumberToggleProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: (theme) => theme.custom.spacing.md,
        p: (theme) => theme.custom.spacing.sm,
        borderRadius: (theme) => theme.custom.borderRadius.md,
        opacity: disabled ? 0.5 : 1,
        ...sx,
      }}
    >
      <Typography
        variant="body1"
        sx={{
          fontWeight: 500,
          color: 'text.primary',
        }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, newValue) => {
          if (newValue !== null) {
            onChange(newValue)
          }
        }}
        disabled={disabled}
        size="small"
        sx={{
          flexShrink: 0,
          '& .MuiToggleButton-root': {
            px: 1.5,
            py: 0.5,
            minWidth: 36,
            fontSize: '0.75rem',
            fontWeight: 600,
            borderColor: 'divider',
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
            },
          },
        }}
      >
        {options.map((opt) => (
          <ToggleButton key={opt} value={opt}>
            {opt}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  )
}

/**
 * Settings Option Toggle - Toggle button group for labeled options
 *
 * @example
 * ```tsx
 * <SettingsOptionToggle
 *   label="Auto-Regeneration"
 *   value={1}
 *   onChange={(value) => setValue(value)}
 *   options={[
 *     { value: 0, label: 'Deaktiviert' },
 *     { value: 1, label: 'Gebündelt' },
 *     { value: 2, label: 'Einzeln' },
 *   ]}
 * />
 * ```
 */
interface SettingsOptionToggleProps {
  label: string
  value: number
  onChange: (value: number) => void
  options: Array<{ value: number; label: string }>
  disabled?: boolean
  sx?: SxProps<Theme>
}

export function SettingsOptionToggle({
  label,
  value,
  onChange,
  options,
  disabled = false,
  sx,
}: SettingsOptionToggleProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: (theme) => theme.custom.spacing.md,
        p: (theme) => theme.custom.spacing.sm,
        borderRadius: (theme) => theme.custom.borderRadius.md,
        opacity: disabled ? 0.5 : 1,
        ...sx,
      }}
    >
      <Typography
        variant="body1"
        sx={{
          fontWeight: 500,
          color: 'text.primary',
        }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, newValue) => {
          if (newValue !== null) {
            onChange(newValue)
          }
        }}
        disabled={disabled}
        size="small"
        sx={{
          flexShrink: 0,
          '& .MuiToggleButton-root': {
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'none',
            borderColor: 'divider',
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
            },
          },
        }}
      >
        {options.map((opt) => (
          <ToggleButton key={opt.value} value={opt.value}>
            {opt.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  )
}
