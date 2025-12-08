import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@store/appStore'
import { useError } from '@hooks/useError'
import { useSnackbar } from '@hooks/useSnackbar'
import { getAudioUrl } from '@utils/audioUrl'
import { logger } from '@utils/logger'
import type { Segment, Chapter } from '@types'

interface UseAudioPlaybackOptions {
  selectedChapter: Chapter | undefined
  showError: (title: string, message: string) => Promise<void>
}

interface UseAudioPlaybackReturn {
  // State
  playingSegmentId: string | null
  continuousPlayback: boolean
  seekToSegmentId: string | null
  seekTrigger: number

  // Refs
  audioRef: React.RefObject<HTMLAudioElement>

  // Handlers
  handlePlaySegment: (segment: Segment, continuous?: boolean) => void
  handleSegmentClick: (segmentId: string) => void
  handleStopPlayback: () => void
  setPlayingSegmentId: (id: string | null) => void
}

/**
 * Hook for managing audio playback in AppLayout
 *
 * Responsibilities:
 * - Audio element management
 * - Segment playback (single and continuous)
 * - Auto-play logic (play next segments automatically)
 * - Pause segment handling (dividers with pause duration)
 * - Seek to segment functionality
 */
export function useAudioPlayback({
  selectedChapter,
  showError,
}: UseAudioPlaybackOptions): UseAudioPlaybackReturn {
  const { t } = useTranslation()
  const { showSnackbar } = useSnackbar()

  // Global settings
  const backendUrl = useAppStore((state) => state.connection.url)
  const settings = useAppStore((state) => state.settings)
  const pauseBetweenSegments = settings?.audio.pauseBetweenSegments ?? 500

  // State
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null)
  const [continuousPlayback, setContinuousPlayback] = useState(false)
  const [seekToSegmentId, setSeekToSegmentId] = useState<string | null>(null)
  const [seekTrigger, setSeekTrigger] = useState(0)

  // Refs
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const selectedChapterRef = useRef<typeof selectedChapter>(undefined)
  const currentPlayingSegmentIdRef = useRef<string | null>(null)
  const continuousPlaybackRef = useRef<boolean>(false)
  const handlePlaySegmentRef = useRef<((segment: Segment, continuous?: boolean) => void) | undefined>(undefined)
  const pauseTimeoutRef = useRef<number | null>(null)

  // Keep refs in sync
  useEffect(() => {
    selectedChapterRef.current = selectedChapter
  }, [selectedChapter])

  useEffect(() => {
    handlePlaySegmentRef.current = handlePlaySegmentInternal
  })

  // Cleanup audio on unmount
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      audio.pause()
      audio.src = ''
      audio.load()
    }
  }, [])

  // Handle segment click - seek to segment
  const handleSegmentClick = useCallback((segmentId: string) => {
    setSeekToSegmentId(segmentId)
    setSeekTrigger(prev => prev + 1)
  }, [])

  // Stop playback
  const handleStopPlayback = useCallback(() => {
    const audio = audioRef.current
    audio.pause()
    audio.currentTime = 0
    setPlayingSegmentId(null)
    currentPlayingSegmentIdRef.current = null
    setContinuousPlayback(false)
    continuousPlaybackRef.current = false

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }
  }, [])

  /**
   * Internal audio playback handler
   *
   * @param segment - The segment to play
   * @param continuous - If true, automatically play next segments (autoplay mode)
   */
  const handlePlaySegmentInternal = useCallback((segment: Segment, continuous = false) => {
    if (!segment.audioPath) return

    const audioUrl = getAudioUrl(segment.audioPath, backendUrl, segment.updatedAt)
    if (!audioUrl) {
      logger.error('[PlaySegment] Failed to construct audio URL', {
        audioPath: segment.audioPath,
        backendUrl,
        updatedAt: segment.updatedAt
      })
      showSnackbar(t('audioPlayer.urlError'), { severity: 'error' })
      return
    }

    const audio = audioRef.current

    // Set continuous playback mode
    if (import.meta.env.DEV) {
      logger.group(
        '🎵 Playback',
        'Starting playback',
        {
          segmentId: segment.id,
          continuous,
          mode: continuous ? 'AUTOPLAY MODE' : 'SINGLE SEGMENT MODE',
          audioUrl
        },
        '#2196F3'
      )
    }
    setContinuousPlayback(continuous)
    continuousPlaybackRef.current = continuous

    // Toggle behavior - if clicking same segment, stop it
    if (playingSegmentId === segment.id) {
      audio.pause()
      audio.currentTime = 0
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false

      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current)
        pauseTimeoutRef.current = null
      }
      return
    }

    // Stop current playback and clean up
    audio.pause()
    audio.currentTime = 0

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }

    // Remove existing event listeners
    audio.onended = null
    audio.onerror = null

    // Set new source
    audio.src = audioUrl
    audio.load()

    // Set up ended handler for auto-play
    audio.onended = () => {
      const currentChapter = selectedChapterRef.current
      const currentSegmentId = currentPlayingSegmentIdRef.current
      const isContinuous = continuousPlaybackRef.current

      if (import.meta.env.DEV) {
        logger.debug('[Auto-Play] Segment ended', {
          hasChapter: !!currentChapter,
          currentSegmentId,
          totalSegments: currentChapter?.segments.length,
          continuousPlayback: isContinuous
        })
      }

      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null

      // Stop if not in continuous mode
      if (!isContinuous) {
        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] Single segment mode - stopping playback')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      if (!currentChapter || !currentSegmentId) {
        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] No chapter or segment ID, stopping')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      const currentIndex = currentChapter.segments.findIndex(s => s.id === currentSegmentId)
      if (import.meta.env.DEV) {
        logger.debug('[Auto-Play] Current index', { currentIndex })
      }

      if (currentIndex === -1) {
        if (import.meta.env.DEV) {
          logger.warn('[Auto-Play] Segment not found in chapter, stopping')
        }
        setContinuousPlayback(false)
        continuousPlaybackRef.current = false
        return
      }

      // Helper function to find and play next segment
      const playNextSegmentInAutoPlay = (startIndex: number) => {
        if (startIndex >= currentChapter.segments.length) {
          if (import.meta.env.DEV) {
            logger.group(
              '🎵 Playback',
              'Reached end of chapter',
              { continuousPlayback: false },
              '#FF9800'
            )
          }
          setContinuousPlayback(false)
          continuousPlaybackRef.current = false
          return
        }

        const nextSegment = currentChapter.segments[startIndex]

        if (import.meta.env.DEV) {
          logger.debug('[Auto-Play] Next segment:', {
            index: startIndex,
            segmentId: nextSegment?.id,
            segmentType: nextSegment?.segmentType,
            hasAudio: !!nextSegment?.audioPath,
            pauseDuration: nextSegment?.pauseDuration
          })
        }

        // Handle divider (pause) segment
        if (nextSegment?.segmentType === 'divider') {
          const pauseDuration = nextSegment?.pauseDuration || 0
          if (import.meta.env.DEV) {
            logger.debug('[Auto-Play] Pause segment detected', { pauseDuration })
          }

          if (pauseTimeoutRef.current) {
            clearTimeout(pauseTimeoutRef.current)
            pauseTimeoutRef.current = null
          }

          pauseTimeoutRef.current = window.setTimeout(() => {
            if (!continuousPlaybackRef.current) {
              if (import.meta.env.DEV) {
                logger.debug('[Auto-Play] Continuous playback stopped during pause, aborting')
              }
              pauseTimeoutRef.current = null
              return
            }

            pauseTimeoutRef.current = null
            playNextSegmentInAutoPlay(startIndex + 1)
          }, pauseDuration)
          return
        }

        // Regular audio segment
        if (nextSegment?.audioPath) {
          setTimeout(() => {
            if (import.meta.env.DEV) {
              logger.debug('[Auto-Play] Playing audio segment', { segmentId: nextSegment.id })
            }
            handlePlaySegmentRef.current?.(nextSegment, true)
          }, pauseBetweenSegments)
        } else {
          // Skip segments without audio
          if (import.meta.env.DEV) {
            logger.group(
              '🎵 Playback',
              'Skipping segment without audio',
              { segmentId: nextSegment?.id, tryingNext: true },
              '#FF9800'
            )
          }
          playNextSegmentInAutoPlay(startIndex + 1)
        }
      }

      // Start auto-play from next segment
      playNextSegmentInAutoPlay(currentIndex + 1)
    }

    // Error handler
    audio.onerror = (e) => {
      if (!currentPlayingSegmentIdRef.current) {
        if (import.meta.env.DEV) {
          logger.debug('[Audio] Error ignored (no active segment)', { error: e })
        }
        return
      }

      logger.error('[Audio] Playback error', { error: e })
      showError(
        t('audioPlayer.error'),
        t('appLayout.audioPlaybackError')
      )
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false
    }

    // Play
    audio.play().catch((err) => {
      if (err.name === 'AbortError') {
        if (import.meta.env.DEV) {
          logger.debug('[PlaySegment] Play aborted (normal during fast skipping)')
        }
        return
      }

      logger.error('[Audio] Failed to play', { error: err })
      showError(
        t('audioPlayer.error'),
        t('appLayout.audioPlaybackErrorDetailed', { message: err.message })
      )
      setPlayingSegmentId(null)
      currentPlayingSegmentIdRef.current = null
      setContinuousPlayback(false)
      continuousPlaybackRef.current = false
    })

    setPlayingSegmentId(segment.id)
    currentPlayingSegmentIdRef.current = segment.id
  }, [backendUrl, pauseBetweenSegments, playingSegmentId, showError, showSnackbar, t])

  // Public wrapper that uses ref for latest version
  const handlePlaySegment = useCallback((segment: Segment, continuous = false) => {
    handlePlaySegmentRef.current?.(segment, continuous)
  }, [])

  return {
    playingSegmentId,
    continuousPlayback,
    seekToSegmentId,
    seekTrigger,
    audioRef,
    handlePlaySegment,
    handleSegmentClick,
    handleStopPlayback,
    setPlayingSegmentId,
  }
}