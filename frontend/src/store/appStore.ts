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
import type { AllEnginesStatus } from '@/types/engines'
import { logger } from '@utils/logger'
import { queryClient } from '@services/queryClient'
import { queryKeys } from '@services/queryKeys'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface GlobalSettings {
  // NOTE: Default engines are now in engines.is_default (Single Source of Truth)
  // NOTE: Per-variant settings are now in engines table
  audio: {
    // Export settings
    defaultFormat: 'mp3' | 'wav' | 'm4a';
    defaultQuality: 'low' | 'medium' | 'high';
    pauseBetweenSegments: number;
    defaultDividerDuration: number;
  };
  text: {
    preferredMaxSegmentLength: number;
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

interface AppStore {
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
  // Get default engine from engines status (Single Source of Truth: engines.is_default)
  // Note: For default model/language, use engineInfo from useAllEnginesStatus() hook
  getDefaultTtsEngine: () => string
  getDefaultSttEngine: () => string

  // Text getters
  getDefaultTextEngine: () => string

  // Audio getters
  getDefaultAudioEngine: () => string

  // Engine availability getters
  canUseImport: () => boolean

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

// Fallback default for TTS engine if none is set
// NOTE: Empty string forces AppLayout to select first available engine
const FALLBACK_TTS_ENGINE = ''

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
    tts: { hasEnabled: false },
    text: { hasEnabled: false },
    stt: { hasEnabled: false },
    audio: { hasEnabled: false },
  },

  // ====== Session State ======
  lastSessionState: null,

  // ====== Computed Getters ======
  // Direct access to DB Settings (no session overrides)

  /**
   * Get default TTS engine from engines status (Single Source of Truth: engines.is_default)
   */
  getDefaultTtsEngine: () => {
    const enginesData = queryClient.getQueryData<AllEnginesStatus>(queryKeys.engines.all())
    if (enginesData?.tts) {
      const defaultEngine = enginesData.tts.find(e => e.isDefault)
      if (defaultEngine) {
        return defaultEngine.variantId
      }
    }
    return FALLBACK_TTS_ENGINE
  },

  /**
   * Get default STT engine from engines status (Single Source of Truth: engines.is_default)
   * Returns empty string if no default is set (deactivated)
   */
  getDefaultSttEngine: () => {
    const enginesData = queryClient.getQueryData<AllEnginesStatus>(queryKeys.engines.all())
    if (enginesData?.stt) {
      const defaultEngine = enginesData.stt.find(e => e.isDefault)
      if (defaultEngine) {
        return defaultEngine.variantId
      }
    }
    return ''
  },

  /**
   * Get default text processing engine from engines status (Single Source of Truth: engines.is_default)
   * Returns empty string if no default is set (deactivated)
   */
  getDefaultTextEngine: () => {
    const enginesData = queryClient.getQueryData<AllEnginesStatus>(queryKeys.engines.all())
    if (enginesData?.text) {
      const defaultEngine = enginesData.text.find(e => e.isDefault)
      if (defaultEngine) {
        return defaultEngine.variantId
      }
    }
    return ''
  },

  /**
   * Get default audio analysis engine from engines status (Single Source of Truth: engines.is_default)
   * Returns empty string if no default is set (deactivated)
   */
  getDefaultAudioEngine: () => {
    const enginesData = queryClient.getQueryData<AllEnginesStatus>(queryKeys.engines.all())
    if (enginesData?.audio) {
      const defaultEngine = enginesData.audio.find(e => e.isDefault)
      if (defaultEngine) {
        return defaultEngine.variantId
      }
    }
    return ''
  },

  /**
   * Check if import feature is available (requires text processing engine)
   */
  canUseImport: () => {
    const state = get()
    return state.engineAvailability.text.hasEnabled
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
      { loaded: true },
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
    set({
      engineAvailability: {
        tts: { hasEnabled: data.hasTtsEngine },
        text: { hasEnabled: data.hasTextEngine },
        stt: { hasEnabled: data.hasSttEngine },
        audio: { hasEnabled: data.hasAudioEngine },
      },
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
// ============================================================================
// Expose store to window in development for E2E testing
// ============================================================================
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as any).useAppStore = useAppStore
  logger.debug('[AppStore] Exposed to window.useAppStore for E2E testing')
}
