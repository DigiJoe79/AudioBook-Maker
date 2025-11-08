/**
 * Audio URL Construction Utilities
 *
 * Constructs full audio URLs from filenames stored in database.
 * Includes backward compatibility for legacy full URLs.
 */

/**
 * Construct full audio URL from filename or path with cache-busting
 *
 * **Backward Compatibility:**
 * - Old format (full URL): "http://localhost:8765/audio/seg-123.wav"
 * - New format (filename): "seg-123.wav"
 *
 * **Cache-Busting:**
 * Uses segment's updatedAt timestamp as version parameter to prevent
 * browser from serving stale cached audio after regeneration.
 *
 * @param audioPath - Filename (e.g., "seg-123.wav") or legacy full URL
 * @param backendUrl - Current backend URL (e.g., "http://localhost:8765")
 * @param updatedAt - Segment's updatedAt timestamp (for cache-busting)
 * @returns Full audio URL with cache-busting parameter
 *
 * @example
 * ```ts
 * // With cache-busting (recommended)
 * getAudioUrl("seg-123.wav", "http://localhost:8765", "2025-11-04T12:34:56")
 * // => "http://localhost:8765/audio/seg-123.wav?v=1730725896000"
 *
 * // Without cache-busting (legacy)
 * getAudioUrl("seg-123.wav", "http://localhost:8765")
 * // => "http://localhost:8765/audio/seg-123.wav"
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

  let baseUrl: string

  // Backward compatibility: Check if already a full URL
  if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
    baseUrl = audioPath
  }
  // Backward compatibility: Check if already a relative path starting with /audio/
  else if (audioPath.startsWith('/audio/')) {
    // Construct absolute URL from backendUrl + relative path
    baseUrl = `${backendUrl.replace(/\/$/, '')}${audioPath}`
  }
  // New format: Construct URL from filename
  else {
    // audioPath is just a filename like "seg-123.wav"
    baseUrl = `${backendUrl.replace(/\/$/, '')}/audio/${audioPath}`
  }

  // Cache-busting: Append version parameter based on updatedAt timestamp
  // This ensures browser fetches fresh audio after regeneration
  if (updatedAt) {
    const timestamp = new Date(updatedAt).getTime()
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}v=${timestamp}`
  }

  return baseUrl
}

/**
 * Check if audio is available for a segment
 *
 * @param audioPath - Filename or URL from segment
 * @returns True if audio exists
 */
export function hasAudio(audioPath: string | null | undefined): boolean {
  return !!audioPath
}
