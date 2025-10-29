
import { create } from 'zustand'
import type { BackendProfile, SessionState } from '../types/backend'
import { logger } from '../utils/logger'


export interface GlobalSettings {
  tts: {
    defaultEngine: string;
    defaultModelName: string;
    defaultSpeaker: string | null;
    engines: {
      [engineType: string]: {
        defaultLanguage: string;
        parameters: Record<string, any>;
      };
    };
  };
  audio: {
    defaultFormat: 'mp3' | 'wav' | 'm4a';
    defaultQuality: 'low' | 'medium' | 'high';
    pauseBetweenSegments: number;
    defaultDividerDuration: number;
    volumeNormalization: {
      enabled: boolean;
      targetLevel: number;
      truePeak: number;
    };
  };
  text: {
    defaultSegmentationMethod: 'sentences' | 'paragraphs' | 'smart' | 'length';
    preferredMaxSegmentLength: number;
    autoCreateSegments: boolean;
    autoDetectLanguage: boolean;
  };
}

interface ConnectionState {
  url: string | null
  isConnected: boolean
  version: string | null
  profile: BackendProfile | null
}

interface SessionOverrides {
  engine?: string
  modelName?: string
  speaker?: string
  language?: string
}

export interface AppStore {
  connection: ConnectionState

  settings: GlobalSettings | null
  isSettingsLoaded: boolean

  sessionOverrides: SessionOverrides

  activeGenerations: Set<string>

  lastSessionState: SessionState | null

  getCurrentEngine: () => string
  getCurrentModelName: () => string
  getCurrentSpeaker: () => string
  getCurrentLanguage: () => string

  setBackendConnection: (profile: BackendProfile, version: string) => void
  disconnectBackend: () => void

  loadSettings: (settings: GlobalSettings) => void
  updateSettings: (category: keyof GlobalSettings, value: any) => void
  resetSettings: () => void

  setSessionOverride: (field: keyof SessionOverrides, value: string) => void
  clearSessionOverrides: () => void

  startGeneration: (chapterId: string) => void
  stopGeneration: (chapterId: string) => void
  clearGenerations: () => void

  saveSessionState: (state: SessionState) => void
  restoreSessionState: () => SessionState | null
  clearSessionState: () => void
}


const SESSION_STORAGE_KEY = 'audiobook-maker:session-state'

const FALLBACK_DEFAULTS = {
  engine: 'dummy',
  modelName: 'dummy',
  speaker: '',
  language: 'de',
} as const


export const useAppStore = create<AppStore>((set, get) => ({
  connection: {
    url: null,
    isConnected: false,
    version: null,
    profile: null,
  },

  settings: null,
  isSettingsLoaded: false,

  sessionOverrides: {},

  activeGenerations: new Set<string>(),

  lastSessionState: null,


  getCurrentEngine: () => {
    const state = get()
    return (
      state.sessionOverrides.engine ||
      state.settings?.tts.defaultEngine ||
      FALLBACK_DEFAULTS.engine
    )
  },

  getCurrentModelName: () => {
    const state = get()
    return (
      state.sessionOverrides.modelName ||
      state.settings?.tts.defaultModelName ||
      FALLBACK_DEFAULTS.modelName
    )
  },

  getCurrentSpeaker: () => {
    const state = get()
    return (
      state.sessionOverrides.speaker ||
      state.settings?.tts.defaultSpeaker ||
      FALLBACK_DEFAULTS.speaker
    )
  },

  getCurrentLanguage: () => {
    const state = get()

    if (state.sessionOverrides.language) {
      return state.sessionOverrides.language
    }

    const currentEngine = state.getCurrentEngine()
    const engineConfig = state.settings?.tts.engines[currentEngine]
    if (engineConfig?.defaultLanguage) {
      return engineConfig.defaultLanguage
    }

    return FALLBACK_DEFAULTS.language
  },


  setBackendConnection: (profile, version) => {
    logger.info('[AppStore] Setting backend connection:', {
      profileName: profile.name,
      url: logger.sanitize(profile.url),
      version,
    })

    set({
      connection: {
        url: profile.url,
        isConnected: true,
        version,
        profile,
      },
    })
  },

  disconnectBackend: () => {
    logger.info('[AppStore] Disconnecting from backend')

    set({
      connection: {
        url: null,
        isConnected: false,
        version: null,
        profile: null,
      },
    })
  },


  loadSettings: (settings) => {
    logger.info('[AppStore] Loading settings:', {
      engine: settings.tts.defaultEngine,
      model: settings.tts.defaultModelName,
      speaker: settings.tts.defaultSpeaker,
    })

    set({
      settings,
      isSettingsLoaded: true,
    })
  },

  updateSettings: (category, value) => {
    logger.info('[AppStore] Updating settings category:', category)

    set((state) => {
      if (!state.settings) {
        logger.warn('[AppStore] Cannot update settings - settings not loaded')
        return state
      }

      return {
        settings: {
          ...state.settings,
          [category]: value,
        },
      }
    })
  },

  resetSettings: () => {
    logger.info('[AppStore] Resetting settings')

    set({
      settings: null,
      isSettingsLoaded: false,
    })
  },


  setSessionOverride: (field, value) => {
    logger.debug('[AppStore] Setting session override:', { field, value })

    set((state) => ({
      sessionOverrides: {
        ...state.sessionOverrides,
        [field]: value,
      },
    }))
  },

  clearSessionOverrides: () => {
    logger.info('[AppStore] Clearing all session overrides')

    set({
      sessionOverrides: {},
    })
  },


  startGeneration: (chapterId) => {
    const current = get().activeGenerations
    const updated = new Set(current)
    updated.add(chapterId)
    logger.info('[AppStore] Starting generation for chapter:', chapterId, 'Total active:', updated.size)
    set({ activeGenerations: updated })
  },

  stopGeneration: (chapterId) => {
    const current = get().activeGenerations
    const updated = new Set(current)
    updated.delete(chapterId)
    logger.info('[AppStore] Stopping generation for chapter:', chapterId, 'Total active:', updated.size)
    set({ activeGenerations: updated })
  },

  clearGenerations: () => {
    logger.info('[AppStore] Clearing all active generations')
    set({ activeGenerations: new Set<string>() })
  },


  saveSessionState: (state) => {
    const stateWithTimestamp = {
      ...state,
      timestamp: new Date(),
    }
    set({ lastSessionState: stateWithTimestamp })

    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateWithTimestamp))
      logger.debug('[AppStore] Session state saved to localStorage')
    } catch (error) {
      logger.error('[AppStore] Failed to save session state to localStorage:', error)
    }
  },

  restoreSessionState: () => {
    let session = get().lastSessionState

    if (!session) {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY)
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          session = {
            ...parsed,
            timestamp: new Date(parsed.timestamp),
          }
          logger.info('[AppStore] Session state restored from localStorage')
        } catch (error) {
          logger.error('[AppStore] Failed to parse session state from localStorage:', error)
          return null
        }
      }
    }

    if (!session) {
      logger.debug('[AppStore] No session state to restore')
      return null
    }

    logger.info('[AppStore] Restoring session state:', {
      projectId: session.selectedProjectId,
      chapterId: session.selectedChapterId,
      timestamp: session.timestamp,
    })

    return session
  },

  clearSessionState: () => {
    logger.info('[AppStore] Clearing session state')

    set({ lastSessionState: null })
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    } catch (error) {
      logger.error('[AppStore] Failed to clear session state from localStorage:', error)
    }
  },
}))


export function getDefaultLanguage(settings: GlobalSettings | null, engineType: string): string {
  if (!settings) return 'en'
  const engineConfig = settings.tts.engines[engineType]
  return engineConfig?.defaultLanguage || 'en'
}
