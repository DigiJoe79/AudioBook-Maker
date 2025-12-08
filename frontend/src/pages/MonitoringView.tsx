/**
 * MonitoringView - Combined Jobs & Activity Monitoring
 *
 * Tab-based view combining TTS/Quality job monitoring and event log.
 * Provides centralized monitoring interface with tab navigation.
 *
 * Features:
 * - Tab 1: TTS Jobs (TTS job queue monitoring)
 * - Tab 2: Quality Jobs (Quality analysis job monitoring)
 * - Tab 3: Protokoll (Real-time event log)
 * - No tab persistence (always starts with TTS Jobs tab)
 * - Badge indicators for active jobs and events
 *
 * Architecture:
 * - Uses ViewContainer wrapper for entire view
 * - Tabs in header for navigation
 * - Child views render without their own ViewContainers (embedded mode)
 */

import React, { useState, useCallback, useMemo } from 'react'
import { Box, Tabs, Tab, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  DeleteSweep as DeleteSweepIcon,
  DeleteOutline as ClearIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import { ViewContainer, ViewHeader, ViewToolbar } from '@components/layout/ViewComponents'
import { useClearJobHistory, useTTSJobs } from '@hooks/useTTSQuery'
import { useQualityJobs, useClearQualityJobHistory } from '@hooks/useQualityQuery'
import { eventLogStore } from '@services/eventLog'
import { useConfirm } from '@hooks/useConfirm'
import { logger } from '@utils/logger'
import JobsView from './JobsView'
import QualityJobsView from './QualityJobsView'
import ActivityView from './ActivityView'

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

/**
 * TabPanel - Conditional rendering of tab content
 * Only renders child when active (performance optimization)
 */
const TabPanel = ({ children, value, index }: TabPanelProps) => {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`monitoring-tabpanel-${index}`}
      aria-labelledby={`monitoring-tab-${index}`}
      sx={{
        display: value === index ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      {value === index && children}
    </Box>
  )
}

/**
 * MonitoringView Component
 */
export default function MonitoringView() {
  const { t } = useTranslation()
  const { confirm, ConfirmDialog } = useConfirm()
  const [activeTab, setActiveTab] = useState(0)

  // TTS Jobs queries and mutations
  const { data: ttsJobsData } = useTTSJobs({ limit: 50 }, { refetchInterval: false })
  const ttsJobs = ttsJobsData?.jobs ?? []
  const finishedTTSJobs = useMemo(() => ttsJobs.filter((job) => job.status === 'completed' || job.status === 'failed'), [ttsJobs])
  const clearTTSJobHistoryMutation = useClearJobHistory()

  // Quality Jobs queries and mutations
  const { data: qualityJobsData } = useQualityJobs({ limit: 50 })
  const qualityJobs = qualityJobsData?.jobs ?? []
  const finishedQualityJobs = useMemo(() => qualityJobs.filter((job) => job.status === 'completed' || job.status === 'failed'), [qualityJobs])
  const clearQualityJobHistoryMutation = useClearQualityJobHistory()

  // Event log store
  const events = eventLogStore((state) => state.events)
  const clearEvents = eventLogStore((state) => state.clearEvents)

  // Tab change handler (memoized for performance)
  const handleTabChange = useCallback((_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue)
  }, [])

  // Clear TTS job history handler
  const handleClearTTSJobHistory = useCallback(async () => {
    const confirmed = await confirm(
      t('jobs.confirmClearHistory.title'),
      t('jobs.confirmClearHistory.message'),
      {
        icon: <WarningIcon color="warning" />,
        confirmText: t('common.delete'),
        confirmColor: 'warning',
      }
    )

    if (confirmed) {
      try {
        await clearTTSJobHistoryMutation.mutateAsync()
      } catch (err) {
        logger.error('[MonitoringView] Failed to clear TTS job history:', err)
      }
    }
  }, [clearTTSJobHistoryMutation, confirm, t])

  // Clear Quality job history handler
  const handleClearQualityJobHistory = useCallback(async () => {
    const confirmed = await confirm(
      t('qualityJobs.confirmClearHistory.title'),
      t('qualityJobs.confirmClearHistory.message'),
      {
        icon: <WarningIcon color="warning" />,
        confirmText: t('common.delete'),
        confirmColor: 'warning',
      }
    )

    if (confirmed) {
      try {
        await clearQualityJobHistoryMutation.mutateAsync()
      } catch (err) {
        logger.error('[MonitoringView] Failed to clear quality job history:', err)
      }
    }
  }, [clearQualityJobHistoryMutation, confirm, t])

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

  // Render action buttons based on active tab
  const headerActions = useMemo(() => {
    switch (activeTab) {
      case 0: // TTS Jobs
        return (
          <Button
            variant="contained"
            size="small"
            startIcon={<DeleteSweepIcon />}
            onClick={handleClearTTSJobHistory}
            disabled={finishedTTSJobs.length === 0 || clearTTSJobHistoryMutation.isPending}
          >
            {t('jobs.actions.clearHistory')}
          </Button>
        )
      case 1: // Quality Jobs
        return (
          <Button
            variant="contained"
            size="small"
            startIcon={<DeleteSweepIcon />}
            onClick={handleClearQualityJobHistory}
            disabled={finishedQualityJobs.length === 0 || clearQualityJobHistoryMutation.isPending}
          >
            {t('jobs.actions.clearHistory')}
          </Button>
        )
      case 2: // Protokoll (Activity)
        return (
          <Button
            variant="contained"
            size="small"
            startIcon={<ClearIcon />}
            onClick={handleClearEvents}
            disabled={events.length === 0}
          >
            {t('activity.clearEvents')}
          </Button>
        )
      default:
        return null
    }
  }, [activeTab, finishedTTSJobs.length, finishedQualityJobs.length, events.length, t, handleClearTTSJobHistory, handleClearQualityJobHistory, handleClearEvents, clearTTSJobHistoryMutation.isPending, clearQualityJobHistoryMutation.isPending])

  return (
    <>
      <ConfirmDialog />
      <ViewContainer>
        {/* Header */}
        <ViewHeader
          title={t('monitoring.title')}
          actions={headerActions}
        />

      {/* Tabs */}
      <ViewToolbar variant="tabs">
        <Tabs value={activeTab} onChange={handleTabChange} data-testid="monitoring-tabs">
          <Tab
            label={t('monitoring.tabs.ttsJobs')}
            id="monitoring-tab-0"
            aria-controls="monitoring-tabpanel-0"
            data-testid="tts-jobs-tab"
          />
          <Tab
            label={t('monitoring.tabs.qualityJobs')}
            id="monitoring-tab-1"
            aria-controls="monitoring-tabpanel-1"
            data-testid="quality-jobs-tab"
          />
          <Tab
            label={t('monitoring.tabs.protocol')}
            id="monitoring-tab-2"
            aria-controls="monitoring-tabpanel-2"
            data-testid="activity-tab"
          />
        </Tabs>
      </ViewToolbar>

      {/* Tab Content Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TabPanel value={activeTab} index={0}>
          <JobsView embedded />
        </TabPanel>
        <TabPanel value={activeTab} index={1}>
          <QualityJobsView embedded />
        </TabPanel>
        <TabPanel value={activeTab} index={2}>
          <ActivityView embedded />
        </TabPanel>
      </Box>
      </ViewContainer>
    </>
  )
}
