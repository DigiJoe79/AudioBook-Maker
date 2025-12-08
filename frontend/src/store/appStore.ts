/**
 * App Store - Unified Application State Management
 *
 * Architecture:
 * - Backend Connection: URL, version, profile, connection status
 * - Global Settings: Persistent settings from database
 * - Session Overrides: Temporary user choices for current session
 * - Computed Getters: Combine settings + overrides automatically
 * - Generation Monitoring: Active TTS generation tracking
 * - Session State: For reconnection recovery
 *
 * Pattern: Settings + Session Overrides
 * - Settings = Persistent defaults from database
 * - Session Overrides = Temporary user choices for current session
 * - Computed Getters automatically combine: override || settings.default || fallback
 */

import { create } from 'zustand'
import { produce } from 'immer'
import type { BackendProfile, SessionState, EngineAvailability } from '@types'
import { logger } from '@utils/logger'

// ============================================================================
// Types & Interfaces
// ============================================================================

// Common engine settings structure
interface EngineSettings {
  enabled?: boolean;
  defaultModelName?: string;
  parameters?: Record<string, unknown>;
}

export interface GlobalSettings {
  tts: {
    defaultTtsEngine: string;
    // NOTE: defaultTtsModelName removed - now per-engine (see engines.*.defaultModelName)
    // NOTE: defaultTtsSpeaker removed - speakers table (is_default flag) is the single source of truth
    //       Use useDefaultSpeaker() hook to get the default speaker
    engines: {
      [engineName: string]: EngineSettings & {
        defaultLanguage: string;
      };
    };
  };
  audio: {
    // Export settings
    defaultFormat: 'mp3' | 'wav' | 'm4a';
    defaultQuality: 'low' | 'medium' | 'high';
    pauseBetweenSegments: number;
    defaultDividerDuration: number;
    // Audio Analysis Engine settings
    defaultAudioEngine?: string;
    engines?: {
      [engineName: string]: EngineSettings;
    };
  };
  text: {
    defaultTextEngine?: string;  // Text processing engine to use
    preferredMaxSegmentLength: number;
    engines?: {
      [engineName: string]: EngineSettings;
    };
  };
  stt: {
    defaultSttEngine: string;
    engines?: {
      [engineName: string]: EngineSettings;
    };
  };
  quality: {
    autoAnalyzeSegment: boolean;
    autoAnalyzeChapter: boolean;
    autoRegenerateDefects: number;  // 0=Deaktiviert, 1=Gebündelt, 2=Einzeln
    maxRegenerateAttempts: number;
  };
  languages: {
    allowedLanguages: string[];
  };
  engines: {
    inactivityTimeoutMinutes: number;  // Auto-stop timeout (1-30 minutes)
    autostartKeepRunning: boolean;     // Start all keepRunning engines on app startup
  };
}

interface ConnectionState {
  url: string | null
  isConnected: boolean
  version: string | null
  profile: BackendProfile | null
}

export interface AppStore {
  // ====== Backend Connection ======
  connection: ConnectionState

  // ====== Global Settings (persistent, from DB) ======
  settings: GlobalSettings | null
  isSettingsLoaded: boolean

  // ====== Engine Availability (for feature-gating) ======
  engineAvailability: EngineAvailability

  // ====== Session State (for recovery) ======
  lastSessionState: SessionState | null

  // ====== Computed Getters ======
  // Direct access to DB Settings defaults
  getDefaultTtsEngine: () => string
  getDefaultTtsModel: (engineName?: string) => string  // Per-engine default model
  getDefaultLanguage: (engineName?: string) => string

  // STT getters
  getDefaultSttEngine: () => string
  getDefaultSttModel: (engineName?: string) => string  // Per-engine default model

  // Text getters
  getDefaultTextEngine: () => string

  // Audio getters
  getDefaultAudioEngine: () => string

  // Engine availability getters
  canUseImport: () => boolean
  canUseTTS: () => boolean
  canUseSTT: () => boolean

  // ====== Actions: Connection ======
  setBackendConnection: (profile: BackendProfile, version: string) => void
  disconnectBackend: () => void

  // ====== Actions: Settings ======
  loadSettings: (settings: GlobalSettings) => void
  updateSettings: (category: keyof GlobalSettings, value: GlobalSettings[keyof GlobalSettings]) => void
  resetSettings: () => void

  // ====== Actions: Engine Availability ======
  updateEngineAvailability: (data: { hasTtsEngine: boolean; hasTextEngine: boolean; hasSttEngine: boolean; hasAudioEngine: boolean }) => void

  // ====== Actions: Session State ======
  saveSessionState: (state: SessionState) => void
  restoreSessionState: () => SessionState | null
  clearSessionState: () => void
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_STORAGE_KEY = 'audiobook-maker:session-state'

// Fallback defaults if settings are not loaded
// NOTE: Empty strings force AppLayout to select first available engine/model
// This maintains engine-agnostic architecture (no hardcoded engine names)
const FALLBACK_DEFAULTS = {
  ttsEngine: '',
  ttsModelName: '',
  ttsSpeaker: '',
  language: 'de',
} as const

// ============================================================================
// Store Implementation
// ============================================================================

export const useAppStore = create<AppStore>((set, get) => ({
  // ====== Backend Connection ======
  connection: {
    url: null,
    isConnected: false,
    version: null,
    profile: null,
  },

  // ====== Global Settings ======
  settings: null,
  isSettingsLoaded: false,

  // ====== Engine Availability ======
  engineAvailability: {
    tts: {
      hasEnabled: false,
      hasRunning: false,
      engines: [],
    },
    text: {
      hasEnabled: false,
      hasRunning: false,
      engines: [],
    },
    stt: {
      hasEnabled: false,
      hasRunning: false,
      engines: [],
    },
    audio: {
      hasEnabled: false,
      hasRunning: false,
      engines: [],
    },
  },

  // ====== Session State ======
  lastSessionState: null,

  // ====== Computed Getters ======
  // Direct access to DB Settings (no session overrides)

  /**
   * Get default TTS engine from database settings
   */
  getDefaultTtsEngine: () => {
    const state = get()
    return state.settings?.tts.defaultTtsEngine || FALLBACK_DEFAULTS.ttsEngine
  },

  /**
   * Get default TTS model for a specific engine (per-engine default)
   */
  getDefaultTtsModel: (engineName?: string) => {
    const state = get()
    const engine = engineName ?? state.getDefaultTtsEngine()
    const engineConfig = state.settings?.tts.engines[engine]
    return engineConfig?.defaultModelName ?? FALLBACK_DEFAULTS.ttsModelName
  },

  /**
   * Get default language for a specific engine from database settings
   */
  getDefaultLanguage: (engineName?: string) => {
    const state = get()
    const engine = engineName ?? state.getDefaultTtsEngine()
    const engineConfig = state.settings?.tts.engines[engine]
    return engineConfig?.defaultLanguage || FALLBACK_DEFAULTS.language
  },

  /**
   * Get default STT engine from database settings
   * Returns empty string if no default is set (deactivated)
   */
  getDefaultSttEngine: () => {
    const state = get()
    // Use ?? to preserve empty string (deactivated state)
    // || would fallback for empty string, masking intentional deactivation
    return state.settings?.stt.defaultSttEngine ?? ''
  },

  /**
   * Get default STT model for a specific engine (per-engine default)
   * Returns empty string if engine is deactivated (empty string)
   * Falls back to 'base' only if engine is valid but has no model
   */
  getDefaultSttModel: (engineName?: string) => {
    const state = get()
    const engine = engineName ?? state.getDefaultSttEngine()
    // If engine is empty string (deactivated), return empty string
    if (engine === '') return ''
    const engineConfig = state.settings?.stt.engines?.[engine]
    return engineConfig?.defaultModelName || 'base'
  },

  /**
   * Get default text processing engine from database settings
   * Returns empty string if no default is set (deactivated)
   */
  getDefaultTextEngine: () => {
    const state = get()
    // Use ?? to preserve empty string (deactivated state)
    // || would fallback for empty string, masking intentional deactivation
    return state.settings?.text.defaultTextEngine ?? ''
  },

  /**
   * Get default audio analysis engine from database settings
   */
  getDefaultAudioEngine: () => {
    const state = get()
    return state.settings?.audio?.defaultAudioEngine ?? ''
  },

  /**
   * Check if import feature is available (requires text processing engine)
   */
  canUseImport: () => {
    const state = get()
    return state.engineAvailability.text.hasEnabled
  },

  /**
   * Check if TTS generation is available (requires TTS engine)
   */
  canUseTTS: () => {
    const state = get()
    return state.engineAvailability.tts.hasEnabled
  },

  /**
   * Check if STT analysis is available (requires STT engine)
   */
  canUseSTT: () => {
    const state = get()
    return state.engineAvailability.stt.hasEnabled
  },

  // ====== Actions: Connection ======

  setBackendConnection: (profile, version) => {
    logger.group(
      '💾 App Store',
      'Setting backend connection',
      {
        'Profile': profile.name,
        'URL': logger.sanitize(profile.url),
        'Version': version
      },
      '#2196F3'  // Blue for info
    )

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
    const state = get()
    logger.group(
      '💾 App Store',
      'Disconnecting from backend',
      {
        'Previous URL': state.connection.url || 'none',
        'Action': 'disconnect'
      },
      '#FF9800'  // Orange for cleanup
    )

    set({
      connection: {
        url: null,
        isConnected: false,
        version: null,
        profile: null,
      },
    })
    // Session state is preserved for reconnection
    // No expiration - persists until manually cleared
  },

  // ====== Actions: Settings ======

  loadSettings: (settings) => {
    logger.group(
      '💾 App Store',
      'Loading settings',
      {
        'Default TTS Engine': settings.tts.defaultTtsEngine
      },
      '#2196F3'  // Blue for info
    )

    set({
      settings,
      isSettingsLoaded: true,
    })
  },

  updateSettings: (category, value) => {
    logger.group(
      '💾 App Store',
      'Updating settings category',
      {
        'Category': category,
        'Has Value': !!value
      },
      '#2196F3'  // Blue for info
    )

    set(
      produce((draft) => {
        if (!draft.settings) {
          logger.warn('[AppStore] Cannot update settings - settings not loaded')
          return
        }
        draft.settings[category] = value
      })
    )
  },

  resetSettings: () => {
    logger.group(
      '💾 App Store',
      'Resetting settings',
      {
        'Action': 'reset',
        'Settings Loaded': get().isSettingsLoaded
      },
      '#FF9800'  // Orange for cleanup
    )

    set({
      settings: null,
      isSettingsLoaded: false,
    })
  },

  // ====== Actions: Engine Availability ======

  updateEngineAvailability: (data) => {
    set((state) => ({
      engineAvailability: {
        tts: {
          hasEnabled: data.hasTtsEngine,
          hasRunning: state.engineAvailability.tts.hasRunning,
          engines: state.engineAvailability.tts.engines,
        },
        text: {
          hasEnabled: data.hasTextEngine,
          hasRunning: state.engineAvailability.text.hasRunning,
          engines: state.engineAvailability.text.engines,
        },
        stt: {
          hasEnabled: data.hasSttEngine,
          hasRunning: state.engineAvailability.stt.hasRunning,
          engines: state.engineAvailability.stt.engines,
        },
        audio: {
          hasEnabled: data.hasAudioEngine,
          hasRunning: state.engineAvailability.audio.hasRunning,
          engines: state.engineAvailability.audio.engines,
        },
      },
    }))
  },

  // ====== Actions: Session State ======

  saveSessionState: (state) => {
    const stateWithTimestamp = {
      ...state,
      timestamp: new Date(),
    }
    set({ lastSessionState: stateWithTimestamp })

    // Persist to localStorage for recovery after app restart
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateWithTimestamp))
      if (import.meta.env.DEV) {
        logger.group(
          '💾 App Store',
          'Session state saved to localStorage',
          {
            'Project ID': state.selectedProjectId || 'none',
            'Chapter ID': state.selectedChapterId || 'none'
          },
          '#2196F3'  // Blue for info
        )
      }
    } catch (error) {
      logger.error('[AppStore] Failed to save session state to localStorage:', error)
    }
  },

  restoreSessionState: () => {
    // First check Zustand state
    let session = get().lastSessionState

    // If not in memory, try localStorage
    if (!session) {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY)
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          const restoredSession: SessionState = {
            ...parsed,
            timestamp: new Date(parsed.timestamp),
          }
          session = restoredSession
          logger.group(
            '💾 App Store',
            'Session state restored from localStorage',
            {
              'Project ID': restoredSession.selectedProjectId || 'none',
              'Chapter ID': restoredSession.selectedChapterId || 'none',
              'Timestamp': restoredSession.timestamp.toLocaleString()
            },
            '#2196F3'  // Blue for info
          )
        } catch (error) {
          logger.error('[AppStore] Failed to parse session state from localStorage:', error)
          return null
        }
      }
    }

    if (!session) {
      if (import.meta.env.DEV) {
        logger.group(
          '💾 App Store',
          'No session state to restore',
          {
            'Action': 'skip restore'
          },
          '#2196F3'  // Blue for info
        )
      }
      return null
    }

    // TypeScript type assertion: session is guaranteed to be non-null here
    const validSession = session as SessionState

    // Session state never expires - always restore
    logger.group(
      '💾 App Store',
      'Restoring session state',
      {
        'Project ID': validSession.selectedProjectId || 'none',
        'Chapter ID': validSession.selectedChapterId || 'none',
        'Timestamp': validSession.timestamp.toLocaleString()
      },
      '#2196F3'  // Blue for info
    )

    return validSession
  },

  clearSessionState: () => {
    const state = get()
    logger.group(
      '💾 App Store',
      'Clearing session state',
      {
        'Had Session': !!state.lastSessionState,
        'Action': 'clear'
      },
      '#FF9800'  // Orange for cleanup
    )

    set({ lastSessionState: null })
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    } catch (error) {
      logger.error('[AppStore] Failed to clear session state from localStorage:', error)
    }
  },
}))

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper function to get default language for a specific engine
 * Falls back to 'en' if engine or language is not configured
 */
export function getDefaultLanguage(settings: GlobalSettings | null, engineType: string): string {
  if (!settings) return 'en'
  const engineConfig = settings.tts.engines[engineType]
  return engineConfig?.defaultLanguage || 'en'
}

// ============================================================================
// Expose store to window in development for E2E testing
// ============================================================================
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as any).useAppStore = useAppStore
  logger.debug('[AppStore] Exposed to window.useAppStore for E2E testing')
}
