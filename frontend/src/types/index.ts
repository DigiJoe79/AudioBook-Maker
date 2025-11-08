// Core data types for the audiobook maker

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
  defaultTtsEngine: string
  defaultTtsModelName: string
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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface EngineParameterSchema {
  type: 'float' | 'int' | 'string' | 'boolean' | 'select';
  default: any;
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

  /** List of supported ISO language codes */
  supportedLanguages: string[]

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
  /** Job creation timestamp (ISO 8601) */
  createdAt: string

  /** Job start timestamp (ISO 8601) */
  startedAt?: string | null

  /** Job completion timestamp (ISO 8601) */
  completedAt?: string | null

  /** Last update timestamp (ISO 8601) */
  updatedAt: string
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
