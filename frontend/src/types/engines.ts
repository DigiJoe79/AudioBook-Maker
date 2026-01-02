/**
 * Engine Management Types
 *
 * Types for engine status, availability tracking, and management UI.
 */

export type EngineType = 'tts' | 'text' | 'stt' | 'audio'

export type EngineStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping' | 'disabled' | 'not_installed'

/**
 * Engine status information for management UI
 */
export interface EngineStatusInfo {
  variantId: string
  displayName: string
  version: string
  engineType: EngineType

  // Status
  isEnabled: boolean
  isRunning: boolean
  isDefault?: boolean // True for default engine of its type
  isPulling?: boolean // True when Docker image pull is in progress
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

  // GPU memory info (only populated when device='cuda' and engine is running)
  gpuMemoryUsedMb?: number
  gpuMemoryTotalMb?: number

  // Models
  availableModels: string[]
  loadedModel?: string
  defaultModelName?: string  // Per-engine default model from settings
  defaultLanguage?: string   // Per-engine default language from settings (for TTS)

  // Variant fields
  baseEngineName?: string       // Base engine name without runner (e.g., 'xtts')
  runnerId?: string             // Runner identifier (e.g., 'local', 'docker:local')
  runnerType?: 'subprocess' | 'docker:local' | 'docker:remote'
  runnerHost?: string           // Host name for Docker runners
  source?: 'local' | 'catalog' | 'custom'

  // Docker-specific
  dockerImage?: string          // Docker image name
  dockerTag?: string            // Installed Docker image tag (e.g., 'latest', 'cpu')
  isInstalled?: boolean         // Whether Docker image is installed

  // Engine parameters (user-configured values)
  parameters?: Record<string, unknown>
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

  // Variant grouping for UI
  variantGroups?: Record<string, EngineStatusInfo[]>  // Grouped by runner type
}

/**
 * Engine availability summary (for app store)
 */
export interface EngineAvailability {
  tts: { hasEnabled: boolean }
  text: { hasEnabled: boolean }
  stt: { hasEnabled: boolean }
  audio: { hasEnabled: boolean }
}

/**
 * Docker image variant (tag-specific metadata)
 */
export interface DockerImageVariant {
  tag: string
  requiresGpu: boolean
}

/**
 * Docker image info from catalog
 */
export interface DockerImageInfo {
  engineName: string
  image: string
  engineType: EngineType
  displayName: string
  description: string
  requiresGpu: boolean
  tags: string[]
  defaultTag: string
  supportedLanguages: string[]
  models: string[]
  variants: DockerImageVariant[]
}

/**
 * Response from GET /api/engines/catalog
 */
export interface DockerCatalogResponse {
  success: boolean
  images: DockerImageInfo[]
}

/**
 * Response from Docker install/uninstall
 */
export interface DockerInstallResponse {
  success: boolean
  variantId: string
  message: string
  isInstalled: boolean
}

/**
 * Request for Docker engine discovery
 */
export interface DockerDiscoverRequest {
  dockerImage: string
  dockerTag: string
}

/**
 * Engine info returned from discovery (matches EngineYamlSchema)
 * Uses snake_case to match engine.yaml format directly
 */
export interface DiscoveredEngineInfo {
  schema_version: number
  name: string
  display_name: string
  engine_type: EngineType
  description?: string
  supported_languages?: string[]
  requires_gpu?: boolean
  models?: Array<{
    name: string
    display_name?: string
  }>
  default_model?: string
  parameters?: Record<string, unknown>
  constraints?: Record<string, unknown>
  capabilities?: Record<string, unknown>
  engine_config?: Record<string, unknown>
}

/**
 * Response from Docker engine discovery
 */
export interface DockerDiscoverResponse {
  success: boolean
  engineInfo?: DiscoveredEngineInfo
  error?: string
}

/**
 * Request for Docker engine registration
 * Includes all discovery info to avoid double-discovery
 */
export interface DockerRegisterRequest {
  dockerImage: string
  dockerTag: string
  displayName: string
  engineType: EngineType
  // Discovery info (passed from frontend to avoid re-discovery)
  supportedLanguages?: string[]
  requiresGpu?: boolean
  models?: Array<{ name: string; display_name?: string; path?: string }>
  parameters?: Record<string, unknown>  // Full parameter schema with type/min/max/default
  constraints?: Record<string, unknown>
  capabilities?: Record<string, unknown>
  config?: Record<string, unknown>
  defaultLanguage?: string
}

/**
 * Response from Docker engine registration
 */
export interface DockerRegisterResponse {
  success: boolean
  variantId?: string
  error?: string
}

/**
 * Response from image update check
 */
export interface ImageUpdateCheckResponse {
  success: boolean
  variantId: string
  isInstalled: boolean
  updateAvailable: boolean | null
  localDigest: string | null
  remoteDigest: string | null
  error: string | null
}
