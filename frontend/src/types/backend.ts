/**
 * Backend-related TypeScript Interfaces
 */

/**
 * Backend Profile
 *
 * Represents a saved backend connection configuration.
 * Users can have multiple profiles for different backend instances
 * (e.g., local dev, remote server, production).
 */
export interface BackendProfile {
  /** Unique identifier (UUID) */
  id: string

  /** Human-readable name (e.g., "Local Development", "Production Server") */
  name: string

  /** Backend base URL (e.g., "http://127.0.0.1:8765" or "https://backend.example.com") */
  url: string

  /** Whether this profile is marked as the default */
  isDefault: boolean

  /** Timestamp of last successful connection (null if never connected) */
  lastConnected: Date | null

  /** Timestamp when this profile was created */
  createdAt: Date
}

/**
 * API Backend Profile (dates as ISO strings from localStorage)
 *
 * Same as BackendProfile but with Date fields as strings for serialization.
 */
export interface ApiBackendProfile {
  /** Unique identifier (UUID) */
  id: string

  /** Human-readable name (e.g., "Local Development", "Production Server") */
  name: string

  /** Backend base URL (e.g., "http://127.0.0.1:8765" or "https://backend.example.com") */
  url: string

  /** Whether this profile is marked as the default */
  isDefault: boolean

  /** ISO timestamp of last successful connection (null if never connected) */
  lastConnected: string | null

  /** ISO timestamp when this profile was created */
  createdAt: string
}

/**
 * Session State
 *
 * Captures the current UI state for restoration after reconnection.
 */
export interface SessionState {
  /** Currently selected project ID */
  selectedProjectId: string | null

  /** Currently selected chapter ID */
  selectedChapterId: string | null

  /** Currently selected segment ID */
  selectedSegmentId: string | null

  /** IDs of expanded projects in the sidebar */
  expandedProjects: string[]

  /** Timestamp when this state was saved */
  timestamp: Date
}

/**
 * Backend Health Response
 *
 * Response from the /health endpoint
 */
export interface BackendHealthResponse {
  status: 'ok' | 'error'
  version: string
  timestamp: string
  database: boolean
  ttsEngines: string[]
  busy: boolean  // True if backend is processing long-running operations
  activeJobs: number  // Number of active generation/export jobs

  // Engine availability (for feature-gating)
  hasTtsEngine: boolean
  hasTextEngine: boolean
  hasSttEngine: boolean
}
