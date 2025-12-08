/**
 * GenericQualityTooltip - Engine-agnostic quality details tooltip
 *
 * Renders any engine's quality results using the generic format.
 * Engines define their metrics via fields/infoBlocks, this component
 * renders them dynamically with proper i18n and formatting.
 */

import React, { useMemo, memo } from 'react'
import { Box, Tooltip, Typography, Divider, Chip, styled } from '@mui/material'
import {
  Warning,
  Error as ErrorIcon,
  Info as InfoIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type {
  QualityStatus,
  QualityEngineResult,
  QualityField,
} from '@types'

// ==================== Props ====================

interface GenericQualityTooltipProps {
  qualityScore: number
  qualityStatus: QualityStatus
  engines: QualityEngineResult[]
  children: React.ReactElement
}

// ==================== Styled Components ====================

const TooltipContent = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  minWidth: 320,
  maxWidth: 450,
}))

const EngineSection = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  '&:last-child': {
    marginBottom: 0,
  },
}))

const SectionHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: theme.spacing(1),
}))

const FieldRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(0.5, 0),
}))

const IssueItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1),
  padding: theme.spacing(0.5, 0),
}))

// ==================== Helper Functions ====================

const getStatusColor = (status: QualityStatus): string => {
  switch (status) {
    case 'perfect':
      return 'success.main'
    case 'warning':
      return 'warning.main'
    case 'defect':
      return 'error.main'
    default:
      return 'text.secondary'
  }
}

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case 'error':
      return <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />
    case 'warning':
      return <Warning sx={{ fontSize: 14, color: 'warning.main' }} />
    case 'info':
    default:
      return <InfoIcon sx={{ fontSize: 14, color: 'info.main' }} />
  }
}

// ==================== Field Formatter ====================

interface FormattedFieldProps {
  field: QualityField
  locale: string
}

const FormattedField = memo<FormattedFieldProps>(({ field, locale }) => {
  const { t } = useTranslation()

  const formattedValue = useMemo(() => {
    const { value, type } = field

    switch (type) {
      case 'percent':
        return `${value}%`

      case 'seconds':
        // Locale-aware decimal formatting
        return typeof value === 'number'
          ? `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}s`
          : `${value}s`

      case 'text':
        // Truncate long text
        const text = String(value)
        return text.length > 100 ? `${text.substring(0, 100)}...` : text

      case 'number':
        return typeof value === 'number'
          ? value.toLocaleString(locale)
          : String(value)

      case 'string':
      default:
        return String(value)
    }
  }, [field, locale])

  // Try to localize the key, fallback to key itself
  const label = t(`quality.fields.${field.key}`, { defaultValue: field.key })

  return (
    <FieldRow>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={500}>
        {formattedValue}
      </Typography>
    </FieldRow>
  )
})

FormattedField.displayName = 'FormattedField'

// ==================== Main Component ====================

export const GenericQualityTooltip = memo<GenericQualityTooltipProps>(({
  qualityScore,
  qualityStatus,
  engines,
  children,
}) => {
  const { t, i18n } = useTranslation()

  // Don't show tooltip if no engines
  if (!engines || engines.length === 0) {
    return children
  }

  const tooltipContent = (
    <TooltipContent>
      {/* Overall Status Header */}
      <SectionHeader>
        <Typography variant="subtitle2" fontWeight={600}>
          {t('quality.status.title')}
        </Typography>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="caption" fontWeight={500}>
            {qualityScore}%
          </Typography>
          <Chip
            label={t(`quality.status.${qualityStatus}`)}
            size="small"
            sx={{
              bgcolor: getStatusColor(qualityStatus),
              color: 'white',
              fontWeight: 600,
              fontSize: '0.7rem',
            }}
          />
        </Box>
      </SectionHeader>

      <Divider sx={{ my: 1.5 }} />

      {/* Engine Results */}
      {engines.map((engine, idx) => (
        <React.Fragment key={`${engine.engineType}-${engine.engineName}`}>
          <EngineSection>
            {/* Engine Header */}
            <SectionHeader>
              <Typography
                variant="caption"
                fontWeight={600}
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                {t(`quality.topLabels.${engine.details?.topLabel ?? 'unknown'}`, {
                  defaultValue: engine.details?.topLabel ?? engine.engineName,
                })}
              </Typography>
              <Chip
                label={`${engine.qualityScore}%`}
                size="small"
                sx={{
                  bgcolor: getStatusColor(engine.qualityStatus),
                  color: 'white',
                  fontSize: '0.65rem',
                  height: 18,
                }}
              />
            </SectionHeader>

            {/* Fields */}
            {(engine.details?.fields ?? []).map((field) => (
              <FormattedField
                key={field.key}
                field={field}
                locale={i18n.language}
              />
            ))}

            {/* Info Blocks */}
            {Object.entries(engine.details?.infoBlocks ?? {}).map(
              ([blockKey, items]) =>
                items.length > 0 && (
                  <Box key={blockKey} mt={1}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      mb={0.5}
                    >
                      {t(`quality.infoBlocks.${blockKey}`, {
                        defaultValue: blockKey,
                      })}{' '}
                      ({items.length})
                    </Typography>
                    {items.slice(0, 3).map((item, itemIdx) => (
                      <IssueItem key={itemIdx}>
                        {getSeverityIcon(item.severity)}
                        <Typography variant="caption">
                          {String(t(`quality.issues.${item.text}`, {
                            defaultValue: item.text,
                            ...item.details,
                          }))}
                        </Typography>
                      </IssueItem>
                    ))}
                    {items.length > 3 && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        fontStyle="italic"
                      >
                        {t('quality.whisper.andMore', {
                          count: items.length - 3,
                        })}
                      </Typography>
                    )}
                  </Box>
                )
            )}
          </EngineSection>

          {/* Divider between engines */}
          {idx < engines.length - 1 && <Divider sx={{ my: 1.5 }} />}
        </React.Fragment>
      ))}
    </TooltipContent>
  )

  return (
    <Tooltip
      title={tooltipContent}
      arrow
      placement="right"
      enterDelay={200}
      leaveDelay={100}
      componentsProps={{
        tooltip: {
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 3,
            border: 1,
            borderColor: 'divider',
            maxWidth: 500,
            '& .MuiTooltip-arrow': {
              color: 'background.paper',
              '&::before': {
                border: 1,
                borderColor: 'divider',
              },
            },
          },
        },
      }}
    >
      {children}
    </Tooltip>
  )
})

GenericQualityTooltip.displayName = 'GenericQualityTooltip'
