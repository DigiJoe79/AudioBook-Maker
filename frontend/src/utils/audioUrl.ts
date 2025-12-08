/**
 * Audio URL Construction Utilities
 *
 * Constructs full audio URLs from filenames stored in database.
 */

/**
 * Construct full audio URL from filename with cache-busting
 *
 * **Cache-Busting:**
 * Uses segment's updatedAt timestamp as version parameter to prevent
 * browser from serving stale cached audio after regeneration.
 *
 * @param audioPath - Filename (e.g., "seg-123.wav")
 * @param backendUrl - Current backend URL (e.g., "http://localhost:8765")
 * @param updatedAt - Segment's updatedAt timestamp (for cache-busting)
 * @returns Full audio URL with cache-busting parameter
 *
 * @example
 * ```ts
 * getAudioUrl("seg-123.wav", "http://localhost:8765", "2025-11-04T12:34:56")
 * // => "http://localhost:8765/api/audio/seg-123.wav?v=1730725896000"
 * ```
 */
export function getAudioUrl(
  audioPath: string | null | undefined,
  backendUrl: string | null,
  updatedAt?: string | Date
): string | null {
  // Handle null/undefined
  if (!audioPath || !backendUrl) {
    return null
  }

  // Construct URL from filename
  const baseUrl = `${backendUrl.replace(/\/$/, '')}/api/audio/${audioPath}`

  // Cache-busting: Append version parameter based on updatedAt timestamp
  // This ensures browser fetches fresh audio after regeneration
  if (updatedAt) {
    const timestamp = new Date(updatedAt).getTime()
    return `${baseUrl}?v=${timestamp}`
  }

  return baseUrl
}
