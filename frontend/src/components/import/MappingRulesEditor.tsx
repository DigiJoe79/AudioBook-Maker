/**
 * MappingRulesEditor - Configure Markdown Mapping Rules
 *
 * Allows users to configure how markdown syntax maps to:
 * - Project Title (heading level)
 * - Chapters (heading level)
 * - Dividers (pattern)
 *
 * Features:
 * - Dropdown selectors for heading levels (# → H1, ## → H2, etc.)
 * - Text input for divider pattern
 * - Reset to defaults button
 * - Helper text explaining each rule
 */

import React, { useCallback, memo } from 'react'
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Stack,
  Typography,
  Divider,
} from '@mui/material'
import { RestartAlt as ResetIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { MappingRules } from '../../types/import'
import { DEFAULT_MAPPING_RULES } from '../../types/import'

interface MappingRulesEditorProps {
  mappingRules: MappingRules
  onChange: (rules: MappingRules) => void
}

/**
 * Heading level options for dropdown
 */
const HEADING_OPTIONS = [
  { value: '#', label: 'import.mapping.heading1' },      // Heading 1
  { value: '##', label: 'import.mapping.heading2' },     // Heading 2
  { value: '###', label: 'import.mapping.heading3' },    // Heading 3
  { value: '####', label: 'import.mapping.heading4' },   // Heading 4
  { value: '#####', label: 'import.mapping.heading5' },  // Heading 5
  { value: '######', label: 'import.mapping.heading6' }, // Heading 6
]

/**
 * Divider pattern options for dropdown
 */
const DIVIDER_OPTIONS = [
  { value: '***', label: '***' },
  { value: '---', label: '---' },
  { value: '___', label: '___' },
]

const MappingRulesEditor = memo(({ mappingRules, onChange }: MappingRulesEditorProps) => {
  const { t } = useTranslation()

  /**
   * Handle project heading change
   */
  const handleProjectHeadingChange = useCallback(
    (value: string) => {
      onChange({
        ...mappingRules,
        projectHeading: value,
      })
    },
    [mappingRules, onChange]
  )

  /**
   * Handle chapter heading change
   */
  const handleChapterHeadingChange = useCallback(
    (value: string) => {
      onChange({
        ...mappingRules,
        chapterHeading: value,
      })
    },
    [mappingRules, onChange]
  )

  /**
   * Handle divider pattern change
   */
  const handleDividerPatternChange = useCallback(
    (value: string) => {
      onChange({
        ...mappingRules,
        dividerPattern: value,
      })
    },
    [mappingRules, onChange]
  )

  /**
   * Reset to default rules
   */
  const handleReset = useCallback(() => {
    onChange(DEFAULT_MAPPING_RULES)
  }, [onChange])

  return (
    <Box data-testid="mapping-rules-editor">
      <Stack spacing={3}>
        {/* Header with Reset Button */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography variant="body2" fontWeight="medium" color="text.secondary">
            {t('import.mapping.title')}
          </Typography>
          <Button
            size="small"
            startIcon={<ResetIcon />}
            onClick={handleReset}
            data-testid="reset-button"
            sx={{
              textTransform: 'none',
              color: 'text.secondary',
              '&:hover': {
                color: 'primary.main',
              },
            }}
          >
            {t('import.mapping.resetToDefaults')}
          </Button>
        </Box>

        <Divider />

        {/* Project Title Heading */}
        <Box data-testid="project-title-rule">
          <FormControl fullWidth size="small">
            <InputLabel id="project-heading-label">{t('import.mapping.projectTitle')}</InputLabel>
            <Select
              labelId="project-heading-label"
              value={mappingRules.projectHeading}
              label={t('import.mapping.projectTitle')}
              onChange={(e) => handleProjectHeadingChange(e.target.value)}
              data-testid="project-heading-select"
            >
              {HEADING_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" component="span" fontFamily="monospace">
                      {option.value}
                    </Typography>
                    <Typography variant="body2" component="span" color="text.secondary">
                      →
                    </Typography>
                    <Typography variant="body2" component="span">
                      {t(option.label)}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('import.mapping.projectTitleHelp')}
          </Typography>
        </Box>

        {/* Chapter Heading */}
        <Box data-testid="chapter-rule">
          <FormControl fullWidth size="small">
            <InputLabel id="chapter-heading-label">{t('import.mapping.chapter')}</InputLabel>
            <Select
              labelId="chapter-heading-label"
              value={mappingRules.chapterHeading}
              label={t('import.mapping.chapter')}
              onChange={(e) => handleChapterHeadingChange(e.target.value)}
              data-testid="chapter-heading-select"
            >
              {HEADING_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" component="span" fontFamily="monospace">
                      {option.value}
                    </Typography>
                    <Typography variant="body2" component="span" color="text.secondary">
                      →
                    </Typography>
                    <Typography variant="body2" component="span">
                      {t(option.label)}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('import.mapping.chapterHelp')}
          </Typography>
        </Box>

        {/* Divider Pattern */}
        <Box data-testid="divider-rule">
          <FormControl fullWidth size="small">
            <InputLabel id="divider-pattern-label">{t('import.mapping.divider')}</InputLabel>
            <Select
              labelId="divider-pattern-label"
              value={mappingRules.dividerPattern}
              label={t('import.mapping.divider')}
              onChange={(e) => handleDividerPatternChange(e.target.value)}
              data-testid="divider-pattern-select"
            >
              {DIVIDER_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Typography variant="body2" component="span" fontFamily="monospace">
                    {option.label}
                  </Typography>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('import.mapping.dividerHelp')}
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
})

MappingRulesEditor.displayName = 'MappingRulesEditor'

export default MappingRulesEditor
