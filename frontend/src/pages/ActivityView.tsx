/**
 * ActivityView Component
 *
 * Real-time activity log displaying SSE events with filtering,
 * search, and virtualization for high performance.
 *
 * Features:
 * - Category/Severity/Time filters
 * - Debounced search (300ms)
 * - Virtualized list (@tanstack/react-virtual)
 * - Auto-scroll to latest
 * - Expandable event payload
 *
 * Performance:
 * - React.memo for EventItem
 * - useMemo for filtered events
 * - useCallback for event handlers
 * - Virtualization for 1000+ events
 *
 * @param embedded - When true, renders without ViewContainer/ViewHeader (for use in MonitoringView tabs)
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Paper,
  Stack,
  Chip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Typography,
  IconButton,
  Collapse,
  ToggleButtonGroup,
  ToggleButton,
  Switch,
  FormControlLabel,
  SelectChangeEvent,
  type Theme,
} from '@mui/material'
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  ExpandMore as ExpandIcon,
  DeleteOutline as ClearIcon,
  NotificationsActive as ActivityIcon,
} from '@mui/icons-material'
import { eventLogStore } from '@services/eventLog'
import { EventCategory, EventSeverity, TimeRange, LogEvent } from '../types/eventLog'
import { useConfirm } from '@hooks/useConfirm'
import {
  ViewContainer,
  ViewHeader,
  ViewToolbar,
  ViewContent,
  ViewFooter,
} from '@components/layout/ViewComponents'
import { EmptyState } from '@components/shared'

/**
 * Severity Icon Mapping
 */
const SEVERITY_ICONS: Record<EventSeverity, React.ReactElement> = {
  success: <SuccessIcon sx={{ color: 'success.main' }} />,
  error: <ErrorIcon sx={{ color: 'error.main' }} />,
  warning: <WarningIcon sx={{ color: 'warning.main' }} />,
  info: <InfoIcon sx={{ color: 'info.main' }} />,
}

/**
 * Severity Colors (using theme palette)
 */
const getSeverityColor = (severity: EventSeverity, theme: Theme): string => {
  const colors = {
    success: theme.palette.success.main,
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
  }
  return colors[severity]
}

/**
 * Event Item Component (Memoized)
 */
const EventItem = React.memo<{ event: LogEvent }>(({ event }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // Format timestamp
  const timestamp = useMemo(() => {
    const date = new Date(event.timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }, [event.timestamp])

  // Toggle payload expansion
  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <Paper
      elevation={1}
      sx={{
        p: 1,
        mb: 0.5,
        borderLeft: (theme) => `4px solid ${getSeverityColor(event.severity, theme)}`,
        position: 'relative',
        zIndex: expanded ? 10 : 1,
        '&:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    >
      {/* Main Row - Single Line */}
      <Stack direction="row" spacing={1} alignItems="center">
        {/* Icon */}
        <Box sx={{ display: 'flex', alignItems: 'center', fontSize: '1rem' }}>
          {SEVERITY_ICONS[event.severity]}
        </Box>

        {/* Event Type */}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: (theme) => getSeverityColor(event.severity, theme),
            whiteSpace: 'nowrap',
            fontSize: '0.75rem',
          }}
        >
          {event.eventType}
        </Typography>

        {/* Category Badge */}
        <Chip
          label={t(`activity.categories.${event.category}`)}
          size="small"
          sx={{ height: 18, fontSize: '0.65rem', px: 0.5 }}
        />

        {/* Message */}
        <Typography
          variant="caption"
          color="text.primary"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '0.75rem',
          }}
        >
          {event.message}
        </Typography>

        {/* Payload Button (if available) */}
        {event.payload && (
          <IconButton
            size="small"
            onClick={handleToggleExpand}
            sx={{ p: 0.5 }}
          >
            <ExpandIcon
              sx={{
                fontSize: '1rem',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
          </IconButton>
        )}

        {/* Timestamp */}
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            fontSize: '0.7rem',
          }}
        >
          {timestamp}
        </Typography>
      </Stack>

      {/* Expandable Payload */}
      {event.payload && (
        <Collapse in={expanded}>
          <Paper
            variant="outlined"
            sx={{
              mt: 1,
              p: 1.5,
              backgroundColor: (theme) =>
                theme.palette.mode === 'dark'
                  ? theme.palette.grey[900]
                  : theme.palette.grey[50],
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            <pre
              style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </Paper>
        </Collapse>
      )}
    </Paper>
  )
})

EventItem.displayName = 'EventItem'

interface ActivityViewProps {
  embedded?: boolean
}

/**
 * ActivityView Component
 */
export default function ActivityView({ embedded = false }: ActivityViewProps) {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()

  // Zustand store
  const events = eventLogStore((state) => state.events)
  const filters = eventLogStore((state) => state.filters)
  const autoScroll = eventLogStore((state) => state.autoScroll)
  const setFilter = eventLogStore((state) => state.setFilter)
  const resetFilters = eventLogStore((state) => state.resetFilters)
  const toggleAutoScroll = eventLogStore((state) => state.toggleAutoScroll)
  const clearEvents = eventLogStore((state) => state.clearEvents)
  const getFilteredEvents = eventLogStore((state) => state.getFilteredEvents)

  // Get filtered events (memoized)
  const filteredEvents = useMemo(() => getFilteredEvents(), [
    getFilteredEvents,
    events,
    filters,
  ])

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // Reduced from 120 to 40 for compact single-line items
    overscan: 10, // Increased overscan for smoother scrolling with more items visible
    measureElement: (el) => el?.getBoundingClientRect().height,
  })

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, {
        align: 'end',
        behavior: 'smooth',
      })
    }
  }, [filteredEvents.length, autoScroll, virtualizer])

  // Debounced search
  const [searchInput, setSearchInput] = useState(filters.searchQuery)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter('searchQuery', searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, setFilter])

  // Category filter handler
  const handleCategoryToggle = useCallback(
    (_event: React.MouseEvent<HTMLElement>, newCategories: EventCategory[]) => {
      if (newCategories.length > 0) {
        setFilter('categories', new Set(newCategories))
      }
    },
    [setFilter]
  )

  // Severity filter handler
  const handleSeverityChange = useCallback(
    (event: SelectChangeEvent<EventSeverity[]>) => {
      const value = event.target.value as EventSeverity[]
      setFilter('severities', new Set(value))
    },
    [setFilter]
  )

  // Time range filter handler
  const handleTimeRangeChange = useCallback(
    (event: SelectChangeEvent<TimeRange>) => {
      setFilter('timeRange', event.target.value as TimeRange)
    },
    [setFilter]
  )

  // Clear events handler
  const handleClearEvents = useCallback(async () => {
    const confirmed = await confirm(
      t('activity.clearEvents'),
      t('activity.clearConfirm'),
      {
        icon: <WarningIcon color="warning" />,
        confirmText: t('common.delete'),
        confirmColor: 'warning',
      }
    )

    if (confirmed) {
      clearEvents()
    }
  }, [confirm, t, clearEvents])

  // All categories for toggle button group
  const allCategories: EventCategory[] = [
    'tts',
    'quality',
    'export',
    'health',
    'speakers',
    'settings',
    'chapter',
    'segment',
    'pronunciation',
  ]

  // Render content (filters + event list + footer)
  const content = (
    <>
      {/* ViewToolbar - Filters */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={2} sx={{ width: '100%' }}>
          {/* Row 1: Category Chips */}
          <Box>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mb: 1 }}
            >
              {t('activity.filters.categories')}
            </Typography>
            <ToggleButtonGroup
              value={Array.from(filters.categories)}
              onChange={handleCategoryToggle}
              size="small"
              sx={{ flexWrap: 'wrap', gap: 0.5 }}
            >
              {allCategories.map((category) => (
                <ToggleButton key={category} value={category}>
                  {t(`activity.categories.${category}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {/* Row 2: Severity + Time + Search */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            {/* Severity Select */}
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t('activity.filters.severity')}</InputLabel>
              <Select
                multiple
                value={Array.from(filters.severities)}
                onChange={handleSeverityChange}
                label={t('activity.filters.severity')}
              >
                {(['info', 'success', 'warning', 'error'] as EventSeverity[]).map(
                  (severity) => (
                    <MenuItem key={severity} value={severity}>
                      {t(`activity.severity.${severity}`)}
                    </MenuItem>
                  )
                )}
              </Select>
            </FormControl>

            {/* Time Range Select */}
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t('activity.filters.timeRange')}</InputLabel>
              <Select
                value={filters.timeRange}
                onChange={handleTimeRangeChange}
                label={t('activity.filters.timeRange')}
              >
                {(['5min', '1hour', 'today', 'all'] as TimeRange[]).map(
                  (range) => (
                    <MenuItem key={range} value={range}>
                      {t(`activity.timeRange.${range}`)}
                    </MenuItem>
                  )
                )}
              </Select>
            </FormControl>

            {/* Search */}
            <TextField
              size="small"
              placeholder={t('activity.filters.search')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
            />
          </Stack>
        </Stack>
      </Box>

      {/* ViewContent - Event List (Virtualized) */}
      <Box
        ref={parentRef}
        sx={{
          flex: 1,
          padding: '24px',
          bgcolor: 'background.default',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={<InfoIcon />}
            message={t('activity.noEvents')}
            description={t('activity.noEventsDescription')}
          />
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <EventItem event={filteredEvents[virtualRow.index]} />
              </div>
            ))}
          </div>
        )}
      </Box>

      {/* ViewFooter */}
      <ViewFooter
        status={
          <Stack direction="row" spacing={3} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {t('activity.eventCount', { count: events.length })}
            </Typography>
            <FormControlLabel
              control={
                <Switch checked={autoScroll} onChange={toggleAutoScroll} />
              }
              label={t('activity.autoScroll')}
            />
          </Stack>
        }
        actions={
          <Button
            variant="text"
            size="small"
            onClick={resetFilters}
          >
            {t('activity.resetFilters')}
          </Button>
        }
      />
    </>
  )

  // Render embedded or standalone
  if (embedded) {
    return (
      <>
        <ConfirmDialog />
        {content}
      </>
    )
  }

  // Standalone mode with header and actions
  return (
    <>
      <ConfirmDialog />
      <ViewContainer>
        {/* ViewHeader */}
        <ViewHeader
          title={t('activity.title')}
          icon={<ActivityIcon />}
          actions={
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<ClearIcon />}
              onClick={handleClearEvents}
              disabled={events.length === 0}
            >
              {t('activity.clearEvents')}
            </Button>
          }
        />

        {content}
      </ViewContainer>
    </>
  )
}
