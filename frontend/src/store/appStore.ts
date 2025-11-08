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
import type { BackendProfile, SessionState } from '../types/backend'
import { logger } from '../utils/logger'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface GlobalSettings {
  tts: {
    defaultTtsEngine: string;
    defaultTtsModelName: string;
    defaultTtsSpeaker: string | null;
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
  ttsEngine?: string
  ttsModelName?: string
  ttsSpeaker?: string
  language?: string
}

export interface AppStore {
  // ====== Backend Connection ======
  connection: ConnectionState

  // ====== Global Settings (persistent, from DB) ======
  settings: GlobalSettings | null
  isSettingsLoaded: boolean

  // ====== Session Overrides (temporary, only RAM) ======
  sessionOverrides: SessionOverrides

  // ====== Session State (for recovery) ======
  lastSessionState: SessionState | null

  // ====== Computed Getters ======
  // Combine Settings + Overrides automatically
  getCurrentTtsEngine: () => string
  getCurrentTtsModelName: () => string
  getCurrentTtsSpeaker: () => string
  getCurrentLanguage: () => string

  // ====== Actions: Connection ======
  setBackendConnection: (profile: BackendProfile, version: string) => void
  disconnectBackend: () => void

  // ====== Actions: Settings ======
  loadSettings: (settings: GlobalSettings) => void
  updateSettings: (category: keyof GlobalSettings, value: any) => void
  resetSettings: () => void

  // ====== Actions: Session Overrides ======
  setSessionOverride: (field: keyof SessionOverrides, value: string) => void
  clearSessionOverrides: () => void

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

  // ====== Session Overrides ======
  sessionOverrides: {},

  // ====== Session State ======
  lastSessionState: null,

  // ====== Computed Getters ======

  /**
   * Get current TTS engine
   * Priority: Session Override > Settings > Fallback
   */
  getCurrentTtsEngine: () => {
    const state = get()
    return (
      state.sessionOverrides.ttsEngine ||
      state.settings?.tts.defaultTtsEngine ||
      FALLBACK_DEFAULTS.ttsEngine
    )
  },

  /**
   * Get current TTS model name
   * Priority: Session Override > Settings > Fallback
   */
  getCurrentTtsModelName: () => {
    const state = get()
    return (
      state.sessionOverrides.ttsModelName ||
      state.settings?.tts.defaultTtsModelName ||
      FALLBACK_DEFAULTS.ttsModelName
    )
  },

  /**
   * Get current speaker
   * Priority: Session Override > Settings > Fallback
   */
  getCurrentTtsSpeaker: () => {
    const state = get()
    return (
      state.sessionOverrides.ttsSpeaker ||
      state.settings?.tts.defaultTtsSpeaker ||
      FALLBACK_DEFAULTS.ttsSpeaker
    )
  },

  /**
   * Get current language
   * Priority: Session Override > Engine-specific default > Fallback
   */
  getCurrentLanguage: () => {
    const state = get()

    // Check session override first
    if (state.sessionOverrides.language) {
      return state.sessionOverrides.language
    }

    // Then check engine-specific default language
    const currentEngine = state.getCurrentTtsEngine()
    const engineConfig = state.settings?.tts.engines[currentEngine]
    if (engineConfig?.defaultLanguage) {
      return engineConfig.defaultLanguage
    }

    // Fallback
    return FALLBACK_DEFAULTS.language
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
        'Engine': settings.tts.defaultTtsEngine,
        'Model': settings.tts.defaultTtsModelName,
        'Speaker': settings.tts.defaultTtsSpeaker || 'none'
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

  // ====== Actions: Session Overrides ======

  setSessionOverride: (field, value) => {
    logger.group('💾 App Store', 'Setting session override', {
      'Field': field,
      'Value': value || 'undefined'
    }, '#2196F3')

    set((state) => ({
      sessionOverrides: {
        ...state.sessionOverrides,
        [field]: value,
      },
    }))
  },

  clearSessionOverrides: () => {
    const state = get()
    logger.group(
      '💾 App Store',
      'Clearing all session overrides',
      {
        'Previous Overrides': Object.keys(state.sessionOverrides).length,
        'Action': 'clear'
      },
      '#FF9800'  // Orange for cleanup
    )

    set({
      sessionOverrides: {},
    })
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
