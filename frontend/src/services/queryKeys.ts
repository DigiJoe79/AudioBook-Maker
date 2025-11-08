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
    engines: () => [...queryKeys.tts.all, 'engines'] as const,
    models: (engineType: string) =>
      [...queryKeys.tts.all, 'models', engineType] as const,
    speakers: () => [...queryKeys.tts.all, 'speakers'] as const,

    // TTS Jobs (Database-backed)
    jobs: (filters?: {
      status?: string;
      chapterId?: string;
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
  },

  // Speakers
  speakers: {
    all: ['speakers'] as const,
    lists: () => [...queryKeys.speakers.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.speakers.all, 'detail', id] as const,
  },
} as const

/**
 * Helper type to extract query key types
 * Usage: type ProjectsKey = QueryKey<typeof queryKeys.projects.all>
 */
export type QueryKey<T> = T extends readonly unknown[] ? T : never
