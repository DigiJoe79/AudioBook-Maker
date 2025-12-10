// Core data types for the audiobook maker

// Export generic quality types
export * from './quality'

export interface Project {
  id: string
  title: string
  description?: string
  orderIndex: number
  createdAt: Date
  updatedAt: Date
  chapters: Chapter[]
}

export interface Chapter {
  id: string
  projectId: string
  title: string
  orderIndex: number
  segments: Segment[]
  createdAt: Date
  updatedAt: Date
}

export interface Segment {
  id: string
  chapterId: string
  text: string
  audioPath?: string | null // Can be undefined (not set) or null (from API)
  orderIndex: number
  startTime: number // in seconds
  endTime: number // in seconds
  ttsEngine: string // TTS engine used to generate this segment - REQUIRED
  ttsModelName: string // TTS model used to generate this segment - REQUIRED
  ttsSpeakerName: string | null // Speaker used to generate this segment (optional, matches DB NULL)
  language: string // Language used to generate this segment (for consistent regeneration) - REQUIRED
  segmentType: 'standard' | 'divider' // Type of segment (standard = text/audio, divider = pause only)
  pauseDuration: number // Pause duration in milliseconds (for divider segments)
  createdAt: Date
  updatedAt: Date
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed'
  isFrozen: boolean // Frozen segments are protected from regeneration and STT analysis
}

// Settings types
export interface Speaker {
  id: string;
  name: string;
  description?: string;
  gender?: 'male' | 'female' | 'neutral';
  languages: string[];
  tags: string[];
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  samples: SpeakerSample[];
}

export interface SpeakerSample {
  id: string;
  fileName: string;
  filePath: string;
  fileSize?: number;
  duration?: number;
  sampleRate?: number;
  transcript?: string;
  createdAt: Date;
}

export interface EngineParameterSchema {
  type: 'float' | 'int' | 'string' | 'boolean' | 'select';
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label: string;
  description: string;
  category: 'generation' | 'advanced' | 'limits';
  readonly?: boolean;
}

export interface AudioPlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  currentSegmentId?: string
}

/**
 * TTS Engine metadata from backend
 * Represents a TTS engine with its capabilities and constraints
 */
export interface TTSEngine {
  /** Unique engine identifier */
  name: string

  /** Human-readable display name */
  displayName: string

  /** List of supported ISO language codes (filtered by settings) */
  supportedLanguages: string[]

  /** All supported ISO language codes (unfiltered, for Settings UI) */
  allSupportedLanguages?: string[]

  /** Engine-specific generation constraints */
  constraints: {
    /** Minimum text length for generation */
    minTextLength: number

    /** Default maximum text length */
    maxTextLength: number

    /** Language-specific max text lengths (overrides default) */
    maxTextLengthByLang?: Record<string, number>

    /** Audio sample rate (e.g., 24000 Hz) */
    sampleRate: number

    /** Output audio format (e.g., 'wav') */
    audioFormat: string

    /** Whether engine supports streaming */
    supportsStreaming: boolean

    /** Whether engine requires proper punctuation */
    requiresPunctuation: boolean
  }

  /** Engine-specific default parameters */
  defaultParameters: Record<string, any>

  /** Whether the model is currently loaded in memory */
  modelLoaded: boolean

  /** Whether engine is enabled in settings */
  isEnabled: boolean

  /** Whether engine server is currently running */
  isRunning: boolean

  /** HTTP port if engine is running */
  port?: number

  /** Device being used (cpu/cuda) */
  device: 'cpu' | 'cuda'
}

/**
 * TTS Model metadata from backend
 * Represents a specific model for an engine
 */
export interface TTSModel {
  /** Model identifier */
  modelName: string

  /** Human-readable display name */
  displayName: string

  /** Full path to model directory */
  path: string

  /** Version string */
  version: string

  /** Model size in MB */
  sizeMb?: number
}

/**
 * TTS Job (Database-backed)
 * Represents a TTS generation job tracked in the database
 */
export interface TTSJob {
  /** Unique job identifier (UUID) */
  id: string

  /** Chapter being processed (context for UI navigation) */
  chapterId: string | null

  /** JSON string of segment objects with job_status */
  segmentIds?: string

  // Engine Configuration
  /** TTS engine identifier ) */
  ttsEngine: string

  /** TTS model name */
  ttsModelName: string

  /** Speaker/voice name */
  ttsSpeakerName: string

  /** Language code (e.g., 'de', 'en') */
  language: string

  /** Whether to regenerate already completed segments */
  forceRegenerate: boolean

  /** Chapter title (for display in JobsPanel) */
  chapterTitle?: string | null

  /** Project title (for display in JobsPanel) */
  projectTitle?: string | null

  // Progress Tracking
  /** Job status: 'pending', 'running', 'cancelling', 'cancelled', 'completed', 'failed' */
  status: 'pending' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'

  /** Total number of segments to process */
  totalSegments: number

  /** Number of segments successfully processed */
  processedSegments: number

  /** Number of segments that failed */
  failedSegments: number

  /** ID of segment currently being processed */
  currentSegmentId?: string | null

  // Error Handling
  /** Error details if job failed */
  errorMessage?: string | null

  /** Number of retry attempts */
  retryCount: number

  // Timestamps
  /** Job creation timestamp */
  createdAt: Date

  /** Job start timestamp */
  startedAt: Date | null

  /** Job completion timestamp */
  completedAt: Date | null

  /** Last update timestamp */
  updatedAt: Date
}

/**
 * TTS Jobs List Response
 * Response from /api/tts/jobs endpoints
 */
export interface TTSJobsListResponse {
  success: boolean
  jobs: TTSJob[]
  count: number
}

// ============================================================================
// Drag & Drop Types
// ============================================================================

/**
 * Command items that can be dragged into segment list
 */
export interface CommandItem {
  id: string
  type: 'text-segment' | 'divider'
  label: string
  icon: string
  description: string
}

// ============================================================================
// Pronunciation Rules Types
// ============================================================================

export interface PronunciationRule {
  id: string
  pattern: string
  replacement: string
  isRegex: boolean
  scope: 'project_engine' | 'engine'
  projectId?: string
  engineName: string
  language: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface PronunciationRuleCreate {
  pattern: string
  replacement: string
  isRegex?: boolean
  scope: 'project_engine' | 'engine'
  projectId?: string
  engineName: string
  language: string
  isActive?: boolean
}

export interface PronunciationRuleUpdate {
  pattern?: string
  replacement?: string
  isRegex?: boolean
  scope?: 'project_engine' | 'engine'
  projectId?: string
  engineName?: string
  language?: string
  isActive?: boolean
}

export interface PronunciationTestRequest {
  text: string
  rules: Array<{
    pattern: string
    replacement: string
    isRegex?: boolean
  }>
  maxLength?: number
}

export interface PronunciationTestResponse {
  originalText: string
  transformedText: string
  rulesApplied: string[]
  wouldExceedLimit: boolean
  chunksRequired: number
}

export interface PronunciationConflict {
  rule1: {
    id: string
    pattern: string
    scope: string
  }
  rule2: {
    id: string
    pattern: string
    scope: string
  }
  reason: string
}

export interface PronunciationBulkOperation {
  ruleIds: string[]
  action: 'move' | 'toggle' | 'delete'
  targetScope?: 'project_engine' | 'engine' | 'global'
  isActive?: boolean
}

// Import QualityStatus and QualityEngineResult from quality.ts (re-exported above)
import type { QualityStatus, QualityEngineResult } from './quality'

// Extended Segment type with quality indicators
export interface SegmentWithQuality extends Segment {
  qualityAnalyzed?: boolean
  qualityScore?: number
  qualityStatus?: QualityStatus
  engineResults?: QualityEngineResult[]
}

// ============================================================================
// Audio Playback Types (Chapter Waveform Player)
// ============================================================================

/**
 * Segment boundary for chapter waveform visualization
 * Represents time ranges for each segment in concatenated audio
 */
export interface SegmentBoundary {
  segmentId: string
  segmentType: 'standard' | 'divider'
  startTime: number // seconds
  endTime: number // seconds
  duration: number
  audioPath?: string
}

/**
 * Enhanced segment boundary for MSE player
 * Extends SegmentBoundary with loading and pause state
 */
export interface EnhancedSegmentBoundary extends SegmentBoundary {
  isPause: boolean          // Is this a pause segment?
  isAutomatic?: boolean     // Auto-pause (pauseBetweenSegments)?
  isLoaded: boolean         // Is audio in MSE buffer?
  isPending: boolean        // Waiting for previous segments?
}

/**
 * MSE stream state for MediaSource player
 */
export interface MediaSourceStreamState {
  isReady: boolean
  loadedUntilIndex: number
  pendingSegments: Set<number>
  totalDuration: number
  error: Error | string | null
  isLoading: boolean
}

/**
 * Waveform peaks for a segment
 */
export interface SegmentPeaks {
  segmentId: string
  peaks: Float32Array
  duration: number
  sampleRate: number
}

/**
 * Playback window for dynamic segment loading
 * Contains segment range currently loaded in player
 */
export interface PlaybackWindow {
  startSegmentIndex: number
  endSegmentIndex: number
  segments: Segment[]
  totalDuration: number
}

// Re-export backend types for convenience
export type { BackendProfile, ApiBackendProfile, SessionState, BackendHealthResponse } from './backend'

// Re-export navigation types for convenience
export type { ViewType, NavigationState, NavigationShortcut } from './navigation'
export { NAVIGATION_SHORTCUTS } from './navigation'

// Re-export import types for convenience
export type {
  MappingRules,
  ImportWarning,
  ChapterPreview,
  ImportStats,
  ImportPreviewResponse,
  ImportExecuteResponse,
  ImportConfig,
} from './import'
export { DEFAULT_MAPPING_RULES } from './import'

// Re-export engine types for convenience
export type {
  EngineType,
  EngineStatus,
  EngineStatusInfo,
  AllEnginesStatus,
  EngineAvailability,
} from './engines'

// Re-export transform function from api.ts (for BackendProfile)
export { transformBackendProfile } from './api'

// Re-export API response types from transforms (generated from OpenAPI)
export type {
  ApiSegment,
  ApiChapter,
  ApiChapterWithSegments,
  ApiProject,
  ApiProjectWithChapters,
  ApiTTSJob,
  ApiTTSJobsListResponse,
  ApiQualityJob,
  ApiQualityJobsListResponse,
  ApiSpeaker,
  ApiSpeakerSample,
  ApiPronunciationRule,
} from './transforms'

// Re-export transform functions
export {
  transformSegment,
  transformChapter,
  transformChapterWithSegments,
  transformProject,
  transformProjectWithChapters,
  transformSpeaker,
  transformSpeakerSample,
  transformTTSJob,
  transformQualityJob,
  transformPronunciationRule,
} from './transforms'
