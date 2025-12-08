/**
 * TypeScript Types for Markdown Import Feature
 *
 * These types match the backend Pydantic models (with automatic camelCase conversion).
 * Backend models are defined in backend/models/response_models.py
 */

/**
 * Configurable markdown parsing rules
 *
 * Defines which markdown syntax maps to project/chapter/divider elements.
 */
export interface MappingRules {
  /** Heading level for project title (default: "#") */
  projectHeading: string

  /** Heading level for chapters (default: "###") */
  chapterHeading: string

  /** Pattern for divider segments (default: "***") */
  dividerPattern: string
}

/**
 * Warning or error from import validation
 */
export interface ImportWarning {
  /** Warning type (e.g., 'too_long', 'empty', 'no_project_title') */
  type: string

  /** Human-readable warning message */
  message: string

  /** Severity level */
  severity: 'critical' | 'warning' | 'info'
}

/**
 * Preview of a chapter with statistics (segments not included for performance)
 */
export interface ChapterPreview {
  /** Temporary ID for frontend tracking */
  id: string

  /** Cleaned chapter title */
  title: string

  /** Raw title from markdown */
  originalTitle: string

  /** Position within project */
  orderIndex: number

  /** Chapter statistics */
  stats: {
    segmentCount: number
    totalChars: number
    dividerCount: number
    failedCount: number  // Number of oversized segments (sentences > max_length)
  }

  /** Warnings specific to this chapter */
  warnings: ImportWarning[]
}

/**
 * Overall import statistics
 */
export interface ImportStats {
  /** Total number of chapters */
  totalChapters: number

  /** Total number of segments across all chapters */
  totalSegments: number

  /** Total character count */
  totalChars: number

  /** Estimated duration (e.g., "~15min") */
  estimatedDuration?: string
}

/**
 * Complete preview response for import
 *
 * Returned by POST /api/projects/import/preview
 */
export interface ImportPreviewResponse {
  /** Whether import is valid (false if critical warnings exist) */
  isValid: boolean

  /** Project metadata */
  project: {
    title: string
    description?: string
  }

  /** List of chapters with segments */
  chapters: ChapterPreview[]

  /** Global warnings that apply to entire import */
  globalWarnings: ImportWarning[]

  /** Overall statistics */
  stats: ImportStats
}

/**
 * Configuration for final import
 *
 * Used when confirming the import after preview.
 */
export interface ImportConfig {
  /** Import mode */
  mode: 'new' | 'merge'

  /** Target project ID (only for merge mode) */
  mergeTargetId?: string

  /** Chapter selection and renaming */
  selectedChapters: Array<{
    originalTitle: string
    newTitle?: string
    include: boolean
  }>

  /** TTS settings for all segments */
  ttsSettings: {
    ttsEngine: string
    ttsModelName: string
    language: string
    ttsSpeakerName?: string
  }
}

/**
 * Response from import execution endpoint
 *
 * Returned by POST /api/projects/import
 */
export interface ImportExecuteResponse {
  /** Created or updated project with all chapters and segments */
  project: {
    id: string
    title: string
    description?: string
    orderIndex: number
    createdAt: string
    updatedAt: string
    chapters: Array<{
      id: string
      projectId: string
      title: string
      orderIndex: number
      createdAt: string
      updatedAt: string
      segments: Array<{
        id: string
        chapterId: string
        text: string
        audioPath: string | null
        orderIndex: number
        startTime: number
        endTime: number
        ttsEngine: string
        ttsModelName: string
        ttsSpeakerName: string | null
        language: string
        segmentType: 'standard' | 'divider'
        pauseDuration: number
        status: string
        isFrozen: boolean
        createdAt: string
        updatedAt: string
      }>
    }>
  }

  /** Number of chapters created/added */
  chaptersCreated: number

  /** Total number of segments created */
  segmentsCreated: number
}

/**
 * Default mapping rules
 */
export const DEFAULT_MAPPING_RULES: MappingRules = {
  projectHeading: '#',
  chapterHeading: '###',
  dividerPattern: '***',
}
