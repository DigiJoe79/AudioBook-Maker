/**
 * Engine Management Types
 *
 * Types for engine status, availability tracking, and management UI.
 */

export type EngineType = 'tts' | 'text' | 'stt' | 'audio'

export type EngineStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping' | 'disabled'

/**
 * Engine status information for management UI
 */
export interface EngineStatusInfo {
  name: string
  displayName: string
  version: string
  engineType: EngineType

  // Status
  isEnabled: boolean
  isRunning: boolean
  isDefault?: boolean // True for default engine of its type
  status: EngineStatus
  port?: number
  errorMessage?: string

  // Auto-stop info
  idleTimeoutSeconds?: number // Null = exempt from auto-stop
  secondsUntilAutoStop?: number // Countdown
  keepRunning: boolean // If true, engine won't be auto-stopped

  // Capabilities
  supportedLanguages: string[]  // Filtered by allowedLanguages for TTS
  allSupportedLanguages?: string[]  // Unfiltered, for Settings UI (optional for backwards compat)
  device: 'cpu' | 'cuda'

  // Resource info
  memoryUsageMb?: number
  vramUsageMb?: number

  // Models
  availableModels: string[]
  loadedModel?: string
  defaultModelName?: string  // Per-engine default model from settings
}

/**
 * All engines status grouped by type
 */
export interface AllEnginesStatus {
  success: boolean
  tts: EngineStatusInfo[]
  text: EngineStatusInfo[]
  stt: EngineStatusInfo[]
  audio: EngineStatusInfo[]

  // Summary for feature-gating
  hasTtsEngine: boolean
  hasTextEngine: boolean
  hasSttEngine: boolean
  hasAudioEngine: boolean
}

/**
 * Engine availability summary (for app store)
 */
export interface EngineAvailability {
  tts: {
    hasEnabled: boolean
    hasRunning: boolean
    engines: string[]
  }
  text: {
    hasEnabled: boolean
    hasRunning: boolean
    engines: string[]
  }
  stt: {
    hasEnabled: boolean
    hasRunning: boolean
    engines: string[]
  }
  audio: {
    hasEnabled: boolean
    hasRunning: boolean
    engines: string[]
  }
}
