/**
 * API Response Types
 *
 * TypeScript interfaces that match the backend Pydantic response models.
 * These types represent the exact shape of data received from API endpoints
 * AFTER camelCase conversion (backend sends snake_case, Pydantic converts to camelCase).
 *
 * Data flow:
 *   Backend (snake_case) → Pydantic Response Model → JSON (camelCase) → Frontend (these types)
 */

import type { BackendProfile, ApiBackendProfile } from './backend'

// ============================================================================
// Transform Functions (ISO strings → Date objects)
// ============================================================================

/**
 * Transform API backend profile to typed backend profile
 * Converts ISO string dates to Date objects
 */
export function transformBackendProfile(api: ApiBackendProfile): BackendProfile {
  return {
    ...api,
    lastConnected: api.lastConnected ? new Date(api.lastConnected) : null,
    createdAt: new Date(api.createdAt),
  }
}

// ============================================================================
// Segment API Response Types
// ============================================================================

/**
 * API response for a single segment (matches SegmentResponse from backend)
 */
export interface ApiSegment {
  id: string
  chapterId: string
  text: string
  ttsEngine: string
  ttsModelName: string
  ttsSpeakerName: string | null
  language: string
  segmentType: 'standard' | 'divider'
  pauseDuration: number
  audioPath: string | null
  orderIndex: number
  startTime: number
  endTime: number
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed'
  isFrozen: boolean
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp

  // Quality analysis fields (optional)
  qualityAnalyzed?: boolean | null
  qualityScore?: number | null
  qualityStatus?: 'perfect' | 'warning' | 'defect' | null
  engineResults?: Array<{
    engineType: string
    engineName: string
    qualityScore: number
    qualityStatus: string
    details: Record<string, any>
  }> | null
}

// ============================================================================
// Chapter API Response Types
// ============================================================================

/**
 * API response for a single chapter (matches ChapterResponse from backend)
 */
export interface ApiChapter {
  id: string
  projectId: string
  title: string
  orderIndex: number
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

/**
 * API response for a chapter with segments (matches ChapterWithSegmentsResponse from backend)
 */
export interface ApiChapterWithSegments extends ApiChapter {
  segments: ApiSegment[]
}

// ============================================================================
// Project API Response Types
// ============================================================================

/**
 * API response for a single project (matches ProjectResponse from backend)
 */
export interface ApiProject {
  id: string
  title: string
  description?: string | null
  orderIndex: number
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

/**
 * API response for a project with chapters and segments (matches ProjectWithChaptersResponse from backend)
 */
export interface ApiProjectWithChapters extends ApiProject {
  chapters: ApiChapterWithSegments[]
}

// ============================================================================
// Shared Generic Types
// ============================================================================

/**
 * Generic API list response wrapper
 */
export interface ApiListResponse<T> {
  success: boolean
  items?: T[]
  count?: number
}

/**
 * Generic API message response
 */
export interface ApiMessageResponse {
  success: boolean
  message: string
}

// ============================================================================
// TTS Job API Response Types
// ============================================================================

/**
 * API response for a TTS job (dates as ISO strings from backend)
 */
export interface ApiTTSJob {
  id: string
  projectId?: string
  chapterId: string | null
  segmentIds?: string
  ttsEngine: string
  ttsModelName: string
  ttsSpeakerName: string
  language: string
  forceRegenerate: boolean
  chapterTitle?: string | null
  projectTitle?: string | null
  status: 'pending' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  totalSegments: number
  processedSegments: number
  failedSegments: number
  currentSegmentId?: string | null
  errorMessage?: string | null
  retryCount: number
  createdAt: string // ISO timestamp
  startedAt?: string | null // ISO timestamp
  completedAt?: string | null // ISO timestamp
  updatedAt: string // ISO timestamp
}

// ============================================================================
// Quality Job API Response Types
// ============================================================================

/**
 * API response for a quality job (dates as ISO strings from backend)
 */
export interface ApiQualityJob {
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
  segmentIds?: Array<{ id: string; jobStatus: 'pending' | 'analyzed' }>
  triggerSource?: string
  errorMessage?: string
  createdAt: string // ISO timestamp
  startedAt?: string // ISO timestamp
  completedAt?: string // ISO timestamp
  chapterTitle?: string
  projectTitle?: string
}

// ============================================================================
// Speaker API Response Types
// ============================================================================

/**
 * API response for a speaker sample (dates as ISO strings from backend)
 */
export interface ApiSpeakerSample {
  id: string
  speakerId?: string
  fileName: string
  filePath: string
  fileSize?: number
  duration?: number
  sampleRate?: number
  transcript?: string
  originalFileName?: string
  createdAt: string // ISO timestamp
}

/**
 * API response for a speaker (dates as ISO strings from backend)
 */
export interface ApiSpeaker {
  id: string
  name: string
  description?: string
  gender?: 'male' | 'female' | 'neutral'
  languages: string[]
  tags: string[]
  isActive: boolean
  isDefault: boolean
  sampleCount?: number
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
  samples: ApiSpeakerSample[]
}

// ============================================================================
// Pronunciation Rule API Response Types
// ============================================================================

/**
 * API response for a pronunciation rule (dates as ISO strings from backend)
 */
export interface ApiPronunciationRule {
  id: string
  scope: 'project_engine' | 'engine'
  scopeId?: string | null
  projectId?: string
  engineName: string
  language: string
  pattern: string
  replacement: string
  isRegex: boolean
  isActive: boolean
  priority?: number
  description?: string | null
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

// ============================================================================
// List Response Types (for API endpoints that return lists)
// ============================================================================

/**
 * API response for TTS jobs list
 */
export interface ApiTTSJobsListResponse {
  success: boolean
  jobs: ApiTTSJob[]
  count: number
}

/**
 * API response for Quality jobs list
 */
export interface ApiQualityJobsListResponse {
  success: boolean
  jobs: ApiQualityJob[]
  count: number
}
