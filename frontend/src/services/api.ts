/**
 * API Service for Audiobook Maker Backend
 */

import type {
  Project,
  Chapter,
  Segment,
  PronunciationRule,
  PronunciationRuleCreate,
  PronunciationRuleUpdate,
  PronunciationTestRequest,
  PronunciationTestResponse,
  PronunciationConflict,
  PronunciationBulkOperation,
  MappingRules,
  ImportPreviewResponse,
  ImportExecuteResponse,
  ApiPronunciationRule,
  ApiSpeaker,
} from '@types'
import { useAppStore } from '@store/appStore'

/**
 * Get the current API base URL from the Zustand store
 *
 * This allows the backend URL to be dynamic based on the user's
 * selected profile instead of being hardcoded.
 */
function getApiBaseUrl(): string {
  const url = useAppStore.getState().connection.url
  if (!url) {
    throw new Error('Backend not connected. Please connect on the start page.')
  }
  return `${url}/api`
}

// API-specific types (for responses that differ from main types)
// These are the raw API response types before transformation
export interface ApiProject {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  chapters: ApiChapter[];
}

export interface ApiChapter {
  id: string;
  projectId: string;
  title: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  segments: ApiSegment[];
}

export interface ApiSegment {
  id: string;
  chapterId: string;
  text: string;
  audioPath: string | null;
  orderIndex: number;
  startTime: number;
  endTime: number;
  ttsEngine: string;
  ttsModelName: string;
  ttsSpeakerName: string | null;
  language: string;
  segmentType: 'standard' | 'divider';
  pauseDuration: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  isFrozen: boolean;
  createdAt: string;
  updatedAt: string;
}

// Export main types (already imported above)
export type { Project, Chapter, Segment }

export interface TTSOptions {
  temperature?: number;
  lengthPenalty?: number;
  repetitionPenalty?: number;
  topK?: number;
  topP?: number;
  speed?: number;
}

// Helper function for API calls
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Check if this is a connection error
      if (response.status === 0 || response.status >= 500) {
        // Notify connection monitor about potential backend offline
        window.dispatchEvent(new CustomEvent('backend-connection-error'))
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `API Error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    // Network error (fetch failed) - Backend likely offline or unreachable
    // This catches cases where fetch() throws (CORS, network failure, timeout, etc.)
    window.dispatchEvent(new CustomEvent('backend-connection-error'))
    throw error
  }
}

// Project API
export const projectApi = {
  getAll: () => apiCall<ApiProject[]>('/projects'),

  getById: (id: string) => apiCall<ApiProject>(`/projects/${id}`),

  create: (data: { title: string; description?: string }) =>
    apiCall<ApiProject>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { title?: string; description?: string }) =>
    apiCall<ApiProject>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiCall<{ success: boolean; message: string }>(`/projects/${id}`, {
      method: 'DELETE',
    }),

  // Reorder projects
  reorder: (projectIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/projects/reorder', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    }),

  /**
   * Preview Markdown import before creating project
   *
   * Returns a structured preview of how the markdown file will be parsed
   * into projects, chapters, and segments. Allows users to review and
   * adjust before committing to the import.
   *
   * @param file Markdown file (.md or .markdown, max 10 MB)
   * @param mappingRules Custom parsing rules (optional)
   * @param language Language code for text segmentation (default: "en")
   * @returns Preview with parsed structure, warnings, and statistics
   */
  previewMarkdownImport: async (
    file: File,
    mappingRules?: MappingRules,
    language: string = 'en'
  ): Promise<ImportPreviewResponse> => {
    const formData = new FormData();
    formData.append('file', file);

    // Add mapping rules as JSON string (if provided)
    if (mappingRules) {
      // Backend expects snake_case field names in FormData
      const snakeCaseRules = {
        project_heading: mappingRules.projectHeading,
        chapter_heading: mappingRules.chapterHeading,
        divider_pattern: mappingRules.dividerPattern,
      };
      formData.append('mapping_rules', JSON.stringify(snakeCaseRules));
    }

    // Add language
    formData.append('language', language);

    const response = await fetch(`${getApiBaseUrl()}/projects/import/preview`, {
      method: 'POST',
      body: formData, // multipart/form-data (no Content-Type header!)
    });

    if (!response.ok) {
      // Check if this is a connection error
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'));
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `Import preview failed: ${response.status}`);
    }

    return response.json();
  },
  /**
   * Preview EPUB import before creating project
   *
   * This mirrors previewMarkdownImport but uses the EPUB endpoint.
   * The backend converts EPUB to markdown internally before parsing.
   */
  previewEpubImport: async (
    file: File,
    mappingRules?: MappingRules,
    language: string = 'en'
  ): Promise<ImportPreviewResponse> => {
    const formData = new FormData()
    formData.append('file', file)

    // Add mapping rules as JSON string (if provided)
    if (mappingRules) {
      // Backend expects snake_case field names in FormData
      const snakeCaseRules = {
        project_heading: mappingRules.projectHeading,
        chapter_heading: mappingRules.chapterHeading,
        divider_pattern: mappingRules.dividerPattern,
      }
      formData.append('mapping_rules', JSON.stringify(snakeCaseRules))
    }

    // Add language
    formData.append('language', language)

    const response = await fetch(`${getApiBaseUrl()}/projects/import/epub/preview`, {
      method: 'POST',
      body: formData, // multipart/form-data (no Content-Type header)
    })

    if (!response.ok) {
      // Connection errors etc
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'))
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `EPUB import preview failed: ${response.status}`)
    }

    return response.json()
  },
  
  /**
   * Execute Markdown import (create or merge project)
   *
   * Creates a new project or merges chapters into existing project based on mode.
   * Applies chapter selection, renaming, and TTS settings to all segments.
   *
   * @param file Markdown file (.md or .markdown, max 10 MB)
   * @param mappingRules Custom parsing rules
   * @param language Language code for text segmentation (default: "en")
   * @param mode Import mode ('new' or 'merge')
   * @param mergeTargetId Target project ID (only for merge mode)
   * @param selectedChapters Array of chapter IDs to import
   * @param renamedChapters Mapping of chapter ID to new title
   * @param ttsSettings TTS settings for all segments
   * @returns Created/updated project with statistics
   */
  executeMarkdownImport: async (
    file: File,
    mappingRules: MappingRules,
    language: string,
    mode: 'new' | 'merge',
    mergeTargetId: string | null,
    selectedChapters: string[],
    renamedChapters: Record<string, string>,
    ttsSettings: {
      ttsEngine: string
      ttsModelName: string
      language: string
      ttsSpeakerName?: string
    }
  ): Promise<ImportExecuteResponse> => {
    const formData = new FormData();
    formData.append('file', file);

    // Add mapping rules as JSON string
    // Backend expects snake_case field names in FormData
    const snakeCaseRules = {
      project_heading: mappingRules.projectHeading,
      chapter_heading: mappingRules.chapterHeading,
      divider_pattern: mappingRules.dividerPattern,
    };
    formData.append('mapping_rules', JSON.stringify(snakeCaseRules));

    // Add language
    formData.append('language', language);

    // Add mode
    formData.append('mode', mode);

    // Add merge target ID (only if merge mode)
    if (mode === 'merge' && mergeTargetId) {
      formData.append('merge_target_id', mergeTargetId);
    }

    // Add selected chapters as JSON array
    formData.append('selected_chapters', JSON.stringify(selectedChapters));

    // Add renamed chapters as JSON object
    formData.append('renamed_chapters', JSON.stringify(renamedChapters));

    // Add TTS settings (use snake_case for FormData)
    formData.append('tts_engine', ttsSettings.ttsEngine);
    formData.append('tts_model_name', ttsSettings.ttsModelName);
    formData.append('tts_language', ttsSettings.language);
    if (ttsSettings.ttsSpeakerName) {
      formData.append('tts_speaker_name', ttsSettings.ttsSpeakerName);
    }

    const response = await fetch(`${getApiBaseUrl()}/projects/import`, {
      method: 'POST',
      body: formData, // multipart/form-data (no Content-Type header!)
    });

    if (!response.ok) {
      // Check if this is a connection error
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'));
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `Import failed: ${response.status}`);
    }

    return response.json();
  },
};

  /**
   * Execute EPUB import (create or merge project)
   *
   * Same semantics as executeMarkdownImport, but the backend starts from an EPUB
   * file instead of raw markdown.
   */
  executeEpubImport: async (
    file: File,
    mappingRules: MappingRules,
    language: string,
    mode: 'new' | 'merge',
    mergeTargetId: string | null,
    selectedChapters: string[],
    renamedChapters: Record<string, string>,
    ttsSettings: {
      ttsEngine: string
      ttsModelName: string
      language: string
      ttsSpeakerName?: string
    }
  ): Promise<ImportExecuteResponse> => {
    const formData = new FormData()
    formData.append('file', file)

    // Add mapping rules as JSON string (snake_case for backend)
    const snakeCaseRules = {
      project_heading: mappingRules.projectHeading,
      chapter_heading: mappingRules.chapterHeading,
      divider_pattern: mappingRules.dividerPattern,
    }
    formData.append('mapping_rules', JSON.stringify(snakeCaseRules))

    // Add language
    formData.append('language', language)

    // Add mode
    formData.append('mode', mode)

    // Add merge target ID (only if merge mode)
    if (mode === 'merge' && mergeTargetId) {
      formData.append('merge_target_id', mergeTargetId)
    }

    // Add selected chapters as JSON array
    formData.append('selected_chapters', JSON.stringify(selectedChapters))

    // Add renamed chapters as JSON object
    formData.append('renamed_chapters', JSON.stringify(renamedChapters))

    // Add TTS settings (snake_case)
    formData.append('tts_engine', ttsSettings.ttsEngine)
    formData.append('tts_model_name', ttsSettings.ttsModelName)
    formData.append('tts_language', ttsSettings.language)
    if (ttsSettings.ttsSpeakerName) {
      formData.append('tts_speaker_name', ttsSettings.ttsSpeakerName)
    }

    const response = await fetch(`${getApiBaseUrl()}/projects/import/epub`, {
      method: 'POST',
      body: formData, // multipart/form-data (no Content-Type header)
    })

    if (!response.ok) {
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'))
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `EPUB import failed: ${response.status}`)
    }

    return response.json()
  },

// Chapter API
export const chapterApi = {
  getById: (id: string) => apiCall<ApiChapter>(`/chapters/${id}`),

  create: (data: {
    projectId: string
    title: string
    orderIndex: number
  }) =>
    apiCall<ApiChapter>('/chapters', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { title?: string; orderIndex?: number }) =>
    apiCall<ApiChapter>(`/chapters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiCall<{ success: boolean; message: string }>(`/chapters/${id}`, {
      method: 'DELETE',
    }),

  // Reorder chapters within project
  reorder: (projectId: string, chapterIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/chapters/reorder', {
      method: 'POST',
      body: JSON.stringify({ projectId, chapterIds }),
    }),

  // Move chapter to different project
  move: (chapterId: string, newProjectId: string, newOrderIndex: number) =>
    apiCall<ApiChapter>(`/chapters/${chapterId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newProjectId, newOrderIndex }),
    }),

  // Segment text into natural segments (always uses sentence-based segmentation)
  segmentText: (
    chapterId: string,
    data: {
      text: string;
      // Note: Always uses sentence-based segmentation
      language?: string;  // SpaCy language for segmentation
      ttsEngine?: string;
      ttsModelName?: string;
      ttsLanguage?: string;  // TTS language (optional, defaults to segmentation language)
      ttsSpeakerName?: string;
      minLength?: number;
      maxLength?: number;
    }
  ) =>
    apiCall<{
      success: boolean;
      message: string;
      segments: Segment[];
      segmentCount: number;
      ttsEngine: string;
      constraints: Record<string, number>;
    }>(`/chapters/${chapterId}/segment`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Segment API
export const segmentApi = {
  getById: (id: string) => apiCall<ApiSegment>(`/segments/${id}`),

  create: (data: {
    chapterId: string;
    text: string;
    orderIndex: number;
    ttsEngine: string;
    ttsModelName: string;
    ttsSpeakerName?: string;
    language: string;
    segmentType?: 'standard' | 'divider';
    pauseDuration?: number;
    audioPath?: string;
    startTime?: number;
    endTime?: number;
    status?: string;
  }) =>
    apiCall<ApiSegment>('/segments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: {
      text?: string;
      audioPath?: string;
      startTime?: number;
      endTime?: number;
      status?: string;
      pauseDuration?: number;
      ttsEngine?: string;
      ttsModelName?: string;
      language?: string;
      ttsSpeakerName?: string | null;
    }
  ) =>
    apiCall<ApiSegment>(`/segments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiCall<{ success: boolean; message: string }>(`/segments/${id}`, {
      method: 'DELETE',
    }),

  // Reorder segments within chapter
  reorder: (chapterId: string, segmentIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/segments/reorder', {
      method: 'POST',
      body: JSON.stringify({ chapterId, segmentIds }),
    }),

  // Move segment to different chapter
  move: (segmentId: string, newChapterId: string, newOrderIndex: number) =>
    apiCall<ApiSegment>(`/segments/${segmentId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newChapterId, newOrderIndex }),
    }),

  // Freeze/unfreeze segment (protect from regeneration)
  freeze: (segmentId: string, freeze: boolean) =>
    apiCall<ApiSegment>(`/segments/${segmentId}/freeze`, {
      method: 'PATCH',
      body: JSON.stringify({ freeze }),
    }),
};

// TTS API
export const ttsApi = {
  // Get available speakers from database (NOT from TTS engine)
  // Uses /api/speakers/ endpoint which is engine-independent
  getSpeakers: () =>
    apiCall<Array<ApiSpeaker>>('/speakers/'),

  // REMOVED: getEngines() - Use engineApi.getAllStatus() instead
  // The unified /api/engines/status endpoint provides all engine information
  // across all types (TTS, STT, Text, Audio).
  //
  // REMOVED: getEngineModels(engineType) - Use engineApi.getAllStatus() instead
  // Model information is included in the engine status response via availableModels field.

  // Enable or disable an engine
  setEngineEnabled: (engineType: string, engineName: string, enabled: boolean) =>
    apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/${engineName}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
    }),

  // Regenerate audio for segment (uses stored segment parameters + settings)
  generateSegmentById: (segmentId: string) =>
    apiCall<{
      success: boolean;
      segment: ApiSegment;
      message: string;
    }>(`/tts/generate-segment/${segmentId}`, {
      method: 'POST',
    }),

  // Generate audio for entire chapter
  generateChapter: (data: {
    chapterId: string;
    forceRegenerate?: boolean;
    overrideSegmentSettings?: boolean;
    // TTS parameters (only used when overrideSegmentSettings=true)
    ttsSpeakerName?: string;
    language?: string;
    ttsEngine?: string;
    ttsModelName?: string;
    options?: TTSOptions;
  }) =>
    apiCall<{
      status: string;
      chapterId: string;
      message?: string;
    }>('/tts/generate-chapter', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Cancel a specific TTS job
   *
   * @param jobId - Unique job identifier (UUID)
   * @returns Promise with cancellation confirmation
   */
  cancelJob: (jobId: string) =>
    apiCall<{
      success: boolean;
      jobId: string;
      status: string;
    }>(`/jobs/tts/${jobId}/cancel`, {
      method: 'POST',
    }),

  // ============================================================================
  // TTS Job Management (Database-backed)
  // ============================================================================

  /**
   * List TTS jobs with optional filters
   *
   * @param filters - Optional filters (status, chapterId)
   * @returns Promise with jobs list and count
   */
  listJobs: (filters?: {
    status?: string;
    chapterId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.chapterId) params.append('chapterId', filters.chapterId)
    if (filters?.limit !== undefined) params.append('limit', filters.limit.toString())
    if (filters?.offset !== undefined) params.append('offset', filters.offset.toString())

    const queryString = params.toString()
    const endpoint = queryString ? `/jobs/tts?${queryString}` : '/jobs/tts'

    return apiCall<import('../types').TTSJobsListResponse>(endpoint)
  },

  /**
   * Get all active TTS jobs (pending + running)
   *
   * Optimized for real-time monitoring. Auto-polls this endpoint
   * to keep UI updated during generation.
   *
   * @returns Promise with active jobs list
   */
  listActiveJobs: () =>
    apiCall<import('../types').TTSJobsListResponse>('/jobs/tts/active'),

  /**
   * Get single TTS job by ID
   *
   * @param jobId - Unique job identifier (UUID)
   * @returns Promise with complete job details
   */
  getJob: (jobId: string) =>
    apiCall<import('../types').TTSJob>(`/jobs/tts/${jobId}`),

  /**
   * Delete a specific job by ID
   *
   * @param jobId - Unique job identifier (UUID)
   * @returns Promise with deletion confirmation
   */
  deleteJob: (jobId: string) =>
    apiCall<{ success: boolean; deleted: boolean; jobId: string }>(
      `/jobs/tts/${jobId}`,
      { method: 'DELETE' }
    ),

  /**
   * Clear all completed and failed jobs (bulk cleanup)
   *
   * @returns Promise with count of deleted jobs
   */
  clearJobHistory: () =>
    apiCall<{ success: boolean; deleted: number }>('/jobs/tts/cleanup', {
      method: 'DELETE',
    }),

  /**
   * Resume a cancelled job
   *
   * Creates a new job for remaining unprocessed segments.
   *
   * @param jobId - UUID of the cancelled job to resume
   * @returns Promise with the newly created job
   */
  resumeJob: (jobId: string) =>
    apiCall<import('../types').TTSJob>(`/jobs/tts/${jobId}/resume`, {
      method: 'POST',
    }),
};

// Text Processing API
export const textProcessingApi = {
  // Segment text without creating database entries
  segmentText: (data: {
    text: string;
    method?: 'sentences' | 'paragraphs' | 'smart' | 'length';
    language?: string;
    minLength?: number;
    maxLength?: number;
  }) =>
    apiCall<{
      success: boolean;
      method: string;
      language: string;
      segmentCount: number;
      segments: Array<{ text: string; orderIndex: number }>;
    }>('/text/segment', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Export API (camelCase to match backend)
export interface ExportRequest {
  chapterId: string;
  outputFormat: 'mp3' | 'm4a' | 'wav';
  quality?: 'low' | 'medium' | 'high';
  bitrate?: string;
  sampleRate?: number;
  pauseBetweenSegments?: number;
  customFilename?: string;
}

export interface ExportResponse {
  jobId: string;
  status: string;
  message: string;
}

export interface ExportProgress {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  currentSegment: number;
  totalSegments: number;
  message: string;
  outputPath?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
}

export const exportApi = {
  // Start audio export
  startExport: (data: ExportRequest) =>
    apiCall<ExportResponse>('/audio/export', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Get export progress
  getExportProgress: (jobId: string) =>
    apiCall<ExportProgress>(`/audio/export/${jobId}/progress`),

  // Cancel export job
  cancelExport: (jobId: string) =>
    apiCall<{ message: string }>(`/audio/export/${jobId}/cancel`, {
      method: 'DELETE',
    }),

  // Download exported file using native Tauri dialog
  downloadExport: async (jobId: string, defaultFilename: string) => {
    const backendUrl = useAppStore.getState().connection.url;
    if (!backendUrl) {
      throw new Error('Backend not connected');
    }

    // Import dynamically to avoid issues in non-Tauri environments
    const { tauriAPI } = await import('./tauri-api');

    // Use native Tauri download with file dialog
    const savedPath = await tauriAPI.downloadExportedAudio(
      jobId,
      backendUrl,
      defaultFilename
    );

    return savedPath;
  },

  // Delete export file (cleanup after download or cancel)
  deleteExport: (jobId: string) =>
    apiCall<{ message: string }>(`/audio/export/${jobId}`, {
      method: 'DELETE',
    }),

  // Quick merge for preview
  mergeSegments: (chapterId: string, pauseMs: number = 500) =>
    apiCall<{
      success: boolean;
      audioPath: string;
      duration: number;
    }>('/audio/merge', {
      method: 'POST',
      body: JSON.stringify({ chapterId, pauseMs }),
    }),
};

// ============================================================================
// Pronunciation API
// ============================================================================

export const pronunciationApi = {
  // Create a new rule
  createRule: async (rule: PronunciationRuleCreate): Promise<ApiPronunciationRule> => {
    const response = await apiCall<ApiPronunciationRule>('/pronunciation/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    });
    return response;
  },

  // Get rules filtered by criteria
  getRules: async (params?: {
    engine?: string;
    language?: string;
    projectId?: string;
    scope?: string;
  }): Promise<{ rules: ApiPronunciationRule[]; total: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.engine) queryParams.append('engine', params.engine);
    if (params?.language) queryParams.append('language', params.language);
    if (params?.projectId) queryParams.append('project_id', params.projectId);
    if (params?.scope) queryParams.append('scope', params.scope);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/pronunciation/rules?${queryString}` : '/pronunciation/rules';

    return apiCall<{ rules: ApiPronunciationRule[]; total: number }>(endpoint);
  },

  // Get rules for specific context (ordered by priority)
  getRulesForContext: async (
    engineName: string,
    language: string,
    projectId?: string
  ): Promise<{ rules: ApiPronunciationRule[]; total: number }> => {
    const queryParams = new URLSearchParams();
    queryParams.append('engine', engineName);
    queryParams.append('language', language);
    if (projectId) queryParams.append('projectId', projectId);

    return apiCall<{ rules: ApiPronunciationRule[]; total: number }>(
      `/pronunciation/rules?${queryParams.toString()}`
    );
  },

  // Update a rule
  updateRule: async (
    ruleId: string,
    update: PronunciationRuleUpdate
  ): Promise<ApiPronunciationRule> => {
    return apiCall<ApiPronunciationRule>(`/pronunciation/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(update),
    });
  },

  // Delete a rule
  deleteRule: async (ruleId: string): Promise<{ message: string }> => {
    return apiCall<{ message: string }>(`/pronunciation/rules/${ruleId}`, {
      method: 'DELETE',
    });
  },

  // Test rules on sample text
  testRules: async (request: PronunciationTestRequest): Promise<PronunciationTestResponse> => {
    return apiCall<PronunciationTestResponse>('/pronunciation/rules/test', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // Detect conflicting rules
  getConflicts: async (
    engineName: string,
    language: string
  ): Promise<{ conflicts: PronunciationConflict[]; total: number }> => {
    const queryParams = new URLSearchParams();
    queryParams.append('engine', engineName);
    queryParams.append('language', language);

    return apiCall<{ conflicts: PronunciationConflict[]; total: number }>(
      `/pronunciation/rules/conflicts?${queryParams.toString()}`
    );
  },

  // Bulk operations
  bulkOperation: async (
    operation: PronunciationBulkOperation
  ): Promise<{ message: string; modified: number }> => {
    return apiCall<{ message: string; modified: number }>('/pronunciation/rules/bulk', {
      method: 'POST',
      body: JSON.stringify(operation),
    });
  },

  // Toggle rule active state
  toggleRule: async (ruleId: string, isActive: boolean): Promise<ApiPronunciationRule> => {
    return pronunciationApi.updateRule(ruleId, { isActive });
  },

  // Copy rule to different scope
  copyRule: async (
    ruleId: string,
    targetScope: 'project_engine' | 'engine',
    targetProjectId?: string
  ): Promise<ApiPronunciationRule> => {
    const rule = await apiCall<ApiPronunciationRule>(`/pronunciation/rules/${ruleId}`);
    const newRule: PronunciationRuleCreate = {
      pattern: rule.pattern,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      scope: targetScope,
      projectId: targetProjectId,
      engineName: rule.engineName,
      language: rule.language,
      isActive: rule.isActive,
    };
    return pronunciationApi.createRule(newRule);
  },

  // Export rules to JSON
  exportRules: async (params?: {
    ruleIds?: string[];
    engine?: string;
    language?: string;
  }): Promise<ApiPronunciationRule[]> => {
    const queryParams = new URLSearchParams();
    if (params?.ruleIds) {
      params.ruleIds.forEach((id) => queryParams.append('rule_ids', id));
    }
    if (params?.engine) queryParams.append('engine', params.engine);
    if (params?.language) queryParams.append('language', params.language);

    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/pronunciation/rules/export?${queryString}`
      : '/pronunciation/rules/export';

    return apiCall<ApiPronunciationRule[]>(endpoint);
  },

  // Import rules from JSON
  importRules: async (
    rules: PronunciationRule[],
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ imported: number; skipped: number }> => {
    return apiCall<{ imported: number; skipped: number }>(
      '/pronunciation/rules/import',
      {
        method: 'POST',
        body: JSON.stringify({ rules, mode }),
      }
    );
  },
};

// ==================== Quality API ====================

export const qualityApi = {
  /**
   * Analyze a single segment with quality engines.
   */
  analyzeSegment: async (
    segmentId: string,
    sttEngine?: string,
    sttModelName?: string,
    audioEngine?: string
  ) => {
    const params = new URLSearchParams()
    if (sttEngine) params.append('sttEngine', sttEngine)
    if (sttModelName) params.append('sttModelName', sttModelName)
    if (audioEngine) params.append('audioEngine', audioEngine)

    const queryString = params.toString()
    const url = `/quality/analyze/segment/${segmentId}${queryString ? `?${queryString}` : ''}`
    return apiCall<{
      jobId: string
      message: string
      status: string
    }>(url, { method: 'POST' })
  },

  /**
   * Analyze all segments in a chapter.
   */
  analyzeChapter: async (
    chapterId: string,
    sttEngine?: string,
    sttModelName?: string,
    audioEngine?: string
  ) => {
    const params = new URLSearchParams()
    if (sttEngine) params.append('sttEngine', sttEngine)
    if (sttModelName) params.append('sttModelName', sttModelName)
    if (audioEngine) params.append('audioEngine', audioEngine)

    const queryString = params.toString()
    const url = `/quality/analyze/chapter/${chapterId}${queryString ? `?${queryString}` : ''}`
    return apiCall<{
      jobId: string
      message: string
      status: string
    }>(url, { method: 'POST' })
  },

  /**
   * Get quality jobs with optional filters.
   */
  getJobs: async (filters?: {
    status?: string
    chapterId?: string
    limit?: number
    offset?: number
  }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.chapterId) params.append('chapterId', filters.chapterId)
    if (filters?.limit) params.append('limit', String(filters.limit))
    if (filters?.offset) params.append('offset', String(filters.offset))

    const queryString = params.toString()
    const url = `/jobs/quality${queryString ? `?${queryString}` : ''}`
    return apiCall<{
      jobs: import('@types').QualityJob[]
      total: number
    }>(url)
  },

  /**
   * Get active quality jobs.
   */
  getActiveJobs: async () => {
    return apiCall<{
      jobs: import('@types').QualityJob[]
      total: number
    }>('/jobs/quality/active')
  },

  /**
   * Get a specific quality job.
   */
  getJob: async (jobId: string) => {
    return apiCall<import('@types').QualityJob>(`/jobs/quality/${jobId}`)
  },

  /**
   * Cancel a quality job.
   */
  cancelJob: async (jobId: string) => {
    return apiCall<{
      success: boolean
      message: string
    }>(`/jobs/quality/${jobId}/cancel`, {
      method: 'POST',
    })
  },

  /**
   * Delete a quality job.
   */
  deleteJob: async (jobId: string) => {
    return apiCall<{
      success: boolean
      message: string
    }>(`/jobs/quality/${jobId}`, {
      method: 'DELETE',
    })
  },

  /**
   * Resume a cancelled quality job.
   */
  resumeJob: async (jobId: string) => {
    return apiCall<import('@types').QualityJob>(`/jobs/quality/${jobId}/resume`, {
      method: 'POST',
    })
  },

  /**
   * Cleanup completed/failed quality jobs (clear history).
   */
  clearJobHistory: async () => {
    return apiCall<{
      success: boolean
      deleted: number
    }>('/jobs/quality/cleanup', {
      method: 'DELETE',
    })
  },
}

// Engine Management API
export const engineApi = {
  // Get status of all engines grouped by type
  getAllStatus: async () => {
    return apiCall<import('@/types/engines').AllEnginesStatus>('/engines/status');
  },

  // Enable an engine
  enableEngine: async (engineType: string, engineName: string) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/${engineName}/enable`, {
      method: 'POST',
    });
  },

  // Disable an engine
  disableEngine: async (engineType: string, engineName: string) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/${engineName}/disable`, {
      method: 'POST',
    });
  },

  // Start an engine
  startEngine: async (engineType: string, engineName: string, modelName?: string) => {
    return apiCall<{
      success: boolean;
      message: string;
      port?: number;
    }>(`/engines/${engineType}/${engineName}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: modelName ? JSON.stringify({ modelName }) : undefined,
    });
  },

  // Stop an engine
  stopEngine: async (engineType: string, engineName: string) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/${engineName}/stop`, {
      method: 'POST',
    });
  },

  // Set default engine for a type
  setDefaultEngine: async (engineType: string, engineName: string) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/default/${engineName}`, {
      method: 'POST',
    });
  },

  // Clear default engine for a type (set to none)
  clearDefaultEngine: async (engineType: string) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/default`, {
      method: 'DELETE',
    });
  },

  // Set keep-running flag for an engine
  setKeepRunning: async (engineType: string, engineName: string, keepRunning: boolean) => {
    return apiCall<{
      success: boolean;
      message: string;
    }>(`/engines/${engineType}/${engineName}/keep-running`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepRunning }),
    });
  },
};
