/**
 * useSegmentPeaks Hook
 *
 * Loads and extracts waveform peaks for segments:
 * - Async/progressive loading
 * - Caching
 * - SSE integration (auto-load when segment completed)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Chapter, Segment } from '@/types'
import { logger } from '@/utils/logger'
import { getAudioUrl } from '@/utils/audioUrl'
import { useAppStore } from '@/store/appStore'

interface UseSegmentPeaksOptions {
  chapter: Chapter | null
  peaksPerSecond?: number  // Number of peak samples per second of audio (default: 100)
}

interface UseSegmentPeaksReturn {
  peaks: Map<string, Float32Array>
  isLoading: boolean
  error: Error | null

  // Methods
  loadPeaksForSegment: (segmentId: string, freshChapter?: Chapter | null) => Promise<void>
  invalidatePeaks: (segmentId: string) => void
}

export function useSegmentPeaks({
  chapter,
  peaksPerSecond = 100,
}: UseSegmentPeaksOptions): UseSegmentPeaksReturn {
  const backendUrl = useAppStore(state => state.connection.url)

  const [peaks, setPeaks] = useState<Map<string, Float32Array>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const loadingSegmentsRef = useRef<Set<string>>(new Set())

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  /**
   * Extract peaks from AudioBuffer
   */
  const extractPeaks = useCallback((buffer: AudioBuffer, numPeaks: number): Float32Array => {
    const peaks = new Float32Array(numPeaks)
    const samplesPerPeak = Math.floor(buffer.length / numPeaks)

    for (let i = 0; i < numPeaks; i++) {
      const start = i * samplesPerPeak
      const end = Math.min(start + samplesPerPeak, buffer.length)

      let maxPeak = 0

      // Find max across all channels
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const channelData = buffer.getChannelData(ch)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j])
          if (abs > maxPeak) maxPeak = abs
        }
      }

      peaks[i] = maxPeak
    }

    return peaks
  }, [])

  /**
   * Load peaks for a single segment
   * @param segmentId - ID of segment to load peaks for
   * @param freshChapter - Optional fresh chapter data (bypasses stale closure)
   */
  const loadPeaksForSegment = useCallback(async (segmentId: string, freshChapter?: Chapter | null) => {
    // Use fresh chapter if provided, otherwise use closure chapter
    const chapterToUse = freshChapter || chapter

    if (!chapterToUse || !backendUrl) {
      logger.warn('SegmentPeaks', 'Cannot load: chapter or backendUrl missing')
      return
    }

    // Check if already loading
    if (loadingSegmentsRef.current.has(segmentId)) {
      return
    }

    const segment = chapterToUse.segments.find(s => s.id === segmentId)

    // Debug: Log whether we're using fresh or stale data
    if (freshChapter) {
      logger.info('SegmentPeaks', 'Loading peaks with FRESH chapter data', {
        segmentId,
        hasAudioPath: !!segment?.audioPath,
        updatedAt: segment?.updatedAt,
      })
    }
    if (!segment) {
      logger.warn('SegmentPeaks', 'Segment not found', { segmentId })
      return
    }

    // Skip pause segments
    if (segment.segmentType === 'divider') {
      return
    }

    if (!segment.audioPath) {
      logger.warn('SegmentPeaks', 'No audio path', { segmentId })
      return
    }

    loadingSegmentsRef.current.add(segmentId)
    setIsLoading(true)

    try {
      const audioUrl = getAudioUrl(segment.audioPath, backendUrl, segment.updatedAt)
      if (!audioUrl) {
        throw new Error('Failed to construct audio URL')
      }

      // Fetch audio
      const response = await fetch(audioUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Decode audio
      const arrayBuffer = await response.arrayBuffer()
      const audioContext = getAudioContext()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      // Calculate number of peaks based on audio duration
      // This ensures consistent visual density across all segments
      const numPeaks = Math.max(10, Math.round(audioBuffer.duration * peaksPerSecond))

      // Extract peaks
      const segmentPeaks = extractPeaks(audioBuffer, numPeaks)

      // Update state
      setPeaks(prev => {
        // Check again if already loaded (race condition prevention)
        if (prev.has(segmentId)) {
          return prev
        }
        return new Map(prev).set(segmentId, segmentPeaks)
      })
    } catch (err) {
      logger.error('SegmentPeaks', 'Failed to load peaks', {
        segmentId,
        error: err,
      })
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      loadingSegmentsRef.current.delete(segmentId)
      setIsLoading(loadingSegmentsRef.current.size > 0)
    }
  }, [chapter, backendUrl, peaksPerSecond, extractPeaks, getAudioContext])

  /**
   * Invalidate peaks for a segment (e.g., after regeneration)
   */
  const invalidatePeaks = useCallback((segmentId: string) => {
    setPeaks(prev => {
      const next = new Map(prev)
      next.delete(segmentId)
      return next
    })
  }, [])

  /**
   * Memoized hash of segment IDs with audio - prevents effect from re-running
   * on every segment update (text, speaker changes, etc.)
   */
  const audioSegmentHash = useMemo(
    () => chapter?.segments
      .filter(s => s.segmentType !== 'divider' && s.audioPath)
      .map(s => s.id)
      .join('|'),
    [chapter?.segments]
  )

  /**
   * Auto-load peaks for all segments on mount AND when segments get audio
   */
  useEffect(() => {
    if (!chapter) return

    // Track if this effect has already loaded peaks for this chapter
    let isMounted = true

    // Load peaks progressively for segments that have audio but no peaks yet
    const loadAll = async () => {
      for (const segment of chapter.segments) {
        if (!isMounted) break
        if (segment.segmentType !== 'divider' && segment.audioPath) {
          // Only load if we don't have peaks for this segment yet
          if (!peaks.has(segment.id)) {
            await loadPeaksForSegment(segment.id)
          }
        }
      }
    }

    loadAll()

    return () => {
      isMounted = false
    }
  }, [chapter, audioSegmentHash, peaks, loadPeaksForSegment])

  /**
   * Cleanup
   */
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [])

  return {
    peaks,
    isLoading,
    error,
    loadPeaksForSegment,
    invalidatePeaks,
  }
}
