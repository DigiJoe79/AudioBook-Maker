/**
 * SSE Event Data Types
 *
 * Type definitions for all Server-Sent Events (SSE) used across the application.
 * These types match the backend event data structures (with camelCase conversion via Pydantic).
 */

import type { QualityEngineResult } from './index'

// ============================================================================
// Health Events
// ============================================================================

export interface HealthUpdateData {
  status: 'ok' | 'error'
  version: string
  timestamp: string
  database: boolean
  ttsEngines: string[]
  busy: boolean
  activeJobs: number

  // Engine availability (for feature-gating)
  // NOTE: These are now Optional (null) because engine availability
  // is sent via engine.status SSE events instead
  hasTtsEngine: boolean | null
  hasTextEngine: boolean | null
  hasSttEngine: boolean | null
}

// ============================================================================
// Speaker Events
// ============================================================================

export interface SpeakerCreatedData {
  speakerId: string
  name: string
}

export interface SpeakerUpdatedData {
  speakerId: string
  name?: string
  isActive?: boolean
}

export interface SpeakerDeletedData {
  speakerId: string
}

export interface SpeakerSampleAddedData {
  speakerId: string
  sampleId: string
  filename: string
}

export interface SpeakerSampleDeletedData {
  speakerId: string
  sampleId: string
}

// ============================================================================
// Settings Events
// ============================================================================

export interface SettingsUpdatedData {
  key: string
  value: unknown // Settings values can be of various types
}

export interface SettingsResetData {
  // Empty - no data payload
}

// ============================================================================
// Pronunciation Events
// ============================================================================

// Local type for SSE event data (matches index.ts PronunciationRule)
interface PronunciationRule {
  id: string
  pattern: string
  replacement: string
  scope: 'engine' | 'project_engine'
  isRegex: boolean
  isActive: boolean
  priority: number
  engineType?: string
  projectId?: string
  language?: string
}

export interface PronunciationRuleCreatedData {
  rule: PronunciationRule
}

export interface PronunciationRuleUpdatedData {
  rule: PronunciationRule
}

export interface PronunciationRuleDeletedData {
  ruleId: string
}

export interface PronunciationRuleBulkChangeData {
  action: 'activate' | 'deactivate' | 'delete' | 'import'
  count: number
}

// ============================================================================
// TTS Job Events
// ============================================================================

export interface JobCreatedData {
  jobId: string
  jobType: 'chapter' | 'segment' | 'selection'
  chapterId: string
  segmentIds: string[]
  totalSegments: number
}

export interface JobStartedData {
  jobId: string
  chapterId: string
}

export interface JobProgressData {
  jobId: string
  chapterId: string
  processedSegments: number
  totalSegments: number
  progress: number // 0-100
  currentSegmentId?: string
}

export interface JobCompletedData {
  jobId: string
  chapterId: string
  processedSegments: number
  totalSegments: number
  duration: number
}

export interface JobFailedData {
  jobId: string
  chapterId: string
  error: string
  failedSegmentId?: string
}

interface JobCancellingData {
  jobId: string
  chapterId: string
}

export interface JobCancelledData {
  jobId: string
  chapterId: string
  processedSegments?: number
  totalSegments?: number
}

export interface JobResumedData {
  jobId: string
  chapterId: string
  status?: 'pending'
  totalSegments?: number
  processedSegments?: number
  segmentIds?: Array<{ id: string; jobStatus: string }>
  resumedAt?: string
}

// ============================================================================
// Segment Events
// ============================================================================

export interface SegmentCompletedData {
  segmentId: string
  chapterId: string
  jobId: string
  status: 'completed'
  audioPath: string
  duration: number
}

export interface SegmentFailedData {
  segmentId: string
  chapterId: string
  jobId: string
  status: 'failed'
  error: string
}

export interface SegmentUpdatedData {
  segmentId: string
  chapterId: string
  text?: string
  ttsSpeakerName?: string
  pauseDuration?: number
  isDivider?: boolean
}

export interface SegmentCreatedData {
  segmentId: string
  chapterId: string
  text?: string
  segmentType?: 'standard' | 'divider'
  orderIndex?: number
}

export interface SegmentDeletedData {
  segmentId: string
  chapterId: string
}

export interface SegmentReorderedData {
  chapterId: string
  segmentIds: string[]
}

export interface SegmentFrozenData {
  segmentId: string
  chapterId: string
  isFrozen: boolean
}

export interface SegmentStartedData {
  segmentId: string
  chapterId: string
  jobId?: string
  status?: 'processing'
}

// ============================================================================
// Chapter Events
// ============================================================================

export interface ChapterUpdatedData {
  chapterId: string
  projectId: string
  title?: string
}

// ============================================================================
// Project Events
// ============================================================================

export interface ProjectReorderedData {
  projectIds: string[]
}

// ============================================================================
// Export Job Events
// ============================================================================

interface ExportJobCreatedData {
  jobId: string
  chapterId: string
  format: 'mp3' | 'm4a' | 'wav'
}

export interface ExportJobStartedData {
  jobId: string
  chapterId: string
}

export interface ExportJobProgressData {
  jobId: string
  chapterId: string
  progress: number // 0-100
  currentSegment: number
  totalSegments: number
}

export interface ExportJobCompletedData {
  jobId: string
  chapterId: string
  outputPath: string
  duration: number
  fileSize: number
}

export interface ExportJobFailedData {
  jobId: string
  chapterId: string
  error: string
}

interface ExportJobCancelledData {
  jobId: string
  chapterId: string
}

// ============================================================================
// Import Events
// ============================================================================

export interface ImportStartedData {
  importId: string
  status: 'running'
  progress: number
  message: string
}

export interface ImportProgressData {
  importId: string
  projectId?: string
  status: 'running'
  progress: number
  message: string
  chapterCount?: number
  segmentCount?: number
}

export interface ImportCompletedData {
  importId: string
  projectId: string
  status: 'completed'
  progress: number
  message: string
  chapterCount: number
  segmentCount: number
}

export interface ImportFailedData {
  importId: string
  status: 'failed'
  message: string
  error: string
}

export interface ImportCancelledData {
  importId: string
  message?: string
}

// ============================================================================
// Quality Analysis Events (replaces old STT events)
// ============================================================================

export interface QualityJobCreatedData {
  jobId: string
  chapterId?: string
  segmentId?: string
  totalSegments: number
  jobType: 'segment' | 'chapter'
  segmentIds?: string[]
  // Display fields
  chapterTitle?: string
  projectTitle?: string
  sttEngine?: string
  audioEngine?: string
}

export interface QualityJobStartedData {
  jobId: string
  chapterId?: string
  totalSegments: number
  processedSegments?: number // For resumed jobs
  startedAt?: string
}

export interface QualityJobProgressData {
  jobId: string
  chapterId?: string
  processedSegments: number
  totalSegments: number
  progress: number // 0-100, matches backend field name
  currentSegmentId?: string
}

export interface QualityJobCompletedData {
  jobId: string
  chapterId?: string
  totalSegments: number
}

export interface QualityJobFailedData {
  jobId: string
  chapterId?: string
  error: string
  processedSegments: number
  totalSegments: number
}

export interface QualityJobCancelledData {
  jobId: string
  chapterId?: string
}

export interface QualityJobResumedData {
  jobId: string
  chapterId?: string
  resumedAt?: string
}

export interface QualitySegmentAnalyzedData {
  segmentId: string
  chapterId: string
  qualityScore: number
  qualityStatus: 'perfect' | 'warning' | 'defect'
  engineResults: QualityEngineResult[]
}

export interface QualitySegmentFailedData {
  segmentId: string
  chapterId: string
  error: string
}

// ============================================================================
// Engine Status Events
// ============================================================================

export interface EngineStartedData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  status: 'running'
  port: number
  version?: string  // Package version from health check
  variantId?: string  // Variant identifier for variant-aware frontends
}

export interface EngineModelLoadedData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  loadedModel: string  // Currently loaded model name
  variantId?: string  // Variant identifier for variant-aware frontends
}

export interface EngineStoppedData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  status: 'stopped'
  reason: 'manual' | 'inactivity' | 'error'
  variantId?: string  // Variant identifier for variant-aware frontends
}

export interface EngineEnabledData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  isEnabled: boolean
  variantId?: string  // Variant identifier for variant-aware frontends
}

interface EngineDisabledData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  isEnabled: boolean
  variantId?: string  // Variant identifier for variant-aware frontends
}

interface EngineStartingData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  variantId?: string  // Variant identifier for variant-aware frontends
}

interface EngineStoppingData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  reason?: string
  variantId?: string  // Variant identifier for variant-aware frontends
}

export interface EngineErrorData {
  engineType: 'tts' | 'text' | 'stt' | 'audio'
  engineName: string
  error: string
  details?: string
  variantId?: string  // Variant identifier for variant-aware frontends
}

// ============================================================================
// Docker Image Events
// ============================================================================

export interface DockerImageInstallingData {
  variantId: string
  imageName: string
  hostId: string
}

export interface DockerImageProgressData {
  variantId: string
  status: 'downloading' | 'extracting' | 'pulling'
  progressPercent: number
  currentLayer: string
  message: string
}

export interface DockerImageInstalledData {
  variantId: string
  imageName: string
  hostId: string
  isInstalled: boolean
}

interface DockerImageUninstallingData {
  variantId: string
  hostId: string
}

export interface DockerImageUninstalledData {
  variantId: string
  hostId: string
  isInstalled: boolean
}

export interface DockerImageErrorData {
  variantId: string
  error: string
  operation: 'install' | 'uninstall'
}

// ============================================================================
// Docker Host Events
// ============================================================================

export interface DockerHostConnectedData {
  hostId: string
  dockerVersion: string
  os: string
  isAvailable: boolean
  hasGpu: boolean
}

export interface DockerHostDisconnectedData {
  hostId: string
  reason: string
  isAvailable: boolean
}

export interface DockerHostConnectingData {
  hostId: string
  attempt: number
}

/**
 * Engine status update (periodic, every 15s)
 * Contains full status of all engines with countdown timers
 *
 * Note: This is a reduced status update for SSE events.
 * For full engine metadata, use EngineStatusInfo from engines.ts
 */
export interface EngineStatusData {
  engines: {
    tts: SSEEngineStatusUpdate[]
    text: SSEEngineStatusUpdate[]
    stt: SSEEngineStatusUpdate[]
    audio: SSEEngineStatusUpdate[]
  }
  hasTtsEngine: boolean
  hasTextEngine: boolean
  hasSttEngine: boolean
  hasAudioEngine: boolean
}

/**
 * Reduced engine status for SSE updates (sent every 15s)
 * Only contains status fields that change, not full metadata
 */
export interface SSEEngineStatusUpdate {
  variantId: string
  isEnabled: boolean
  isRunning: boolean
  status: 'running' | 'stopped' | 'disabled'
  secondsUntilAutoStop?: number
  port?: number
}
