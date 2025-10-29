
export const queryKeys = {
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.projects.lists(), filters] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },

  chapters: {
    all: ['chapters'] as const,
    lists: () => [...queryKeys.chapters.all, 'list'] as const,
    list: (projectId?: string) =>
      [...queryKeys.chapters.lists(), { projectId }] as const,
    details: () => [...queryKeys.chapters.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.chapters.details(), id] as const,
  },

  segments: {
    all: ['segments'] as const,
    lists: () => [...queryKeys.segments.all, 'list'] as const,
    list: (chapterId?: string) =>
      [...queryKeys.segments.lists(), { chapterId }] as const,
    details: () => [...queryKeys.segments.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.segments.details(), id] as const,
  },

  tts: {
    all: ['tts'] as const,
    engines: () => [...queryKeys.tts.all, 'engines'] as const,
    models: (engineType: string) =>
      [...queryKeys.tts.all, 'models', engineType] as const,
    speakers: () => [...queryKeys.tts.all, 'speakers'] as const,
    progress: (chapterId: string) =>
      [...queryKeys.tts.all, 'progress', chapterId] as const,
  },

  export: {
    all: ['export'] as const,
    jobs: () => [...queryKeys.export.all, 'jobs'] as const,
    job: (jobId: string) => [...queryKeys.export.jobs(), jobId] as const,
    progress: (jobId: string) =>
      [...queryKeys.export.all, 'progress', jobId] as const,
  },

  settings: {
    all: ['settings'] as const,
    engineSchema: (engine: string) =>
      [...queryKeys.settings.all, 'engine-schema', engine] as const,
  },

  speakers: {
    all: ['speakers'] as const,
    lists: () => [...queryKeys.speakers.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.speakers.all, 'detail', id] as const,
  },
} as const

export type QueryKey<T> = T extends readonly unknown[] ? T : never
