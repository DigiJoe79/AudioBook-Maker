/**
 * AudioPlayer Component
 *
 * Entry point for audio playback.
 * Delegates to ChapterStreamPlayer (MSE-based).
 */

import React, { RefObject, memo } from 'react'
import { Segment } from '@/types'
import ChapterStreamPlayer from './ChapterStreamPlayer'

interface AudioPlayerProps {
  chapterId: string | null
  seekToSegmentId?: string | null
  seekTrigger?: number
  playingSegmentId?: string | null
  audioRef: RefObject<HTMLAudioElement>
  onPlaySegment?: (segment: Segment, continuous?: boolean) => void
  onStopPlayback?: () => void
  onCurrentSegmentChange?: (segmentId: string | null) => void
}

const AudioPlayer = memo(function AudioPlayer({
  chapterId,
  seekToSegmentId,
  seekTrigger,
  onCurrentSegmentChange,
}: AudioPlayerProps) {
  // Note: audioRef prop is accepted but not used - ChapterStreamPlayer manages its own audio element.
  // The audioRef from useAudioPlayback is used separately for single-segment playback (play buttons).

  return (
    <ChapterStreamPlayer
      chapterId={chapterId}
      seekToSegmentId={seekToSegmentId}
      seekTrigger={seekTrigger}
      onCurrentSegmentChange={onCurrentSegmentChange}
    />
  )
}, (prevProps, nextProps) => {
  // Re-render if chapter ID or seek changes
  return (
    prevProps.chapterId === nextProps.chapterId &&
    prevProps.seekToSegmentId === nextProps.seekToSegmentId &&
    prevProps.seekTrigger === nextProps.seekTrigger
  )
})

export default AudioPlayer
