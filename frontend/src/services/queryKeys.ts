/**
 * Query Keys Factory
 *
 * Centralized query key management for React Query.
 * This ensures consistent key structure and enables type-safe invalidation.
 *
 * Pattern: https://tkdodo.eu/blog/effective-react-query-keys
 */

export const queryKeys = {
  // Projects
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.projects.lists(), filters] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },

  // Chapters
  chapters: {
    all: ['chapters'] as const,
    lists: () => [...queryKeys.chapters.all, 'list'] as const,
    list: (projectId?: string) =>
      [...queryKeys.chapters.lists(), { projectId }] as const,
    details: () => [...queryKeys.chapters.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.chapters.details(), id] as const,
  },

  // Segments
  segments: {
    all: ['segments'] as const,
    lists: () => [...queryKeys.segments.all, 'list'] as const,
    list: (chapterId?: string) =>
      [...queryKeys.segments.lists(), { chapterId }] as const,
    details: () => [...queryKeys.segments.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.segments.details(), id] as const,
  },

  // TTS
  tts: {
    all: ['tts'] as const,
    // Note: engines() and models() removed - use queryKeys.engines.all() instead
    speakers: () => [...queryKeys.tts.all, 'speakers'] as const,

    // TTS Jobs (Database-backed)
    jobs: (filters?: {
      status?: string;
      chapterId?: string;
      limit?: number;
    }) => [...queryKeys.tts.all, 'jobs', filters] as const,
    activeJobs: () => [...queryKeys.tts.all, 'jobs', 'active'] as const,
    job: (jobId: string) => [...queryKeys.tts.all, 'jobs', jobId] as const,
  },

  // Export
  export: {
    all: ['export'] as const,
    jobs: () => [...queryKeys.export.all, 'jobs'] as const,
    job: (jobId: string) => [...queryKeys.export.jobs(), jobId] as const,
    progress: (jobId: string) =>
      [...queryKeys.export.all, 'progress', jobId] as const,
  },

  // Settings
  settings: {
    all: () => ['settings'] as const,
    detail: (key: string) => [...queryKeys.settings.all(), 'detail', key] as const,
    engineSchema: (engine: string) =>
      [...queryKeys.settings.all(), 'engine-schema', engine] as const,
    segmentLimits: (engine: string) =>
      [...queryKeys.settings.all(), 'segment-limits', engine] as const,
  },

  // Speakers
  speakers: {
    all: ['speakers'] as const,
    lists: () => [...queryKeys.speakers.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.speakers.all, 'detail', id] as const,
    default: () => [...queryKeys.speakers.all, 'default'] as const,
  },

  // Pronunciation rules
  pronunciation: {
    all: ['pronunciation'] as const,
    lists: () => [...queryKeys.pronunciation.all, 'list'] as const,
    list: (filters: {
      engine?: string;
      language?: string;
      projectId?: string;
      scope?: string;
    }) => [...queryKeys.pronunciation.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.pronunciation.all, 'detail', id] as const,
    context: (engine: string, language: string, projectId?: string) =>
      [...queryKeys.pronunciation.all, 'context', engine, language, projectId] as const,
    conflicts: (engine: string, language: string) =>
      [...queryKeys.pronunciation.all, 'conflicts', engine, language] as const,
    test: () => [...queryKeys.pronunciation.all, 'test'] as const,
    projectCount: (projectId: string) =>
      [...queryKeys.pronunciation.all, 'project-count', projectId] as const,
  },

  // Quality Analysis
  quality: {
    all: ['quality'] as const,
    jobs: (filters?: {
      status?: string;
      chapterId?: string;
      limit?: number;
      offset?: number;
    }) => [...queryKeys.quality.all, 'jobs', filters] as const,
    activeJobs: () => [...queryKeys.quality.all, 'jobs', 'active'] as const,
    job: (id: string) => [...queryKeys.quality.all, 'job', id] as const,
  },

  // Import
  import: {
    all: ['import'] as const,
    preview: (fileHash?: string) => [...queryKeys.import.all, 'preview', fileHash] as const,
  },

  // Engines (Management)
  engines: {
    all: () => ['engines'] as const,
  },

  // Health
  health: () => ['health'] as const,
} as const

/**
 * Helper type to extract query key types
 * Usage: type ProjectsKey = QueryKey<typeof queryKeys.projects.all>
 */
export type QueryKey<T> = T extends readonly unknown[] ? T : never
