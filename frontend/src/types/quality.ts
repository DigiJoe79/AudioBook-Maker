/**
 * Generic Quality Analysis Types
 *
 * Engine-agnostic types for the unified quality analysis system.
 * Engines define their own metrics via fields/infoBlocks,
 * frontend renders them generically.
 */

// ==================== Field Types ====================

/**
 * Supported field rendering types.
 * Each type determines how the value is formatted in the UI.
 */
type FieldType = 'percent' | 'seconds' | 'text' | 'string' | 'number'

/**
 * Severity levels for info block items.
 */
type Severity = 'error' | 'warning' | 'info'

/**
 * Overall quality status.
 */
export type QualityStatus = 'perfect' | 'warning' | 'defect'

// ==================== Engine Result Types ====================

/**
 * Single field in engine details.
 * Keys are i18n keys, frontend localizes them.
 */
export interface QualityField {
  /** i18n key for field label (e.g., "confidence" -> t("quality.fields.confidence")) */
  key: string
  /** Field value (type determines rendering) */
  value: string | number | boolean
  /** Rendering hint */
  type: FieldType
}

/**
 * Single item in an info block.
 */
interface InfoBlockItem {
  /** i18n key or display text */
  text: string
  /** Severity determines icon/color */
  severity: Severity
  /** Optional details for i18n interpolation */
  details?: Record<string, unknown>
}

/**
 * Engine-specific details for UI rendering.
 * Structure is defined by engine, rendered generically by frontend.
 */
interface QualityEngineDetails {
  /** i18n key for section header (e.g., "whisperTranscription") */
  topLabel: string
  /** Ordered key-value pairs to display */
  fields: QualityField[]
  /** Grouped messages/issues by category */
  infoBlocks: Record<string, InfoBlockItem[]>
}

/**
 * Result from a single analysis engine.
 */
export interface QualityEngineResult {
  /** Engine type: "stt" or "audio" */
  engineType: 'stt' | 'audio'
  /** Engine identifier (e.g., "whisper", "silero-vad") */
  engineName: string
  /** This engine's quality score (0-100) */
  qualityScore: number
  /** This engine's quality status */
  qualityStatus: QualityStatus
  /** Engine-specific details */
  details: QualityEngineDetails
}

/**
 * Combined quality analysis result for a segment.
 * Aggregates results from all engines.
 */
interface QualityAnalysisResult {
  /** Aggregated score (average of all engines) */
  qualityScore: number
  /** Worst status from all engines */
  qualityStatus: QualityStatus
  /** Results from each engine */
  engines: QualityEngineResult[]
}

// ==================== Job Types ====================

/**
 * Segment status within a quality job.
 * Tracks whether segment has been analyzed in this job (for resume support).
 */
interface QualityJobSegmentStatus {
  id: string
  jobStatus: 'pending' | 'analyzed'
}

/**
 * Quality analysis job status.
 */
export interface QualityJob {
  id: string
  type: 'segment' | 'chapter'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling'
  sttEngine?: string
  sttModelName?: string
  audioEngine?: string
  language: string
  totalSegments: number
  processedSegments: number
  failedSegments: number
  currentSegmentId?: string
  chapterId?: string
  segmentId?: string
  segmentIds?: QualityJobSegmentStatus[]  // Segment tracking for resume
  triggerSource?: string
  errorMessage?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  // Display fields (from JOINs)
  chapterTitle?: string
  projectTitle?: string
}

// ==================== Response Types ====================

/**
 * Quality Jobs List Response
 * Response from /api/jobs/quality endpoints
 */
export interface QualityJobsListResponse {
  success: boolean
  jobs: QualityJob[]
  count: number
}

// ==================== Segment Extension ====================

/**
 * Segment with quality analysis data.
 * Extends base Segment with quality fields from backend.
 */
interface SegmentQualityData {
  /** Whether any analysis has been performed */
  qualityAnalyzed?: boolean
  /** Aggregated quality score (0-100) */
  qualityScore?: number
  /** Aggregated quality status */
  qualityStatus?: QualityStatus
  /** Full engine results (JSON from backend) */
  engineResults?: QualityEngineResult[]
}