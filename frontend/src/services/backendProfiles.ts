/**
 * Backend Profile Management Service
 *
 * Handles CRUD operations for backend connection profiles,
 * stored in localStorage for persistence.
 */

import type { BackendProfile, ApiBackendProfile } from '@types'
import { transformBackendProfile } from '@/types/api'
import { logger } from '@utils/logger'

const STORAGE_KEY = 'audiobook-maker:backend-profiles'

/**
 * Internal: Convert BackendProfile to ApiBackendProfile for serialization
 */
function toApiProfile(profile: BackendProfile): ApiBackendProfile {
  return {
    ...profile,
    lastConnected: profile.lastConnected ? profile.lastConnected.toISOString() : null,
    createdAt: profile.createdAt.toISOString(),
  }
}

/**
 * Internal: Persist profiles to localStorage
 */
function persist(profiles: BackendProfile[]): void {
  try {
    const apiProfiles = profiles.map(toApiProfile)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apiProfiles))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      logger.error('[BackendProfiles] localStorage quota exceeded')
      throw new Error('Storage limit reached. Please delete some backend profiles.')
    } else {
      logger.error('[BackendProfiles] Failed to save to localStorage:', error)
      throw new Error('Failed to save profile to storage')
    }
  }
}

/**
 * Load all profiles from localStorage
 */
export function loadProfiles(): BackendProfile[] {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return []

  try {
    const parsed: ApiBackendProfile[] = JSON.parse(stored)
    return parsed.map(transformBackendProfile)
  } catch (error) {
    logger.error('[BackendProfiles] Failed to parse profiles from localStorage:', error)
    return []
  }
}

/**
 * Save a new profile
 */
export function saveProfile(data: Omit<BackendProfile, 'id' | 'createdAt'>): BackendProfile {
  const profiles = loadProfiles()

  // If setting as default, unset all others
  if (data.isDefault) {
    profiles.forEach((p) => (p.isDefault = false))
  }

  const newProfile: BackendProfile = {
    ...data,
    id: crypto.randomUUID(),
    createdAt: new Date(),
  }

  profiles.push(newProfile)
  persist(profiles)

  return newProfile
}

/**
 * Update an existing profile
 */
export function updateProfile(id: string, updates: Partial<BackendProfile>): BackendProfile {
  const profiles = loadProfiles()
  const index = profiles.findIndex((p) => p.id === id)

  if (index === -1) {
    throw new Error(`Profile with id "${id}" not found`)
  }

  // If setting as default, unset all others
  if (updates.isDefault) {
    profiles.forEach((p) => (p.isDefault = false))
  }

  profiles[index] = { ...profiles[index], ...updates }
  persist(profiles)

  return profiles[index]
}

/**
 * Delete a profile
 */
export function deleteProfile(id: string): void {
  let profiles = loadProfiles()
  profiles = profiles.filter((p) => p.id !== id)
  persist(profiles)
}

/**
 * Validate a backend URL
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: 'URL is required' }
  }

  try {
    const parsed = new URL(url)

    // Must be http or https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' }
    }

    // No trailing slash
    if (url.endsWith('/')) {
      return { valid: false, error: 'URL should not end with a slash' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

/**
 * Update the lastConnected timestamp for a profile
 */
export function markProfileAsConnected(id: string): void {
  updateProfile(id, { lastConnected: new Date() })
}

/**
 * Initialize default profile on first launch
 *
 * Creates a "Local Development" profile if no profiles exist.
 */
export function initializeDefaultProfile(): void {
  const profiles = loadProfiles()

  if (profiles.length === 0) {
    logger.info('[BackendProfiles] No profiles found, creating default "Local Backend" profile')
    saveProfile({
      name: 'Local Backend',
      url: 'http://127.0.0.1:8765',
      isDefault: true,
      lastConnected: null,
    })
  }
}
