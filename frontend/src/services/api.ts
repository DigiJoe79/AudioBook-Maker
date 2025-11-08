/**
 * API Service for Audiobook Maker Backend
 */

import type { TTSEngine, Project, Chapter, Segment } from '../types'
import { useAppStore } from '../store/appStore'

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
  defaultTtsEngine: string;
  defaultTtsModelName: string;
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
   * Import project from Markdown file
   *
   * Markdown structure:
   * - # Heading 1 → Project title
   * - ## Heading 2 → Ignored (Acts, etc.)
   * - ### Heading 3 → Chapter (numbering removed)
   * - *** → Divider segment
   * - Text → Automatically segmented with spaCy
   *
   * @param file Markdown file (.md or .markdown, max 10 MB)
   * @param ttsSettings TTS settings for all segments
   * @returns Created project with chapters and segments
   */
  importFromMarkdown: async (
    file: File,
    ttsSettings: {
      ttsEngine: string;
      ttsModelName: string;
      language: string;
      ttsSpeakerName?: string;
    }
  ): Promise<{
    success: boolean;
    project: Project;
    totalSegments: number;
    totalDividers: number;
    message: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tts_engine', ttsSettings.ttsEngine);
    // Use snake_case for FormData fields (FastAPI Form parameters don't use Pydantic conversion)
    formData.append('tts_model_name', ttsSettings.ttsModelName);
    formData.append('language', ttsSettings.language);
    if (ttsSettings.ttsSpeakerName) {
      formData.append('tts_speaker_name', ttsSettings.ttsSpeakerName);
    }

    const response = await fetch(`${getApiBaseUrl()}/projects/import-markdown`, {
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

// Chapter API
export const chapterApi = {
  getById: (id: string) => apiCall<ApiChapter>(`/chapters/${id}`),

  create: (data: {
    projectId: string
    title: string
    orderIndex: number
    defaultTtsEngine: string
    defaultTtsModelName: string
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

  // Segment text into natural segments
  segmentText: (
    chapterId: string,
    data: {
      text: string;
      method?: 'sentences' | 'paragraphs' | 'smart' | 'length';
      language?: string;
      ttsEngine?: string;
      ttsModelName?: string;
      ttsSpeakerName?: string;
      minLength?: number;
      maxLength?: number;
      autoCreate?: boolean;
    }
  ) =>
    apiCall<{
      success: boolean;
      message: string;
      segments: Segment[]; // Full segment objects when autoCreate=true
      preview?: Array<{ text: string; orderIndex: number }>; // Preview when autoCreate=false
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
};

// TTS API
export const ttsApi = {
  // Get available speakers from database (NOT from TTS engine)
  // Uses /api/speakers/ endpoint which is engine-independent
  getSpeakers: () =>
    apiCall<Array<{
      id: string;
      name: string;
      description?: string;
      gender?: string;
      languages: string[];
      tags: string[];
      isDefault: boolean;
      isActive: boolean;
      sampleCount: number;
      createdAt: string;
      updatedAt: string;
      samples: Array<{
        id: string;
        filePath: string;
        fileName: string;
        fileSize: number;
        duration?: number;
        sampleRate?: number;
        transcript?: string;
        createdAt: string;
      }>;
    }>>('/speakers/'),

  // Get available TTS engines
  getEngines: () =>
    apiCall<{
      success: boolean;
      engines: TTSEngine[];
    }>('/tts/engines'),

  // Get available models for a specific engine
  getEngineModels: (engineType: string) =>
    apiCall<{
      success: boolean;
      ttsEngine: string;
      models: Array<{
        ttsModelName: string;
        displayName: string;
        path: string;
        version: string;
        sizeMb?: number;
      }>;
      count: number;
    }>(`/tts/engines/${engineType}/models`),

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
    ttsSpeakerName: string;  
    language: string;  
    ttsEngine: string;  
    ttsModelName: string;  
    forceRegenerate?: boolean; 
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

  // Get chapter generation progress
  getChapterProgress: (chapterId: string) =>
    apiCall<{
      chapterId: string;
      status: string;
      progress: number;
      currentSegment: number;
      totalSegments: number;
      message: string;
      error?: string;
    }>(`/tts/generate-chapter/${chapterId}/progress`),

  // Cancel chapter generation (legacy - use cancelJob for job-based cancellation)
  cancelChapterGeneration: (chapterId: string) =>
    apiCall<{
      status: string;
      chapterId: string;
    }>(`/tts/generate-chapter/${chapterId}`, {
      method: 'DELETE',
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
    }>(`/tts/cancel-job/${jobId}`, {
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
    const endpoint = queryString ? `/tts/jobs?${queryString}` : '/tts/jobs'

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
    apiCall<import('../types').TTSJobsListResponse>('/tts/jobs/active'),

  /**
   * Get single TTS job by ID
   *
   * @param jobId - Unique job identifier (UUID)
   * @returns Promise with complete job details
   */
  getJob: (jobId: string) =>
    apiCall<import('../types').TTSJob>(`/tts/jobs/${jobId}`),

  /**
   * Delete a specific job by ID
   *
   * @param jobId - Unique job identifier (UUID)
   * @returns Promise with deletion confirmation
   */
  deleteJob: (jobId: string) =>
    apiCall<{ success: boolean; deleted: boolean; jobId: string }>(
      `/tts/jobs/${jobId}`,
      { method: 'DELETE' }
    ),

  /**
   * Clear all completed and failed jobs (bulk cleanup)
   *
   * @returns Promise with count of deleted jobs
   */
  clearJobHistory: () =>
    apiCall<{ success: boolean; deleted: number }>('/tts/jobs/cleanup', {
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
    apiCall<import('../types').TTSJob>(`/tts/jobs/${jobId}/resume`, {
      method: 'POST',
    }),

  /**
   * Set preferred engine/model for warm-keeping
   *
   * This preference is stored in RAM only (session-based).
   * After all jobs complete, the worker will activate this engine.
   *
   * @param ttsEngine - Engine identifier
   * @param ttsModelName - Model name 
   * @returns Promise with success message
   */
  setPreferredEngine: (ttsEngine: string, ttsModelName: string) =>
    apiCall<{ message: string }>('/tts/set-preferred-engine', {
      method: 'POST',
      body: JSON.stringify({ ttsEngine, ttsModelName }),
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
    }>('/segment-text', {
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
