/**
 * API Response Helpers
 *
 * Frontend-specific transformations for types not covered by OpenAPI.
 * Main API response types come from api.generated.ts via transforms.ts
 */

import type { BackendProfile, ApiBackendProfile } from './backend'

/**
 * Transform API backend profile to typed backend profile
 * Converts ISO string dates to Date objects
 */
export function transformBackendProfile(api: ApiBackendProfile): BackendProfile {
  return {
    ...api,
    lastConnected: api.lastConnected ? new Date(api.lastConnected) : null,
    createdAt: new Date(api.createdAt),
  }
}
