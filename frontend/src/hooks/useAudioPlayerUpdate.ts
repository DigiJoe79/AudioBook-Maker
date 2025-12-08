/**
 * useAudioPlayerUpdate Hook
 *
 * Central hook for coordinating audio + waveform updates.
 * Handles all update scenarios:
 * - New segment generation
 * - Segment regeneration
 * - Divider pauseDuration edit
 * - Segment deletion (triggers chapter-level update)
 *
 * Architecture:
 * 1. Refetch chapter data (once, from React Query)
 * 2. Invalidate caches (audio blobs + peaks)
 * 3. Update audio stream (always)
 * 4. Update peaks (only for standard segments)
 */

import { useCallback } from 'react'
import { useChapter } from '@/hooks/useChaptersQuery'
import { logger } from '@/utils/logger'
import type { Chapter } from '@types'

interface UseAudioPlayerUpdateOptions {
  chapterId: string | null
  updateAudioStream: (segmentId: string, freshChapter?: Chapter) => Promise<void>
  invalidateAudioCache: (segmentId: string) => void
  updatePeaks: (segmentId: string, freshChapter?: Chapter) => Promise<void>
  invalidatePeaksCache: (segmentId: string) => void
}

interface UseAudioPlayerUpdateReturn {
  /**
   * Update audio and waveform for a specific segment
   * @param segmentId - Segment ID to update, or empty string for chapter-level update
   */
  updateSegment: (segmentId: string) => Promise<void>
}

export function useAudioPlayerUpdate({
  chapterId,
  updateAudioStream,
  invalidateAudioCache,
  updatePeaks,
  invalidatePeaksCache,
}: UseAudioPlayerUpdateOptions): UseAudioPlayerUpdateReturn {
  // React Query chapter refetch
  const { refetch } = useChapter(chapterId)

  /**
   * Central update function
   * Sequential: Audio first (needed for peaks), then peaks
   */
  const updateSegment = useCallback(async (segmentId: string) => {
    if (!chapterId) {
      logger.warn('AudioPlayerUpdate', 'No chapterId provided, skipping update')
      return
    }

    try {
      // 1. Refetch chapter data (ONCE)
      // This ensures we have fresh data for both audio and peaks
      const result = await refetch()

      if (!result.data) {
        logger.error('AudioPlayerUpdate', 'Refetch returned no data', { segmentId })
        return
      }

      // Handle chapter-level updates (e.g., segment deletion)
      if (!segmentId) {

        // Full re-merge without specific segment logic
        await updateAudioStream('', result.data)
        return
      }

      // 2. Find segment in fresh data
      const segment = result.data.segments.find(s => s.id === segmentId)
      if (!segment) {
        logger.error('AudioPlayerUpdate', 'Segment not found in refetched data', {
          segmentId,
        })
        return
      }

      // 3. Clear caches for this segment
      invalidateAudioCache(segmentId)
      invalidatePeaksCache(segmentId)

      // 4. Update audio stream (always needed)
      await updateAudioStream(segmentId, result.data)

      // 5. Update peaks (only for standard segments)
      // Dividers have no waveform peaks (flatline is drawn by WaveformRenderer)
      if (segment.segmentType !== 'divider') {
        await updatePeaks(segmentId, result.data)
      } 
    } catch (error) {
      logger.error('AudioPlayerUpdate', 'Update failed', {
        segmentId,
        error,
      })
    }
  }, [
    chapterId,
    refetch,
    updateAudioStream,
    invalidateAudioCache,
    updatePeaks,
    invalidatePeaksCache,
  ])

  return {
    updateSegment,
  }
}
