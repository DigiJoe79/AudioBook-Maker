
import type { BackendProfile } from '../types/backend'

const STORAGE_KEY = 'audiobook-maker:backend-profiles'

function persist(profiles: BackendProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.error('[BackendProfiles] localStorage quota exceeded')
      alert('Storage limit reached. Please delete some backend profiles.')
    } else {
      console.error('[BackendProfiles] Failed to save to localStorage:', error)
    }
  }
}

export function loadProfiles(): BackendProfile[] {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return []

  try {
    const parsed = JSON.parse(stored)
    return parsed.map((p: any) => ({
      ...p,
      lastConnected: p.lastConnected ? new Date(p.lastConnected) : null,
      createdAt: new Date(p.createdAt),
    }))
  } catch (error) {
    console.error('[BackendProfiles] Failed to parse profiles from localStorage:', error)
    return []
  }
}

export function saveProfile(data: Omit<BackendProfile, 'id' | 'createdAt'>): BackendProfile {
  const profiles = loadProfiles()

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

export function updateProfile(id: string, updates: Partial<BackendProfile>): BackendProfile {
  const profiles = loadProfiles()
  const index = profiles.findIndex((p) => p.id === id)

  if (index === -1) {
    throw new Error(`Profile with id "${id}" not found`)
  }

  if (updates.isDefault) {
    profiles.forEach((p) => (p.isDefault = false))
  }

  profiles[index] = { ...profiles[index], ...updates }
  persist(profiles)

  return profiles[index]
}

export function deleteProfile(id: string): void {
  let profiles = loadProfiles()
  profiles = profiles.filter((p) => p.id !== id)
  persist(profiles)
}

export function setDefaultProfile(id: string): void {
  updateProfile(id, { isDefault: true })
}

export function getDefaultProfile(): BackendProfile | null {
  const profiles = loadProfiles()
  return profiles.find((p) => p.isDefault) || null
}

export function getLastUsedProfile(): BackendProfile | null {
  const profiles = loadProfiles()
  if (profiles.length === 0) return null

  const sorted = [...profiles].sort((a, b) => {
    if (!a.lastConnected) return 1
    if (!b.lastConnected) return -1
    return b.lastConnected.getTime() - a.lastConnected.getTime()
  })

  return sorted[0]
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: 'URL is required' }
  }

  try {
    const parsed = new URL(url)

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' }
    }

    if (url.endsWith('/')) {
      return { valid: false, error: 'URL should not end with a slash' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

export function markProfileAsConnected(id: string): void {
  updateProfile(id, { lastConnected: new Date() })
}

export function initializeDefaultProfile(): void {
  const profiles = loadProfiles()

  if (profiles.length === 0) {
    console.log('[BackendProfiles] No profiles found, creating default "Local Development" profile')
    saveProfile({
      name: 'Local Development',
      url: 'http://127.0.0.1:8765',
      isDefault: true,
      lastConnected: null,
    })
  }
}
