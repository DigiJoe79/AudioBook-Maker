/**
 * PronunciationView - Pronunciation Rules Editor
 *
 * Full-screen pronunciation rules management extracted from PronunciationRulesDialog.
 * Provides more vertical space for large rule sets (+120px from no AudioPlayer).
 * Uses View Pattern System for consistent UI.
 *
 * Performance: Virtualized list with @tanstack/react-virtual for 100-200+ rules.
 */

import React, { useState, useMemo, memo, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Box,
  TextField,
  Select,
  MenuItem,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Paper,
  Checkbox,
  Tooltip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  FormHelperText,
  FormControl,
  InputLabel,
  IconButton,
  Divider,
} from '@mui/material'
import {
  Add,
  Delete,
  Edit,
  Warning,
  Download,
  Upload,
  Save,
  FormatQuote as PronunciationIcon,
  MenuBook,
  Spellcheck,
} from '@mui/icons-material'
import {
  ViewContainer,
  ViewHeader,
  ViewToolbar,
  ViewContent,
  ViewFooter,
} from '@components/layout/ViewComponents'
import { Section, EmptyState, FilterGroup, FilterItem } from '@components/shared'
import {
  usePronunciationRules,
  usePronunciationConflicts,
  useBulkPronunciationOperation,
  useDeletePronunciationRule,
  useTogglePronunciationRule,
  useCreatePronunciationRule,
  useUpdatePronunciationRule,
  useImportPronunciationRules,
} from '@hooks/usePronunciationQuery'
import { useAllEnginesStatus } from '@hooks/useEnginesQuery'
import { useProjectsList } from '@hooks/useProjectsQuery'
import { useAppStore } from '@store/appStore'
import type { PronunciationRule } from '@types'
import { useConfirm } from '@hooks/useConfirm'
import { useSnackbar } from '@hooks/useSnackbar'
import { pronunciationApi } from '@services/api'
import { useTranslation } from 'react-i18next'
import { Warning as WarningIcon } from '@mui/icons-material'
import { translateBackendError } from '@utils/translateBackendError'
import { logger } from '@/utils/logger'

// ============================================================================
// RuleItem Component (Memoized)
// ============================================================================

interface RuleItemProps {
  rule: PronunciationRule
  isSelected: boolean
  hasConflict: boolean
  isInactive?: boolean
  onSelectRule: (ruleId: string) => void
  onEditRule: (rule: PronunciationRule) => void
  onToggleRule: (ruleId: string, isActive: boolean) => void
  onDeleteRule: (ruleId: string, ruleName: string) => void
  getProjectName: (projectId: string | null | undefined) => string
  getEngineDisplayName: (engineName: string) => string
}

const RuleItem = memo<RuleItemProps>(({
  rule,
  isSelected,
  hasConflict,
  isInactive = false,
  onSelectRule,
  onEditRule,
  onToggleRule,
  onDeleteRule,
  getProjectName,
  getEngineDisplayName,
}) => {
  const { t } = useTranslation()

  return (
    <Paper
      sx={{
        mb: 0.5,
        p: 1,
        borderLeft: 3,
        borderColor: isInactive ? 'text.disabled' : (hasConflict ? 'error.main' : 'divider'),
        bgcolor: isSelected ? 'action.selected' : 'background.paper',
        opacity: isInactive ? 0.6 : 1,
        transition: 'all 0.2s',
        '&:hover': { bgcolor: 'action.hover', opacity: isInactive ? 0.75 : 1 },
      }}
    >
      <Box display="flex" alignItems="center" gap={1.5}>
        {/* Checkbox */}
        <Checkbox
          checked={isSelected}
          onChange={() => onSelectRule(rule.id)}
          size="small"
          sx={{ p: 0 }}
        />

        {/* Typ-Indikator */}
        <Chip
          label={rule.isRegex ? 'R' : 'T'}
          size="small"
          variant="outlined"
          color={rule.isRegex ? 'warning' : 'default'}
          sx={{
            height: 20,
            width: 28,
            fontSize: '0.6875rem',
            fontWeight: 600,
            '& .MuiChip-label': { px: 0.5 }
          }}
        />

        {/* Pattern & Replacement - tabellarisch */}
        <Box display="flex" alignItems="center" gap={1} flex="1" minWidth={0}>
          <Typography
            variant="body2"
            fontFamily="monospace"
            sx={{
              bgcolor: 'action.hover',
              px: 0.75,
              py: 0.25,
              borderRadius: 0.5,
              fontSize: '0.8125rem',
              width: '35%',
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={rule.pattern}
          >
            {rule.pattern}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, width: '24px', textAlign: 'center' }}>→</Typography>
          <Typography
            variant="body2"
            fontFamily="monospace"
            sx={{
              bgcolor: 'action.hover',
              px: 0.75,
              py: 0.25,
              borderRadius: 0.5,
              fontSize: '0.8125rem',
              width: '35%',
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={rule.replacement}
          >
            {rule.replacement}
          </Typography>
        </Box>

        {/* Metadata Chips - rechtsbündig */}
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{
            flexShrink: 0,
            ml: 'auto',
            mr: 2
          }}
        >
          {rule.scope === 'engine' ? (
            <Chip
              label={`🔧 ${getEngineDisplayName(rule.engineName)} (${rule.language ? t(`languages.${rule.language}`, rule.language.toUpperCase()) : t('pronunciation.dialog.language.all')})`}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6875rem', minWidth: 125, '& .MuiChip-label': { px: 0.75 } }}
            />
          ) : (
            <Chip
              icon={<MenuBook sx={{ fontSize: 14 }} />}
              label={getProjectName(rule.projectId)}
              size="small"
              variant="outlined"
              color="primary"
              sx={{ height: 20, fontSize: '0.6875rem', minWidth: 125, '& .MuiChip-label': { px: 0.75 } }}
            />
          )}
          {hasConflict && (
            <Tooltip title={t('pronunciation.dialog.status.hasConflicts')}>
              <Chip
                icon={<Warning sx={{ fontSize: '0.875rem' }} />}
                label={t('pronunciation.dialog.status.conflict')}
                color="warning"
                size="small"
                sx={{ height: 20, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }}
              />
            </Tooltip>
          )}
        </Stack>

        {/* Actions als IconButtons */}
        <Box display="flex" gap={0.5} sx={{ flexShrink: 0 }}>
          <Tooltip title={t('pronunciation.dialog.actions.edit')}>
            <IconButton size="small" onClick={() => onEditRule(rule)}>
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('pronunciation.dialog.actions.toggleActive')}>
            <IconButton
              size="small"
              onClick={() => onToggleRule(rule.id, !rule.isActive)}
            >
              <Warning fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('pronunciation.dialog.actions.delete')}>
            <IconButton
              size="small"
              color="error"
              onClick={() => onDeleteRule(rule.id, rule.pattern)}
            >
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Paper>
  )
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant props changed
  return (
    prevProps.rule.id === nextProps.rule.id &&
    prevProps.rule.pattern === nextProps.rule.pattern &&
    prevProps.rule.replacement === nextProps.rule.replacement &&
    prevProps.rule.isRegex === nextProps.rule.isRegex &&
    prevProps.rule.isActive === nextProps.rule.isActive &&
    prevProps.rule.scope === nextProps.rule.scope &&
    prevProps.rule.engineName === nextProps.rule.engineName &&
    prevProps.rule.language === nextProps.rule.language &&
    prevProps.rule.projectId === nextProps.rule.projectId &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.hasConflict === nextProps.hasConflict &&
    prevProps.isInactive === nextProps.isInactive
  )
})

RuleItem.displayName = 'RuleItem'

// ============================================================================
// VirtualizedRulesList Component
// ============================================================================

interface VirtualizedRulesListProps {
  rules: PronunciationRule[]
  title: string
  defaultCollapsed?: boolean
  isInactive?: boolean
  selectedRules: string[]
  hasConflict: (ruleId: string) => boolean
  onSelectRule: (ruleId: string) => void
  onEditRule: (rule: PronunciationRule) => void
  onToggleRule: (ruleId: string, isActive: boolean) => void
  onDeleteRule: (ruleId: string, ruleName: string) => void
  getProjectName: (projectId: string | null | undefined) => string
  getEngineDisplayName: (engineName: string) => string
}

const VirtualizedRulesList = memo<VirtualizedRulesListProps>(({
  rules,
  title,
  defaultCollapsed = false,
  isInactive = false,
  selectedRules,
  hasConflict,
  onSelectRule,
  onEditRule,
  onToggleRule,
  onDeleteRule,
  getProjectName,
  getEngineDisplayName,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Virtualization
  const rowVirtualizer = useVirtualizer({
    count: rules.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 60, []), // ~60px per rule item (compact layout)
    overscan: 10,
    measureElement: typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
      ? (element) => element?.getBoundingClientRect().height
      : undefined,
  })

  return (
    <Section
      title={title}
      count={rules.length}
      defaultCollapsed={defaultCollapsed}
    >
      <Box
        ref={scrollRef}
        sx={{
          maxHeight: 600, // Max height for scrollable area
          overflow: 'auto',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rule = rules[virtualRow.index]

            return (
              <div
                key={rule.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <RuleItem
                  rule={rule}
                  isSelected={selectedRules.includes(rule.id)}
                  hasConflict={hasConflict(rule.id)}
                  isInactive={isInactive}
                  onSelectRule={onSelectRule}
                  onEditRule={onEditRule}
                  onToggleRule={onToggleRule}
                  onDeleteRule={onDeleteRule}
                  getProjectName={getProjectName}
                  getEngineDisplayName={getEngineDisplayName}
                />
              </div>
            )
          })}
        </div>
      </Box>
    </Section>
  )
})

VirtualizedRulesList.displayName = 'VirtualizedRulesList'

// ============================================================================
// Main PronunciationView Component
// ============================================================================

const PronunciationView = memo(() => {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const { showSnackbar, SnackbarComponent } = useSnackbar()

  // Filters - Dynamic client-side filtering
  const [contextFilter, setContextFilter] = useState<string>('') // Format: "engine:name|lang" or "project:id"
  const [searchText, setSearchText] = useState('')
  const [selectedRules, setSelectedRules] = useState<string[]>([])

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<PronunciationRule | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    pattern: '',
    replacement: '',
    isRegex: false,
    scope: 'engine' as 'project_engine' | 'engine',
    engineName: 'xtts',
    language: 'de',
    projectId: undefined as string | undefined,
    isActive: true,
  })

  // Mutations
  const createRuleMutation = useCreatePronunciationRule()
  const updateRuleMutation = useUpdatePronunciationRule()
  const importRulesMutation = useImportPronunciationRules()

  const defaultEngine = useAppStore((state) => state.getDefaultTtsEngine())
  const settings = useAppStore((state) => state.settings)

  // Fetch all rules - filtering done client-side for dynamic filter options
  const { data: rulesData, isLoading, refetch: refetchRules } = usePronunciationRules()
  const { data: conflictsData } = usePronunciationConflicts('', '')
  const { data: enginesStatus } = useAllEnginesStatus()
  const engines = enginesStatus?.tts ?? []
  const { data: projects = [] } = useProjectsList()
  const bulkOperation = useBulkPronunciationOperation()
  const deleteRule = useDeletePronunciationRule()
  const toggleRule = useTogglePronunciationRule()

  const allRules = rulesData?.rules || []

  const getProjectName = useCallback((projectId: string | null | undefined): string => {
    if (!projectId) return '-'
    const project = projects.find(p => p.id === projectId)
    return project?.title || projectId
  }, [projects])

  const getEngineDisplayName = useCallback((engineName: string): string => {
    const engine = engines.find(e => e.name === engineName)
    return engine?.displayName || engineName
  }, [engines])

  const availableLanguages = useMemo(() => {
    const langSet = new Set<string>()
    engines.forEach(engine => {
      engine.supportedLanguages?.forEach(lang => langSet.add(lang))
    })
    return Array.from(langSet).sort()
  }, [engines])

  // Dynamic context filter options (engines and projects with rules)
  const contextFilterOptions = useMemo(() => {
    // Engine+Language combinations (only where scope='engine' rules exist)
    const engineCombos = new Set<string>()
    allRules.forEach(rule => {
      if (rule.scope === 'engine') {
        engineCombos.add(`${rule.engineName}|${rule.language}`)
      }
    })
    const engineOptions = Array.from(engineCombos).map(key => {
      const [engineName, lang] = key.split('|')
      const engine = engines.find(e => e.name === engineName)
      return {
        type: 'engine' as const,
        value: `engine:${key}`,
        label: `🔧 ${engine?.displayName || engineName} (${t(`languages.${lang}`, lang.toUpperCase())})`,
        engineName,
        language: lang
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    // Projects (only where scope='project_engine' rules exist)
    const projectIds = new Set<string>()
    allRules.forEach(rule => {
      if (rule.scope === 'project_engine' && rule.projectId) {
        projectIds.add(rule.projectId)
      }
    })
    const projectOptions = Array.from(projectIds).map(id => {
      const project = projects.find(p => p.id === id)
      return {
        type: 'project' as const,
        value: `project:${id}`,
        label: project?.title || id,
        projectId: id
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    return { engineOptions, projectOptions }
  }, [allRules, engines, projects, t])

  const { activeRules, inactiveRules } = useMemo(() => {
    let filtered = allRules

    // Context filter - strict separation between engines and projects
    if (contextFilter) {
      if (contextFilter.startsWith('engine:')) {
        // Show only scope='engine' rules for this engine+language
        const key = contextFilter.replace('engine:', '')
        const [engineName, language] = key.split('|')
        filtered = filtered.filter(r =>
          r.scope === 'engine' &&
          r.engineName === engineName &&
          r.language === language
        )
      } else if (contextFilter.startsWith('project:')) {
        // Show only scope='project_engine' rules for this project
        const projectId = contextFilter.replace('project:', '')
        filtered = filtered.filter(r =>
          r.scope === 'project_engine' &&
          r.projectId === projectId
        )
      }
    }

    // Search text filter
    if (searchText.trim()) {
      const search = searchText.toLowerCase()
      filtered = filtered.filter(
        rule => rule.pattern.toLowerCase().includes(search) || rule.replacement.toLowerCase().includes(search)
      )
    }

    const active = filtered.filter(r => r.isActive)
    const inactive = filtered.filter(r => !r.isActive)

    // Sort alphabetically by pattern
    const sortRules = (a: PronunciationRule, b: PronunciationRule) => {
      return a.pattern.localeCompare(b.pattern)
    }

    return {
      activeRules: active.sort(sortRules),
      inactiveRules: inactive.sort(sortRules),
    }
  }, [allRules, contextFilter, searchText])

  const hasConflict = useCallback((ruleId: string) => {
    return conflictsData?.conflicts.some(c => c.rule1.id === ruleId || c.rule2.id === ruleId) || false
  }, [conflictsData])

  const allVisibleRules = [...activeRules, ...inactiveRules]

  const handleSelectAll = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedRules(allVisibleRules.map(r => r.id))
    } else {
      setSelectedRules([])
    }
  }, [allVisibleRules])

  const handleSelectRule = useCallback((ruleId: string) => {
    setSelectedRules(prev => prev.includes(ruleId) ? prev.filter(id => id !== ruleId) : [...prev, ruleId])
  }, [])

  const handleBulkDelete = useCallback(async () => {
    const confirmed = await confirm(
      t('pronunciation.dialog.deleteConfirm.title'),
      t('pronunciation.dialog.deleteConfirm.messageMultiple'),
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )

    if (confirmed && selectedRules.length > 0) {
      await bulkOperation.mutateAsync({ ruleIds: selectedRules, action: 'delete' })
      setSelectedRules([])
    }
  }, [selectedRules, confirm, bulkOperation, t])

  const handleDeleteRule = useCallback(async (ruleId: string, ruleName: string) => {
    const confirmed = await confirm(
      t('pronunciation.dialog.deleteConfirm.title'),
      t('pronunciation.dialog.deleteConfirm.message', { ruleName }),
      {
        icon: <WarningIcon color="error" />,
        confirmColor: 'error',
      }
    )

    if (confirmed) {
      try {
        await deleteRule.mutateAsync(ruleId)
        showSnackbar(t('pronunciation.dialog.messages.deleted'), { severity: 'success' })
      } catch (error: unknown) {
        logger.error('[PronunciationView] Failed to delete rule', { error })
        const errorMessage = translateBackendError(
          error instanceof Error ? error.message : t('pronunciation.dialog.messages.deleteFailed'),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
      }
    }
  }, [confirm, deleteRule, showSnackbar, t])

  const handleToggleRule = useCallback((ruleId: string, isActive: boolean) => {
    toggleRule.mutate({ ruleId, isActive })
  }, [toggleRule])

  const handleExport = useCallback(async () => {
    try {
      // Extract engine and language from contextFilter if set
      let engineName: string | undefined
      let language: string | undefined
      if (contextFilter && contextFilter.startsWith('engine:')) {
        const key = contextFilter.replace('engine:', '')
        const parts = key.split('|')
        engineName = parts[0]
        language = parts[1]
      }

      const exportedRules = await pronunciationApi.exportRules({
        ruleIds: selectedRules.length > 0 ? selectedRules : undefined,
        engine: engineName,
        language: language,
      })

      if (!Array.isArray(exportedRules)) {
        throw new Error('Invalid export response: Expected array of rules')
      }

      if (exportedRules.length === 0) {
        showSnackbar(t('pronunciation.dialog.messages.exportEmpty'), { severity: 'info' })
        return
      }

      const dataStr = JSON.stringify(exportedRules, null, 2)

      // Import dynamically to avoid issues in non-Tauri environments
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')

      // Let user choose save location
      const filePath = await save({
        defaultPath: `pronunciation-rules-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (!filePath) {
        // User cancelled dialog
        return
      }

      await writeTextFile(filePath, dataStr)

      showSnackbar(t('pronunciation.dialog.messages.exportSuccess', { count: exportedRules.length }), { severity: 'success' })
    } catch (error: unknown) {
      const errorMessage = translateBackendError(
        error instanceof Error ? error.message : t('pronunciation.dialog.messages.exportFailed', { error: 'Unknown error' }),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
    }
  }, [selectedRules, contextFilter, t, showSnackbar])

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const importedRules = JSON.parse(e.target?.result as string)

        if (!Array.isArray(importedRules)) {
          throw new Error('Invalid format: Expected array of rules')
        }

        if (importedRules.length === 0) {
          showSnackbar(t('pronunciation.dialog.messages.importEmpty'), { severity: 'error' })
          event.target.value = ''
          return
        }

        const confirmed = await confirm(
          t('pronunciation.dialog.importConfirm.title'),
          t('pronunciation.dialog.importConfirm.message', { count: importedRules.length }),
          {
            confirmText: t('pronunciation.dialog.importConfirm.confirm'),
            confirmColor: 'primary',
          }
        )

        if (confirmed) {
          try {
            const result = await importRulesMutation.mutateAsync({ rules: importedRules, mode: 'merge' })
            showSnackbar(t('pronunciation.dialog.messages.importSuccess', { imported: result.imported, skipped: result.skipped }), { severity: 'success' })
          } catch (error: unknown) {
            const errorMessage = translateBackendError(
              error instanceof Error ? error.message : t('pronunciation.dialog.messages.importFailed', { error: 'Unknown error' }),
              t
            )
            showSnackbar(errorMessage, { severity: 'error' })
          }
        }

        event.target.value = ''
      } catch (error: unknown) {
        const errorMessage = translateBackendError(
          error instanceof Error ? error.message : t('pronunciation.dialog.messages.importFailed', { error: 'Unknown error' }),
          t
        )
        showSnackbar(errorMessage, { severity: 'error' })
        event.target.value = ''
      }
    }
    reader.readAsText(file)
  }, [t, confirm, importRulesMutation, showSnackbar])

  const handleOpenAddDialog = useCallback(() => {
    // Extract engine from contextFilter if set, otherwise use defaultEngine
    let filterEngine: string | undefined
    if (contextFilter && contextFilter.startsWith('engine:')) {
      const key = contextFilter.replace('engine:', '')
      filterEngine = key.split('|')[0]
    }
    const selectedEngine = filterEngine || defaultEngine
    const engineConfig = settings?.tts.engines[selectedEngine]
    const defaultLanguage = engineConfig?.defaultLanguage

    const engineInfo = engines.find(e => e.name === selectedEngine)
    const validLanguage =
      defaultLanguage && engineInfo?.supportedLanguages?.includes(defaultLanguage)
        ? defaultLanguage
        : engineInfo?.supportedLanguages?.[0] || 'en'

    setFormData({
      pattern: '',
      replacement: '',
      isRegex: false,
      scope: 'engine',
      engineName: selectedEngine,
      language: validLanguage,
      projectId: undefined,
      isActive: true,
    })
    setShowAddDialog(true)
  }, [contextFilter, defaultEngine, settings, engines])

  const handleOpenEditDialog = useCallback((rule: PronunciationRule) => {
    setFormData({
      pattern: rule.pattern,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      scope: rule.scope,
      engineName: rule.engineName,
      language: rule.language,
      projectId: rule.projectId,
      isActive: rule.isActive,
    })
    setEditingRule(rule)
  }, [])

  const handleCloseDialog = useCallback(() => {
    setShowAddDialog(false)
    setEditingRule(null)
  }, [])

  const handleSubmitRule = useCallback(async () => {
    try {
      if (editingRule) {
        await updateRuleMutation.mutateAsync({
          ruleId: editingRule.id,
          update: {
            pattern: formData.pattern,
            replacement: formData.replacement,
            isRegex: formData.isRegex,
            scope: formData.scope,
            projectId: formData.scope === 'project_engine' ? formData.projectId : undefined,
            engineName: formData.engineName,
            language: formData.language,
            isActive: formData.isActive,
          },
        })
        showSnackbar(t('pronunciation.dialog.messages.updated'), { severity: 'success' })
      } else {
        await createRuleMutation.mutateAsync({
          pattern: formData.pattern,
          replacement: formData.replacement,
          isRegex: formData.isRegex,
          scope: formData.scope,
          projectId: formData.scope === 'project_engine' ? formData.projectId : undefined,
          // Global scope: still needs engineName (used for storage) and language (used for filtering)
          // Backend query ignores engine_name for global rules, but model requires it for validation
          engineName: formData.engineName,
          language: formData.language,
          isActive: formData.isActive,
        })
        showSnackbar(t('pronunciation.dialog.messages.created'), { severity: 'success' })
      }
      handleCloseDialog()
    } catch (error: unknown) {
      logger.error('[PronunciationView] Failed to save rule', { error })
      const errorMessage = translateBackendError(
        error instanceof Error ? error.message : (editingRule ? t('pronunciation.dialog.messages.updateFailed') : t('pronunciation.dialog.messages.createFailed')),
        t
      )
      showSnackbar(errorMessage, { severity: 'error' })
    }
  }, [editingRule, formData, updateRuleMutation, createRuleMutation, handleCloseDialog, showSnackbar, t])

  return (
    <ViewContainer>
      {/* Header */}
      <ViewHeader
        title={t('pronunciation.dialog.title')}
        actions={
          <>
            <Button
              startIcon={importRulesMutation.isPending ? <CircularProgress size={16} /> : <Upload />}
              component="label"
              disabled={importRulesMutation.isPending}
              size="small"
            >
              {importRulesMutation.isPending ? t('pronunciation.dialog.actions.importing') : t('pronunciation.dialog.actions.import')}
              <input type="file" hidden accept=".json" onChange={handleImport} />
            </Button>
            <Button startIcon={<Download />} onClick={handleExport} size="small">
              {t('pronunciation.dialog.actions.export')}
            </Button>
            <Button startIcon={<Add />} variant="contained" onClick={handleOpenAddDialog} size="small">
              {t('pronunciation.dialog.actions.addRule')}
            </Button>
          </>
        }
      />

      {/* Toolbar - Filters */}
      <ViewToolbar variant="filters">
        <FilterGroup>
          <FilterItem label={t('pronunciation.dialog.search')} flexGrow={1} minWidth="200px">
            <TextField
              variant="outlined"
              size="small"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              fullWidth
              placeholder={t('pronunciation.dialog.searchPlaceholder')}
            />
          </FilterItem>
          <FilterItem label={t('pronunciation.dialog.context')} flexGrow={0} minWidth="270px">
            <Select value={contextFilter} onChange={(e) => setContextFilter(e.target.value)} size="small" fullWidth>
              <MenuItem value="">
                <em>{t('pronunciation.dialog.filter.allRules')}</em>
              </MenuItem>
              {(contextFilterOptions.engineOptions.length > 0 || contextFilterOptions.projectOptions.length > 0) && (
                <Divider key="divider-top" />
              )}
              {contextFilterOptions.engineOptions.length > 0 &&
                contextFilterOptions.engineOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))
              }
              {contextFilterOptions.engineOptions.length > 0 && contextFilterOptions.projectOptions.length > 0 && (
                <Divider key="divider" />
              )}
              {contextFilterOptions.projectOptions.length > 0 &&
                contextFilterOptions.projectOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    <MenuBook fontSize="small" sx={{ mr: 1, fontSize: 16 }} />
                    {option.label}
                  </MenuItem>
                ))
              }
            </Select>
          </FilterItem>
        </FilterGroup>
      </ViewToolbar>

      {/* Content - Scrollable */}
      <ViewContent>
        {/* Active Filter Chips */}
        {(contextFilter || searchText) && (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
            {contextFilter && (
              <Chip
                icon={contextFilter.startsWith('project:') ? <MenuBook fontSize="small" /> : undefined}
                label={
                  contextFilter.startsWith('engine:')
                    ? contextFilterOptions.engineOptions.find(o => o.value === contextFilter)?.label
                    : contextFilterOptions.projectOptions.find(o => o.value === contextFilter)?.label
                }
                onDelete={() => setContextFilter('')}
                size="small"
                color="primary"
              />
            )}
            {searchText && (
              <Chip
                label={`🔍 "${searchText}"`}
                onDelete={() => setSearchText('')}
                size="small"
                color="primary"
              />
            )}
            <Button
              size="small"
              onClick={() => {
                setContextFilter('')
                setSearchText('')
              }}
              sx={{ ml: 1 }}
            >
              {t('pronunciation.dialog.filter.resetAll')}
            </Button>
          </Stack>
        )}

        {selectedRules.length > 0 && (
          <Alert
            severity="info"
            action={
              <Box display="flex" gap={1}>
                <Button size="small" startIcon={<Delete />} color="error" onClick={handleBulkDelete}>
                  {t('pronunciation.dialog.actions.delete')}
                </Button>
              </Box>
            }
            sx={{ mb: 2 }}
          >
            {t('pronunciation.dialog.bulk.selected', { count: selectedRules.length })}
          </Alert>
        )}

        {isLoading ? (
          <EmptyState
            icon={<CircularProgress size={40} />}
            message={t('pronunciation.dialog.status.loading')}
          />
        ) : activeRules.length === 0 && inactiveRules.length === 0 ? (
          <EmptyState
            icon={<PronunciationIcon />}
            message={(contextFilter || searchText) ? t('pronunciation.dialog.filter.noRulesFound') : t('pronunciation.dialog.empty.noRules')}
            action={
              (contextFilter || searchText) ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setContextFilter('')
                    setSearchText('')
                  }}
                >
                  {t('pronunciation.dialog.filter.reset')}
                </Button>
              ) : (
                <Button variant="outlined" startIcon={<Add />} onClick={handleOpenAddDialog}>
                  {t('pronunciation.dialog.empty.createFirst')}
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Active Rules Section - Virtualized */}
            {activeRules.length > 0 && (
              <VirtualizedRulesList
                rules={activeRules}
                title={`● ${t('pronunciation.dialog.sections.active')}`}
                defaultCollapsed={false}
                isInactive={false}
                selectedRules={selectedRules}
                hasConflict={hasConflict}
                onSelectRule={handleSelectRule}
                onEditRule={handleOpenEditDialog}
                onToggleRule={handleToggleRule}
                onDeleteRule={handleDeleteRule}
                getProjectName={getProjectName}
                getEngineDisplayName={getEngineDisplayName}
              />
            )}

            {/* Inactive Rules Section - Virtualized */}
            {inactiveRules.length > 0 && (
              <VirtualizedRulesList
                rules={inactiveRules}
                title={`○ ${t('pronunciation.dialog.sections.inactive')}`}
                defaultCollapsed={true}
                isInactive={true}
                selectedRules={selectedRules}
                hasConflict={hasConflict}
                onSelectRule={handleSelectRule}
                onEditRule={handleOpenEditDialog}
                onToggleRule={handleToggleRule}
                onDeleteRule={handleDeleteRule}
                getProjectName={getProjectName}
                getEngineDisplayName={getEngineDisplayName}
              />
            )}
          </>
        )}
      </ViewContent>

      {/* Footer */}
      <ViewFooter
        status={
          !isLoading && allRules.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {t('pronunciation.dialog.footer.activeRulesCount', { count: activeRules.length })}
              {(contextFilter || searchText) &&
                ` ${t('pronunciation.dialog.footer.filteredFrom', { total: allRules.filter(r => r.isActive).length })}`}
            </Typography>
          ) : null
        }
      />

      {/* Add/Edit Dialog */}
      <Dialog
        open={showAddDialog || editingRule !== null}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Spellcheck />
            <Typography variant="h6">
              {editingRule ? t('pronunciation.dialog.form.editTitle') : t('pronunciation.dialog.form.addTitle')}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
          <Stack spacing={3}>
            <TextField label={t('pronunciation.dialog.form.pattern')} value={formData.pattern} onChange={(e) => setFormData({ ...formData, pattern: e.target.value })} fullWidth required autoFocus InputLabelProps={{ shrink: true }} placeholder={t('pronunciation.dialog.form.patternPlaceholder')} helperText={formData.isRegex ? t('pronunciation.dialog.form.patternHelperRegex') : t('pronunciation.dialog.form.patternHelperExact')} />

            <TextField label={t('pronunciation.dialog.form.replacement')} value={formData.replacement} onChange={(e) => setFormData({ ...formData, replacement: e.target.value })} fullWidth required InputLabelProps={{ shrink: true }} placeholder={t('pronunciation.dialog.form.replacementPlaceholder')} helperText={t('pronunciation.dialog.form.replacementHelper')} />

            <FormControl fullWidth>
              <InputLabel>{t('pronunciation.dialog.form.ruleScope')}</InputLabel>
              <Select
                value={formData.scope === 'engine' ? '__engine_all__' : formData.projectId || '__engine_all__'}
                label={t('pronunciation.dialog.form.ruleScope')}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '__engine_all__') {
                    // Engine scope (alle Projekte)
                    setFormData({ ...formData, scope: 'engine', projectId: undefined })
                  } else {
                    // Project scope
                    setFormData({ ...formData, scope: 'project_engine', projectId: value })
                  }
                }}
              >
                <MenuItem value="__engine_all__">
                  🔧 {t('pronunciation.dialog.form.scopeEngine')}
                </MenuItem>
                <Divider />
                {projects.map((project) => (
                  <MenuItem key={project.id} value={project.id}>
                    <MenuBook fontSize="small" sx={{ mr: 1, fontSize: 16 }} />
                    {t('pronunciation.dialog.form.validInProject')} {project.title}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{t('pronunciation.dialog.form.scopeHelper')}</FormHelperText>
            </FormControl>

            <Box display="flex" gap={2}>
              <FormControl fullWidth>
                <InputLabel>{t('pronunciation.dialog.form.ttsEngine')}</InputLabel>
                <Select value={formData.engineName} label={t('pronunciation.dialog.form.ttsEngine')} onChange={(e) => setFormData({ ...formData, engineName: e.target.value })}>
                  {engines.map((engine) => (
                    <MenuItem key={engine.name} value={engine.name}>
                      {engine.displayName}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{t('pronunciation.dialog.form.selectEngine')}</FormHelperText>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>{t('pronunciation.dialog.form.language')}</InputLabel>
                <Select value={formData.language} label={t('pronunciation.dialog.form.language')} onChange={(e) => setFormData({ ...formData, language: e.target.value })}>
                  {availableLanguages.map((lang) => (
                    <MenuItem key={lang} value={lang}>
                      {t(`languages.${lang}`, lang.toUpperCase())}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{t('pronunciation.dialog.form.selectLanguage')}</FormHelperText>
              </FormControl>
            </Box>

            <Box>
              <FormControlLabel control={<Checkbox checked={formData.isRegex} onChange={(e) => setFormData({ ...formData, isRegex: e.target.checked })} />} label={t('pronunciation.dialog.form.useRegex')} />
              <FormControlLabel control={<Checkbox checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />} label={t('pronunciation.dialog.form.active')} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
          <Button onClick={handleCloseDialog}>{t('pronunciation.dialog.form.cancel')}</Button>
          <Button variant="contained" onClick={handleSubmitRule} disabled={!formData.pattern || !formData.replacement || createRuleMutation.isPending || updateRuleMutation.isPending} startIcon={createRuleMutation.isPending || updateRuleMutation.isPending ? <CircularProgress size={16} /> : <Save />}>
            {editingRule ? t('pronunciation.dialog.form.updateRule') : t('pronunciation.dialog.form.createRule')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog */}
      <ConfirmDialog />

      {/* Snackbar notifications */}
      <SnackbarComponent />
    </ViewContainer>
  )
})

PronunciationView.displayName = 'PronunciationView'

export default PronunciationView
