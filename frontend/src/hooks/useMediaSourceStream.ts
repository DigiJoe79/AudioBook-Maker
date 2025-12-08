/**
 * useMediaSourceStream Hook
 *
 * Manages audio streaming with Blob-merge approach:
 * - Merges all segments into single Blob (no MSE encoding overhead!)
 * - Pause insertion (automatic + manual)
 * - Hot-swap for regenerated segments (re-merge with cache)
 * - Smart Divider updates (only re-merge, no re-download)
 *
 * Note: This uses Blob URLs instead of true MSE because:
 * - MSE requires WebM/MP3 format (not WAV)
 * - WebM encoding is too slow (20+ minutes for 250 segments!)
 * - Blob-merge is instant and works perfectly for our use case
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { Chapter, Segment, EnhancedSegmentBoundary, MediaSourceStreamState } from '@/types'
import { logger } from '@/utils/logger'
import { getAudioUrl } from '@/utils/audioUrl'
import { createSilenceBuffer, audioBufferToWavBlob } from '@/utils/audioSilence'
import { useAppStore } from '@/store/appStore'

interface UseMediaSourceStreamOptions {
  chapter: Chapter | null
  pauseBetweenSegments: number  // ms
  onReady?: () => void
  onError?: (error: Error) => void
}

interface UseMediaSourceStreamReturn {
  audioElement: HTMLAudioElement | null
  streamState: MediaSourceStreamState
  boundaries: EnhancedSegmentBoundary[]

  // Methods
  appendSegment: (segmentId: string) => Promise<void>
  updateSegment: (segmentId: string, freshChapter?: Chapter | null) => Promise<void>
  removeSegment: (segmentId: string) => Promise<void>
  invalidateCache: (segmentId: string) => void
  destroy: () => void
}

export function useMediaSourceStream({
  chapter,
  pauseBetweenSegments,
  onReady,
  onError,
}: UseMediaSourceStreamOptions): UseMediaSourceStreamReturn {
  const backendUrl = useAppStore(state => state.connection.url)

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mergedBlobRef = useRef<Blob | null>(null)
  const objectURLRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const savedPositionRef = useRef<number>(0) // Save playback position during reload

  // State
  const [streamState, setStreamState] = useState<MediaSourceStreamState>({
    isReady: false,
    loadedUntilIndex: -1,
    pendingSegments: new Set(),
    totalDuration: 0,
    error: null,
    isLoading: false,
  })

  const [boundaries, setBoundaries] = useState<EnhancedSegmentBoundary[]>([])

  // Segment caches
  const segmentBlobsRef = useRef<Map<string, Blob>>(new Map())
  const segmentAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  const loadingSegmentsRef = useRef<Set<string>>(new Set())

  // Get AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  /**
   * Calculate timeline with pauses
   * Uses actual audio durations from loaded blobs
   * @param audioBuffers - Array of decoded audio buffers
   * @param segmentMap - Map of segment IDs to their durations
   * @param chapterData - Chapter data to use (bypasses stale closure)
   */
  const calculateTimeline = useCallback((
    audioBuffers: AudioBuffer[],
    segmentMap: Map<string, number>,
    chapterData: Chapter
  ): EnhancedSegmentBoundary[] => {
    if (!chapterData) return []

    const result: EnhancedSegmentBoundary[] = []
    let currentTime = 0
    let bufferIndex = 0

    for (let i = 0; i < chapterData.segments.length; i++) {
      const segment = chapterData.segments[i]

      if (segment.segmentType === 'divider') {
        // Manual pause segment - use pauseDuration from segment, NOT from segmentMap
        const duration = segment.pauseDuration / 1000

        result.push({
          segmentId: segment.id,
          segmentType: 'divider',
          startTime: currentTime,
          endTime: currentTime + duration,
          duration,
          isPause: true,
          isAutomatic: false,
          isLoaded: true,
          isPending: false,
        })
        currentTime += duration
        bufferIndex++ // Divider has a buffer
      } else {
        // Standard segment - use actual audio duration
        const audioDuration = segmentMap.get(segment.id)

        if (audioDuration !== undefined && audioDuration > 0) {
          // Segment has audio - add to timeline
          result.push({
            segmentId: segment.id,
            segmentType: 'standard',
            startTime: currentTime,
            endTime: currentTime + audioDuration,
            duration: audioDuration,
            audioPath: segment.audioPath || undefined,
            isPause: false,
            isLoaded: true,
            isPending: false,
          })
          currentTime += audioDuration
          bufferIndex++ // Segment has a buffer

          // Automatic pause after STANDARD segments only
          // BUT: Skip auto-pause if next segment is a divider (divider provides the pause)
          const isLastSegment = i === chapterData.segments.length - 1
          const nextSegment = !isLastSegment ? chapterData.segments[i + 1] : null
          const nextIsDivider = nextSegment?.segmentType === 'divider'

          if (!isLastSegment && !nextIsDivider && pauseBetweenSegments > 0) {
            const pauseDuration = pauseBetweenSegments / 1000
            result.push({
              segmentId: `auto-pause-${segment.id}`,
              segmentType: 'divider',
              startTime: currentTime,
              endTime: currentTime + pauseDuration,
              duration: pauseDuration,
              isPause: true,
              isAutomatic: true,
              isLoaded: true,
              isPending: false,
            })
            currentTime += pauseDuration
            bufferIndex++ // Auto-pause has a buffer
          }
        } else {
          // Segment was skipped or has no audio - don't add pause after it
          result.push({
            segmentId: segment.id,
            segmentType: 'standard',
            startTime: currentTime,
            endTime: currentTime,
            duration: 0,
            audioPath: segment.audioPath || undefined,
            isPause: false,
            isLoaded: false,
            isPending: false,
          })
          // NOTE: No currentTime increment, no auto-pause after skipped segments
        }
      }
    }

    return result
  }, [pauseBetweenSegments])

  /**
   * Load segment blob from backend
   * @param segment - Segment to load
   * @param signal - AbortSignal to cancel the request
   */
  const loadSegmentBlob = useCallback(async (segment: Segment, signal?: AbortSignal): Promise<Blob | null> => {
    if (!backendUrl) return null

    // Check if aborted before starting
    if (signal?.aborted) {
      return null
    }

    // Check cache first
    if (segmentBlobsRef.current.has(segment.id)) {
      return segmentBlobsRef.current.get(segment.id)!
    }

    // Check if already loading - wait for it to finish
    if (loadingSegmentsRef.current.has(segment.id)) {
      // Wait for the other request to finish (poll cache every 50ms)
      let attempts = 0
      while (!segmentBlobsRef.current.has(segment.id) && attempts < 100) {
        // Check abort signal during wait
        if (signal?.aborted) {
          return null
        }
        await new Promise(resolve => setTimeout(resolve, 50))
        attempts++
      }
      return segmentBlobsRef.current.get(segment.id) || null
    }

    if (segment.segmentType === 'divider') {
      // Create silence buffer for divider
      // Use AudioContext's native sample rate (usually 48kHz) to match decoded audio
      const audioContext = getAudioContext()
      const silenceBuffer = createSilenceBuffer(
        audioContext,
        segment.pauseDuration,
        audioContext.sampleRate
      )
      const blob = audioBufferToWavBlob(silenceBuffer)
      segmentBlobsRef.current.set(segment.id, blob)
      return blob
    }

    if (!segment.audioPath) {
      return null
    }

    loadingSegmentsRef.current.add(segment.id)

    try {
      const audioUrl = getAudioUrl(segment.audioPath, backendUrl, segment.updatedAt)
      if (!audioUrl) {
        throw new Error('Failed to construct audio URL')
      }

      const response = await fetch(audioUrl, { signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()
      segmentBlobsRef.current.set(segment.id, blob)
      return blob
    } catch (error) {
      // Don't log AbortError - it's expected behavior during cleanup
      if (error instanceof Error && error.name === 'AbortError') {
        return null
      }

      logger.error('[MediaSourceStream] Failed to load segment blob', {
        segmentId: segment.id,
        error,
      })
      return null
    } finally {
      loadingSegmentsRef.current.delete(segment.id)
    }
  }, [backendUrl, getAudioContext])

  /**
   * Merge all segments into a single blob
   * @param chapterOverride - Optional chapter data to use (for hot-swap with fresh data)
   * @param signal - AbortSignal to cancel the merge operation
   */
  const mergeSegments = useCallback(async (chapterOverride?: Chapter | null, signal?: AbortSignal) => {
    const chapterToUse = chapterOverride || chapter
    if (!chapterToUse) return

    try {

      // Check if aborted before starting
      if (signal?.aborted) {
        return
      }

      // Save current playback position and pause player BEFORE reload
      // This prevents visual glitches (waveform/playhead continuing while audio stops)
      if (audioRef.current) {
        savedPositionRef.current = audioRef.current.currentTime
        audioRef.current.pause() // Triggers 'pause' event → ChapterStreamPlayer sets isPlaying=false
      }

      // Set loading state
      setStreamState(prev => ({
        ...prev,
        isLoading: true,
        isReady: false,
        error: null,
      }))

      const audioContext = getAudioContext()
      const audioBuffers: AudioBuffer[] = []
      const segmentDurations = new Map<string, number>() // Track actual durations

      // Load and decode all segments
      for (let i = 0; i < chapterToUse.segments.length; i++) {
        // Check abort signal before each segment
        if (signal?.aborted) {
          // Reset saved position on abort (don't restore to invalid state)
          savedPositionRef.current = 0
          // Reset loading state
          setStreamState(prev => ({
            ...prev,
            isLoading: false,
          }))
          return
        }

        const segment = chapterToUse.segments[i]

        // Check AudioBuffer cache first (FAST PATH!)
        let audioBuffer = segmentAudioBuffersRef.current.get(segment.id)

        if (!audioBuffer) {
          // Not in AudioBuffer cache - need to load and decode
          const blob = await loadSegmentBlob(segment, signal)

          if (!blob) {
            // Mark as skipped with duration 0 (no pause will be added)
            segmentDurations.set(segment.id, 0)
            continue
          }

          const arrayBuffer = await blob.arrayBuffer()
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

          // Cache the decoded AudioBuffer for future updates
          segmentAudioBuffersRef.current.set(segment.id, audioBuffer)
        } 

        audioBuffers.push(audioBuffer)

        // Store actual duration for timeline calculation
        segmentDurations.set(segment.id, audioBuffer.duration)

        // Add automatic pause after STANDARD segments only
        // BUT: Skip auto-pause if next segment is a divider (divider provides the pause)
        const isLastSegment = i === chapterToUse.segments.length - 1
        const isStandardSegment = segment.segmentType !== 'divider'
        const nextSegment = !isLastSegment ? chapterToUse.segments[i + 1] : null
        const nextIsDivider = nextSegment?.segmentType === 'divider'

        if (!isLastSegment && isStandardSegment && !nextIsDivider && pauseBetweenSegments > 0) {
          // Use the same sample rate as the segment audio
          const pauseBuffer = createSilenceBuffer(
            audioContext,
            pauseBetweenSegments,
            audioBuffer.sampleRate
          )
          audioBuffers.push(pauseBuffer)
        }
      }

      if (audioBuffers.length === 0) {
        // No audio segments to merge - chapter has no completed audio
        // Reset saved position (no audio to restore to)
        savedPositionRef.current = 0
        setStreamState(prev => ({
          ...prev,
          isReady: false,
          isLoading: false,
          error: 'NO_AUDIO',
        }))
        return
      }

      // Calculate total length
      const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0)
      const sampleRate = audioBuffers[0].sampleRate
      const numberOfChannels = audioBuffers[0].numberOfChannels

      // Create merged buffer
      const mergedBuffer = audioContext.createBuffer(
        numberOfChannels,
        totalLength,
        sampleRate
      )

      // Copy all buffers
      let offset = 0
      for (const buffer of audioBuffers) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sourceData = buffer.getChannelData(channel)
          const destData = mergedBuffer.getChannelData(channel)
          destData.set(sourceData, offset)
        }
        offset += buffer.length
      }

      // Convert to blob
      const mergedBlob = audioBufferToWavBlob(mergedBuffer)
      mergedBlobRef.current = mergedBlob

      // Create object URL
      if (objectURLRef.current) {
        URL.revokeObjectURL(objectURLRef.current)
      }
      const objectURL = URL.createObjectURL(mergedBlob)
      objectURLRef.current = objectURL

      // Update audio element
      if (audioRef.current) {
        audioRef.current.src = objectURL

        // Restore playback position after reload (if valid)
        // Wait for 'loadedmetadata' event to ensure duration is available
        if (savedPositionRef.current > 0) {
          audioRef.current.addEventListener('loadedmetadata', function restorePosition() {
            if (audioRef.current) {
              // Clamp position to valid range (in case chapter got shorter)
              const restoredPosition = Math.min(savedPositionRef.current, audioRef.current.duration)
              audioRef.current.currentTime = restoredPosition
              savedPositionRef.current = 0 // Reset after restore
            }
            // Remove listener after first call
            audioRef.current?.removeEventListener('loadedmetadata', restorePosition)
          }, { once: true })
        }
      }

      // Update state with actual durations
      // Pass chapterToUse to ensure fresh data (bypasses stale closure)
      const timeline = calculateTimeline(audioBuffers, segmentDurations, chapterToUse)
      setBoundaries(timeline)

      setStreamState(prev => ({
        ...prev,
        isReady: true,
        loadedUntilIndex: chapterToUse?.segments.length ? chapterToUse.segments.length - 1 : -1,
        totalDuration: mergedBuffer.duration,
      }))

      // Mark as ready and clear loading
      setStreamState(prev => ({
        ...prev,
        isLoading: false,
      }))

      onReady?.()
    } catch (error) {
      logger.error('[MediaSourceStream] Merge failed', { error })
      // Reset saved position on error (don't restore to invalid state)
      savedPositionRef.current = 0
      const err = error instanceof Error ? error : new Error(String(error))
      setStreamState(prev => ({
        ...prev,
        error: err,
        isLoading: false,
        isReady: false,
      }))
      onError?.(err)
    }
  }, [chapter, pauseBetweenSegments, loadSegmentBlob, getAudioContext, calculateTimeline, onReady, onError])

  /**
   * Initialize audio element and merge segments
   */
  useEffect(() => {
    if (!chapter) return

    // Abort previous chapter's loading
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new AbortController for this chapter
    const controller = new AbortController()
    abortControllerRef.current = controller

    let mounted = true

    async function init() {
      if (!chapter) return

      try {

        // Clean up old audio element
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ''
          audioRef.current.load() // Reset audio element state
        }

        // Reset saved position (new chapter = start from beginning)
        savedPositionRef.current = 0

        // Revoke old object URL to prevent memory leak
        if (objectURLRef.current) {
          URL.revokeObjectURL(objectURLRef.current)
          objectURLRef.current = null
        }

        // Close old AudioContext to prevent memory leak
        if (audioContextRef.current) {
          await audioContextRef.current.close()
          audioContextRef.current = null
        }

        // Clear caches for previous chapter
        segmentBlobsRef.current.clear()
        segmentAudioBuffersRef.current.clear()
        loadingSegmentsRef.current.clear()
        mergedBlobRef.current = null

        // Create new audio element
        const audio = new Audio()
        audioRef.current = audio

        // Merge all segments with abort signal
        // IMPORTANT: Pass chapter explicitly to avoid stale closure
        await mergeSegments(chapter, controller.signal)

        if (!mounted) return

      } catch (error) {
        logger.error('[MediaSourceStream] Failed to initialize', { error })
        if (mounted) {
          const err = error instanceof Error ? error : new Error(String(error))
          setStreamState(prev => ({
            ...prev,
            error: err,
          }))
          onError?.(err)
        }
      }
    }

    init()

    return () => {
      mounted = false
      // Abort loading when component unmounts or chapter changes
      controller.abort()
    }
    // Only re-run when chapter ID changes, not when callbacks change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  /**
   * Append segment (for progressive loading)
   * In this simplified version, we just reload all segments
   */
  const appendSegment = useCallback(async (_segmentId: string) => {
    // For MVP: Just trigger a full reload
    await mergeSegments()
  }, [mergeSegments])

  /**
   * Update segment (hot-swap)
   * For Divider: Clear cache + re-merge (FAST - only regenerates silence)
   * For Standard segment: Clear cache + re-merge (downloads new audio)
   * @param segmentId - ID of segment to update
   * @param freshChapter - Optional fresh chapter data (for immediate update after refetch)
   */
  const updateSegment = useCallback(async (segmentId: string, freshChapter?: Chapter | null) => {
    // Clear caches for this segment (both Blob and AudioBuffer)
    segmentBlobsRef.current.delete(segmentId)
    segmentAudioBuffersRef.current.delete(segmentId)

    // Re-merge all segments (uses AudioBuffer cache for unchanged segments = FAST!)
    // If freshChapter is provided, use it immediately (don't wait for React state update)
    await mergeSegments(freshChapter)
  }, [mergeSegments])

  /**
   * Remove segment
   */
  const removeSegment = useCallback(async (segmentId: string) => {
    // Clear caches
    segmentBlobsRef.current.delete(segmentId)
    segmentAudioBuffersRef.current.delete(segmentId)

    // Reload all segments
    await mergeSegments()
  }, [mergeSegments])

  /**
   * Invalidate cache for a segment (used by central update hook)
   */
  const invalidateCache = useCallback((segmentId: string) => {
    segmentBlobsRef.current.delete(segmentId)
    segmentAudioBuffersRef.current.delete(segmentId)
  }, [])

  /**
   * Cleanup
   */
  const destroy = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }

    if (objectURLRef.current) {
      URL.revokeObjectURL(objectURLRef.current)
      objectURLRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    segmentBlobsRef.current.clear()
    segmentAudioBuffersRef.current.clear()
    loadingSegmentsRef.current.clear()
    mergedBlobRef.current = null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroy()
    }
  }, [destroy])

  return {
    audioElement: audioRef.current,
    streamState,
    boundaries,
    appendSegment,
    updateSegment,
    removeSegment,
    invalidateCache,
    destroy,
  }
}
