/**
 * Test Data for E2E Tests
 *
 * Provides realistic test data for:
 * - Projects with chapters and segments
 * - TTS engines and models
 * - Speakers with samples
 * - Settings
 */

export const testData = {
  // Projects
  projects: [
    {
      id: 'proj-1',
      title: 'Test Audiobook',
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
      chapters: [
        {
          id: 'ch-1',
          projectId: 'proj-1',
          title: 'Chapter 1: Introduction',
          orderIndex: 0,
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T10:00:00Z',
          segments: [
            {
              id: 'seg-1',
              chapterId: 'ch-1',
              text: 'This is the first segment of the audiobook.',
              type: 'text',
              orderIndex: 0,
              status: 'completed',
              ttsSpeakerName: 'Test Speaker',
              ttsEngine: 'xtts',
              ttsModelName: 'v2.0.2',
              hasAudio: true,
              createdAt: '2025-01-15T10:00:00Z',
              updatedAt: '2025-01-15T10:00:00Z',
            },
            {
              id: 'seg-2',
              chapterId: 'ch-1',
              text: 'This is the second segment with more text.',
              type: 'text',
              orderIndex: 1,
              status: 'completed',
              ttsSpeakerName: 'Test Speaker',
              ttsEngine: 'xtts',
              ttsModelName: 'v2.0.2',
              hasAudio: true,
              createdAt: '2025-01-15T10:00:00Z',
              updatedAt: '2025-01-15T10:00:00Z',
            },
            {
              id: 'seg-3',
              chapterId: 'ch-1',
              text: '',
              type: 'divider',
              orderIndex: 2,
              status: 'completed',
              pauseDuration: 1.0,
              hasAudio: false,
              createdAt: '2025-01-15T10:00:00Z',
              updatedAt: '2025-01-15T10:00:00Z',
            },
            {
              id: 'seg-4',
              chapterId: 'ch-1',
              text: 'This segment is pending generation.',
              type: 'text',
              orderIndex: 3,
              status: 'pending',
              ttsSpeakerName: 'Test Speaker',
              ttsEngine: 'xtts',
              ttsModelName: 'v2.0.2',
              hasAudio: false,
              createdAt: '2025-01-15T10:00:00Z',
              updatedAt: '2025-01-15T10:00:00Z',
            },
          ],
        },
        {
          id: 'ch-2',
          projectId: 'proj-1',
          title: 'Chapter 2: Development',
          orderIndex: 1,
          createdAt: '2025-01-15T11:00:00Z',
          updatedAt: '2025-01-15T11:00:00Z',
          segments: [],
        },
      ],
    },
  ],

  // TTS Engines
  ttsEngines: [
    {
      engineType: 'xtts',
      displayName: 'XTTS v2',
      isAvailable: true,
      models: [
        {
          name: 'v2.0.2',
          displayName: 'XTTS v2.0.2',
        },
      ],
      supportedLanguages: ['en', 'de', 'fr', 'es'],
      capabilities: {
        supportsModelHotswap: true,
        supportsSpeakerCloning: true,
        supportsStreaming: false,
      },
    },
  ],

  // Speakers
  speakers: [
    {
      id: 'speaker-1',
      name: 'Test Speaker',
      isActive: true,
      samples: [
        {
          id: 'sample-1',
          speakerId: 'speaker-1',
          filename: 'sample1.wav',
          duration: 5.2,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
    },
    {
      id: 'speaker-2',
      name: 'Another Speaker',
      isActive: true,
      samples: [],
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
    },
  ],

  // Settings
  settings: {
    defaultTtsEngine: 'xtts:local',
    defaultTtsModelName: 'v2.0.2',
    defaultTtsSpeakerName: 'Test Speaker',
    defaultLanguage: 'en',
    uiLanguage: 'en',
    theme: 'system',
  },
}
