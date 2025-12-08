/**
 * ImportModeSelector - Import Mode Selection Component
 *
 * Allows users to choose between:
 * - Creating a new project from markdown import
 * - Merging chapters into an existing project
 *
 * Features:
 * - Radio button group for mode selection
 * - Project dropdown/autocomplete for merge target selection
 * - Loads existing projects from backend
 * - Shows helper text explaining merge behavior
 */

import React, { memo, useCallback } from 'react'
import {
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Autocomplete,
  TextField,
  Typography,
  CircularProgress,
  Stack,
} from '@mui/material'
import { InfoOutlined as InfoIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useProjectsList } from '../../hooks/useProjectsQuery'
import type { Project } from '../../types'

interface ImportModeSelectorProps {
  /** Current import mode */
  mode: 'new' | 'merge'

  /** Callback when mode changes */
  onModeChange: (mode: 'new' | 'merge') => void

  /** Selected project ID for merge mode */
  mergeTargetId: string | null

  /** Callback when merge target changes */
  onMergeTargetChange: (projectId: string | null) => void
}

const ImportModeSelector = memo(({
  mode,
  onModeChange,
  mergeTargetId,
  onMergeTargetChange,
}: ImportModeSelectorProps) => {
  const { t } = useTranslation()

  // Load existing projects
  const { data: projects = [], isLoading: projectsLoading, error: projectsError } = useProjectsList()

  /**
   * Handle mode change from radio buttons
   */
  const handleModeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newMode = event.target.value as 'new' | 'merge'
      onModeChange(newMode)

      // Reset merge target when switching to new mode
      if (newMode === 'new') {
        onMergeTargetChange(null)
      }
    },
    [onModeChange, onMergeTargetChange]
  )

  /**
   * Handle project selection for merge mode
   */
  const handleProjectChange = useCallback(
    (_event: React.SyntheticEvent, value: Project | null) => {
      onMergeTargetChange(value?.id || null)
    },
    [onMergeTargetChange]
  )

  /**
   * Find selected project from ID
   */
  const selectedProject = mergeTargetId
    ? projects.find((p) => p.id === mergeTargetId) || null
    : null

  /**
   * Check if merge mode is available (has existing projects)
   */
  const hasMergeProjects = projects.length > 0

  return (
    <Box data-testid="import-mode-selector">
      <FormControl component="fieldset" fullWidth>
        <FormLabel
          component="legend"
          sx={{
            fontWeight: 600,
            color: 'text.primary',
            mb: 2,
            '&.Mui-focused': {
              color: 'text.primary',
            },
          }}
        >
          {t('import.mode.title')}
        </FormLabel>

        <Stack spacing={2.5}>
          {/* Radio Group */}
          <RadioGroup
            value={mode}
            onChange={handleModeChange}
            data-testid="import-mode-radio-group"
          >
            {/* Create New Project Option */}
            <FormControlLabel
              value="new"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {t('import.mode.new')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('import.mode.newHelp')}
                  </Typography>
                </Box>
              }
              data-testid="mode-new-radio"
            />

            {/* Merge into Existing Project Option */}
            <FormControlLabel
              value="merge"
              control={<Radio />}
              disabled={!hasMergeProjects && !projectsLoading}
              label={
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {t('import.mode.merge')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('import.mode.mergeHelp')}
                  </Typography>
                </Box>
              }
              data-testid="mode-merge-radio"
            />
          </RadioGroup>

          {/* Project Selection Dropdown (only visible when merge mode is selected) */}
          {mode === 'merge' && (
            <Box sx={{ pl: 4 }}>
              <Autocomplete
                value={selectedProject}
                onChange={handleProjectChange}
                options={projects}
                getOptionLabel={(option) => option.title}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                loading={projectsLoading}
                disabled={projectsLoading || !hasMergeProjects}
                data-testid="merge-target-select"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('import.mode.selectProject')}
                    size="small"
                    error={!!projectsError}
                    helperText={
                      projectsError
                        ? t('import.mode.projectsLoadError')
                        : !hasMergeProjects
                        ? t('import.mode.noProjects')
                        : undefined
                    }
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {projectsLoading ? <CircularProgress size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box>
                      <Typography variant="body2">{option.title}</Typography>
                      {option.description && (
                        <Typography variant="caption" color="text.secondary">
                          {option.description}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
              />
            </Box>
          )}

          {/* Info Box - Explaining merge behavior */}
          {mode === 'merge' && hasMergeProjects && (
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                p: 1.5,
                bgcolor: 'info.light',
                borderRadius: 1,
                border: 1,
                borderColor: 'info.main',
              }}
            >
              <InfoIcon
                fontSize="small"
                sx={{
                  color: 'info.dark',
                  mt: 0.2,
                }}
              />
              <Typography variant="caption" color="info.dark">
                {t('import.mode.mergeInfo')}
              </Typography>
            </Box>
          )}

          {/* No Projects Warning */}
          {!hasMergeProjects && !projectsLoading && (
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                p: 1.5,
                bgcolor: 'warning.light',
                borderRadius: 1,
                border: 1,
                borderColor: 'warning.main',
              }}
            >
              <InfoIcon
                fontSize="small"
                sx={{
                  color: 'warning.dark',
                  mt: 0.2,
                }}
              />
              <Typography variant="caption" color="warning.dark">
                {t('import.mode.noProjectsWarning')}
              </Typography>
            </Box>
          )}
        </Stack>
      </FormControl>
    </Box>
  )
})

ImportModeSelector.displayName = 'ImportModeSelector'

export default ImportModeSelector
