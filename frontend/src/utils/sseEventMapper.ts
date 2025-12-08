/**
 * SSE Event Mapper
 *
 * Utility functions to map SSE MessageEvents to LogEvents
 * for the Activity Log system.
 *
 * Architecture:
 * - Parses SSE event data
 * - Determines category from event type prefix
 * - Determines severity from event type suffix
 * - Generates human-readable messages
 */

import { LogEvent, EventCategory, EventSeverity } from '../types/eventLog'

/**
 * Event Type Prefix → Category Mapping
 */
const CATEGORY_MAP: Record<string, EventCategory> = {
  job: 'tts',
  'tts.': 'tts',
  quality: 'quality',
  export: 'export',
  import: 'chapter', // Import creates chapters, so use chapter category
  project: 'chapter', // Projects and chapters are closely related
  health: 'health',
  speaker: 'speakers',
  settings: 'settings',
  chapter: 'chapter',
  segment: 'segment',
  pronunciation: 'pronunciation',
  engine: 'health', // Engine status events are part of health monitoring
}

/**
 * Event Type Suffix → Severity Mapping
 */
const SEVERITY_KEYWORDS: Record<string, EventSeverity> = {
  failed: 'error',
  error: 'error',
  completed: 'success',
  success: 'success',
  created: 'success',
  deleted: 'success',
  updated: 'info',
  warning: 'warning',
  cancelled: 'warning',
  started: 'info',
  progress: 'info',
  resumed: 'info',
  enabled: 'success',
  disabled: 'warning',
  stopped: 'warning',
}

/**
 * Determine event category from event type
 */
function determineCategory(eventType: string): EventCategory {
  // Try exact prefix match (e.g., "job.started" → "tts")
  for (const [prefix, category] of Object.entries(CATEGORY_MAP)) {
    if (eventType.startsWith(prefix)) {
      return category
    }
  }

  // Fallback: health
  return 'health'
}

/**
 * Determine event severity from event type
 */
function determineSeverity(eventType: string): EventSeverity {
  // Check for severity keywords in event type
  const lowerType = eventType.toLowerCase()
  for (const [keyword, severity] of Object.entries(SEVERITY_KEYWORDS)) {
    if (lowerType.includes(keyword)) {
      return severity
    }
  }

  // Default: info
  return 'info'
}

/**
 * Generate human-readable message from event type and data
 */
function generateMessage(eventType: string, data: Record<string, unknown>): string {
  // Extract useful context from data with type safety
  const chapterId = (data.chapterId || data.chapter_id) as string | undefined
  const segmentId = (data.segmentId || data.segment_id) as string | undefined
  const jobId = (data.jobId || data.job_id) as string | undefined
  const speakerId = (data.speakerId || data.speaker_id) as string | undefined
  const projectId = (data.projectId || data.project_id) as string | undefined
  const chapterTitle = (data.chapterTitle || data.chapter_title) as string | undefined
  const projectTitle = (data.projectTitle || data.project_title) as string | undefined
  const error = (data.error || data.errorMessage || data.error_message) as string | undefined

  // Format message based on event type
  switch (eventType) {
    // TTS Job Events
    case 'job.created':
      return `TTS job created${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'job.started':
      return `TTS job started${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'job.progress':
      const processed = data.processedSegments || data.processed_segments || 0
      const total = data.totalSegments || data.total_segments || 0
      return `TTS job progress: ${processed}/${total} segments${chapterTitle ? ` (${chapterTitle})` : ''}`
    case 'job.completed':
      return `TTS job completed${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'job.failed':
      return `TTS job failed${error ? `: ${error}` : ''}${chapterTitle ? ` (${chapterTitle})` : ''}`
    case 'job.cancelling':
      return `TTS job cancelling${chapterTitle ? ` for chapter "${chapterTitle}"` : ''} - waiting for current segment`
    case 'job.cancelled':
      return `TTS job cancelled${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'job.resumed':
      return `TTS job resumed${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`

    // Segment Events
    case 'segment.started':
      return `Segment generation started${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.completed':
      return `Segment generation completed${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.failed':
      return `Segment generation failed${error ? `: ${error}` : ''}${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.frozen':
      return `Segment frozen${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.unfrozen':
      return `Segment unfrozen${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.updated':
      return `Segment updated${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.created':
      return `Segment created${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.deleted':
      return `Segment deleted${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'segment.reordered':
      const segmentCount = (data.segmentIds as string[] | undefined)?.length || 0
      return `Segments reordered${segmentCount ? `: ${segmentCount} segments` : ''}`

    // Chapter Events
    case 'chapter.updated':
      return `Chapter updated${chapterTitle ? ` "${chapterTitle}"` : ''}`
    case 'chapter.created':
      return `Chapter created${chapterTitle ? ` "${chapterTitle}"` : ''}${projectTitle ? ` in project "${projectTitle}"` : ''}`
    case 'chapter.deleted':
      return `Chapter deleted${chapterTitle ? ` "${chapterTitle}"` : ''}`
    case 'chapter.reordered':
      return `Chapters reordered${projectTitle ? ` in project "${projectTitle}"` : ''}`

    // Project Events
    case 'project.created':
      return `Project created${projectTitle ? ` "${projectTitle}"` : ''}`
    case 'project.updated':
      return `Project updated${projectTitle ? ` "${projectTitle}"` : ''}`
    case 'project.deleted':
      return `Project deleted${projectTitle ? ` "${projectTitle}"` : ''}`
    case 'project.reordered':
      const projectCount = (data.projectIds as string[] | undefined)?.length || 0
      return `Projects reordered${projectCount ? `: ${projectCount} projects` : ''}`

    // Export Events
    case 'export.started':
      return `Export started${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'export.progress':
      const exportProcessed = data.processedSegments || data.currentSegment || data.processed_segments || 0
      const exportTotal = data.totalSegments || data.total_segments || 0
      return `Export progress: ${exportProcessed}/${exportTotal} segments${chapterTitle ? ` (${chapterTitle})` : ''}`
    case 'export.completed':
      return `Export completed${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'export.failed':
      return `Export failed${error ? `: ${error}` : ''}${chapterTitle ? ` (${chapterTitle})` : ''}`

    // Import Events
    case 'import.started':
      return (data.message as string) || 'Import started'
    case 'import.progress':
      return (data.message as string) || 'Import in progress'
    case 'import.completed':
      return (data.message as string) || 'Import completed successfully'
    case 'import.failed':
      return (data.message as string) || 'Import failed'
    case 'import.cancelled':
      return (data.message as string) || 'Import cancelled'

    // Health Events
    case 'health.update':
      const status = (data.status as string) || 'unknown'
      return `Backend health: ${status}`

    // Speaker Events
    case 'speaker.created':
      const speakerName = (data.name as string) || speakerId
      return `Speaker created${speakerName ? `: ${speakerName}` : ''}`
    case 'speaker.updated':
      return `Speaker updated${data.name ? `: ${data.name as string}` : ''}`
    case 'speaker.deleted':
      return `Speaker deleted${data.name ? `: ${data.name as string}` : ''}`
    case 'speaker.sample_added':
      return `Speaker sample added${data.speakerName ? ` to ${data.speakerName as string}` : ''}`
    case 'speaker.sample_deleted':
      return `Speaker sample deleted${data.speakerName ? ` from ${data.speakerName as string}` : ''}`

    // Settings Events
    case 'settings.updated':
      return 'Settings updated'
    case 'settings.reset':
      return 'Settings reset to defaults'

    // Pronunciation Events
    case 'pronunciation.rule.created':
      return `Pronunciation rule created${data.pattern ? `: ${data.pattern as string}` : ''}`
    case 'pronunciation.rule.updated':
      return `Pronunciation rule updated${data.pattern ? `: ${data.pattern as string}` : ''}`
    case 'pronunciation.rule.deleted':
      return `Pronunciation rule deleted${data.pattern ? `: ${data.pattern as string}` : ''}`
    case 'pronunciation.rule.bulk_change':
      return `Pronunciation rules bulk ${data.action as string}: ${data.count} rules`
    case 'pronunciation.rules.imported':
      return `Pronunciation rules imported: ${data.count} rules`

    // Quality Events
    case 'quality.job.created':
      return `Quality analysis job created${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'quality.job.started':
      return `Quality analysis started${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'quality.job.progress':
      const qualityProcessed = data.processedSegments || data.processed_segments || 0
      const qualityTotal = data.totalSegments || data.total_segments || 0
      return `Quality analysis progress: ${qualityProcessed}/${qualityTotal} segments${chapterTitle ? ` (${chapterTitle})` : ''}`
    case 'quality.job.completed':
      return `Quality analysis completed${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'quality.job.failed':
      return `Quality analysis failed${error ? `: ${error}` : ''}${chapterTitle ? ` (${chapterTitle})` : ''}`
    case 'quality.job.cancelled':
      return `Quality analysis cancelled${chapterTitle ? ` for chapter "${chapterTitle}"` : ''}`
    case 'quality.segment.analyzed':
      const score = data.qualityScore ?? data.quality_score
      return `Quality analysis: ${score !== undefined ? `${score}%` : 'done'}${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`
    case 'quality.segment.failed':
      return `Quality analysis failed${error ? `: ${error}` : ''}${segmentId ? ` (${segmentId.substring(0, 8)})` : ''}`

    // Engine Events
    case 'engine.status': {
      const engines = (data.engines || {}) as Record<string, Array<{ isRunning?: boolean }>>
      const ttsCount = (engines.tts || []).length
      const textCount = (engines.text || []).length
      const sttCount = (engines.stt || []).length
      const runningTts = (engines.tts || []).filter((e) => e.isRunning).length
      const runningStt = (engines.stt || []).filter((e) => e.isRunning).length
      return `Engine status: TTS ${runningTts}/${ttsCount}, STT ${runningStt}/${sttCount}, Text ${textCount}`
    }
    case 'engine.started': {
      const engineName = (data.engineName || data.engine_name) as string || 'Unknown'
      const engineType = (data.engineType || data.engine_type) as string || 'unknown'
      const port = (data.port as number | string) || '?'
      return `Engine started: ${engineName} (${engineType}) on port ${port}`
    }
    case 'engine.stopped': {
      const engineName = (data.engineName || data.engine_name) as string || 'Unknown'
      const engineType = (data.engineType || data.engine_type) as string || 'unknown'
      const reason = (data.reason as string) || 'unknown'
      return `Engine stopped: ${engineName} (${engineType}) - Reason: ${reason}`
    }
    case 'engine.enabled': {
      const engineName = (data.engineName || data.engine_name) as string || 'Unknown'
      const engineType = (data.engineType || data.engine_type) as string || 'unknown'
      return `Engine enabled: ${engineName} (${engineType})`
    }
    case 'engine.disabled': {
      const engineName = (data.engineName || data.engine_name) as string || 'Unknown'
      const engineType = (data.engineType || data.engine_type) as string || 'unknown'
      return `Engine disabled: ${engineName} (${engineType})`
    }
    case 'engine.error': {
      const engineName = (data.engineName || data.engine_name) as string || 'Unknown'
      const engineType = (data.engineType || data.engine_type) as string || 'unknown'
      const engineError = (data.error as string) || 'Unknown error'
      return `Engine error: ${engineName} (${engineType}) - ${engineError}`
    }

    // Default: use event type as message
    default:
      return eventType.replace(/\./g, ' ').replace(/_/g, ' ')
  }
}

/**
 * Map SSE MessageEvent to LogEvent
 *
 * Parses the SSE event and creates a LogEvent for the Activity Log.
 *
 * @param event - SSE MessageEvent from backend
 * @returns LogEvent for Activity Log
 * @throws Error if event data is invalid
 *
 * @example
 * ```tsx
 * // In SSE handler
 * const handleMessage = (event: MessageEvent) => {
 *   try {
 *     const logEvent = mapSSEEventToLogEvent(event)
 *     eventLogStore.getState().addEvent(logEvent)
 *   } catch (error) {
 *     console.error('Failed to map SSE event:', error)
 *   }
 * }
 * ```
 */
export function mapSSEEventToLogEvent(event: MessageEvent): LogEvent {
  try {
    // Parse event data
    const data = JSON.parse(event.data)
    const eventType = data.event || event.type || 'unknown'

    // Determine category and severity
    const category = determineCategory(eventType)
    const severity = determineSeverity(eventType)

    // Generate human-readable message
    const message = generateMessage(eventType, data)

    // Create LogEvent
    return {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      category,
      severity,
      eventType,
      message,
      payload: data,
    }
  } catch (error) {
    // If parsing fails, create a generic error event
    return {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      category: 'health',
      severity: 'error',
      eventType: 'parse.error',
      message: `Failed to parse SSE event: ${error instanceof Error ? error.message : String(error)}`,
      payload: { rawData: event.data },
    }
  }
}
