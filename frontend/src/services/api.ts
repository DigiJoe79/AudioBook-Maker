
import type { TTSEngine, Project, Chapter, Segment } from '../types'
import { useAppStore } from '../store/appStore'

function getApiBaseUrl(): string {
  const url = useAppStore.getState().connection.url
  if (!url) {
    throw new Error('Backend not connected. Please connect on the start page.')
  }
  return `${url}/api`
}

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
  defaultEngine: string;
  defaultModelName: string;
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
  engine: string;
  modelName: string;
  speakerName: string | null;
  language: string;
  segmentType: 'standard' | 'divider';
  pauseDuration: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export type { Project, Chapter, Segment }

export interface TTSOptions {
  temperature?: number;
  lengthPenalty?: number;
  repetitionPenalty?: number;
  topK?: number;
  topP?: number;
  speed?: number;
}

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
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'))
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `API Error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    window.dispatchEvent(new CustomEvent('backend-connection-error'))
    throw error
  }
}

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

  reorder: (projectIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/projects/reorder', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    }),

  importFromMarkdown: async (
    file: File,
    ttsSettings: {
      engine: string;
      modelName: string;
      language: string;
      speakerName?: string;
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
    formData.append('engine', ttsSettings.engine);
    formData.append('model_name', ttsSettings.modelName);
    formData.append('language', ttsSettings.language);
    if (ttsSettings.speakerName) {
      formData.append('speaker_name', ttsSettings.speakerName);
    }

    const response = await fetch(`${getApiBaseUrl()}/projects/import-markdown`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 0 || response.status >= 500) {
        window.dispatchEvent(new CustomEvent('backend-connection-error'));
      }

      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `Import failed: ${response.status}`);
    }

    return response.json();
  },
};

export const chapterApi = {
  getById: (id: string) => apiCall<ApiChapter>(`/chapters/${id}`),

  create: (data: {
    projectId: string
    title: string
    orderIndex: number
    defaultEngine: string
    defaultModelName: string
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

  reorder: (projectId: string, chapterIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/chapters/reorder', {
      method: 'POST',
      body: JSON.stringify({ projectId, chapterIds }),
    }),

  move: (chapterId: string, newProjectId: string, newOrderIndex: number) =>
    apiCall<ApiChapter>(`/chapters/${chapterId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newProjectId, newOrderIndex }),
    }),

  segmentText: (
    chapterId: string,
    data: {
      text: string;
      method?: 'sentences' | 'paragraphs' | 'smart' | 'length';
      language?: string;
      engine?: string;
      modelName?: string;
      speakerName?: string;
      minLength?: number;
      maxLength?: number;
      autoCreate?: boolean;
    }
  ) =>
    apiCall<{
      success: boolean;
      message: string;
      segments: Segment[];
      preview?: Array<{ text: string; orderIndex: number }>;
      segmentCount: number;
      engine: string;
      constraints: Record<string, number>;
    }>(`/chapters/${chapterId}/segment`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const segmentApi = {
  getById: (id: string) => apiCall<ApiSegment>(`/segments/${id}`),

  create: (data: {
    chapterId: string;
    text: string;
    orderIndex: number;
    engine: string;
    modelName: string;
    speakerName?: string;
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
      engine?: string;
      modelName?: string;
      language?: string;
      speakerName?: string | null;
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

  reorder: (chapterId: string, segmentIds: string[]) =>
    apiCall<{ success: boolean; message: string }>('/segments/reorder', {
      method: 'POST',
      body: JSON.stringify({ chapterId, segmentIds }),
    }),

  move: (segmentId: string, newChapterId: string, newOrderIndex: number) =>
    apiCall<ApiSegment>(`/segments/${segmentId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ newChapterId, newOrderIndex }),
    }),
};

export const ttsApi = {
  initialize: () =>
    apiCall<{
      success: boolean;
      message: string;
      modelVersion: string;
      device: string;
    }>('/tts/initialize', {
      method: 'POST',
    }),

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

  getEngines: () =>
    apiCall<{
      success: boolean;
      engines: TTSEngine[];
    }>('/tts/engines'),

  getEngineModels: (engineType: string) =>
    apiCall<{
      success: boolean;
      engine: string;
      models: Array<{
        modelName: string;
        displayName: string;
        path: string;
        version: string;
        sizeMb?: number;
      }>;
      count: number;
    }>(`/tts/engines/${engineType}/models`),

  initializeEngine: (engineType: string, modelName?: string) =>
    apiCall<{
      success: boolean;
      engine: string;
      modelName: string;
      languages: string[];
      constraints: any;
    }>(`/tts/engines/${engineType}/initialize`, {
      method: 'POST',
      body: JSON.stringify({ modelName: modelName || 'v2.0.2' }),
    }),

  generateSegmentById: (segmentId: string) =>
    apiCall<{
      success: boolean;
      segment: ApiSegment;
      message: string;
    }>(`/tts/generate-segment/${segmentId}`, {
      method: 'POST',
    }),

  generateChapter: (data: {
    chapterId: string;
    speaker: string;
    language?: string;
    engine?: string;
    modelName?: string;
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

  cancelChapterGeneration: (chapterId: string) =>
    apiCall<{
      status: string;
      chapterId: string;
    }>(`/tts/generate-chapter/${chapterId}`, {
      method: 'DELETE',
    }),
};

export const textProcessingApi = {
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
  startExport: (data: ExportRequest) =>
    apiCall<ExportResponse>('/audio/export', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getExportProgress: (jobId: string) =>
    apiCall<ExportProgress>(`/audio/export/${jobId}/progress`),

  cancelExport: (jobId: string) =>
    apiCall<{ message: string }>(`/audio/export/${jobId}/cancel`, {
      method: 'DELETE',
    }),

  downloadExport: async (jobId: string, defaultFilename: string) => {
    const backendUrl = useAppStore.getState().connection.url;
    if (!backendUrl) {
      throw new Error('Backend not connected');
    }

    const { tauriAPI } = await import('./tauri-api');

    const savedPath = await tauriAPI.downloadExportedAudio(
      jobId,
      backendUrl,
      defaultFilename
    );

    return savedPath;
  },

  deleteExport: (jobId: string) =>
    apiCall<{ message: string }>(`/audio/export/${jobId}`, {
      method: 'DELETE',
    }),

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
