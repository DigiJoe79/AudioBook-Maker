/**
 * usePlayerHotkeys Hook
 *
 * Keyboard shortcuts for audio player:
 * - Space: Play/Pause
 * - Left/Up: Previous segment (or seek to start of current segment)
 * - Right/Down: Next segment
 *
 * Only active when player is ready and not in a text input
 */

import { useEffect } from 'react'
import { logger } from '@/utils/logger'

interface UsePlayerHotkeysOptions {
  isEnabled: boolean          // Player is ready
  onPlayPause: () => void
  onPreviousSegment: () => void
  onNextSegment: () => void
}

export function usePlayerHotkeys({
  isEnabled,
  onPlayPause,
  onPreviousSegment,
  onNextSegment,
}: UsePlayerHotkeysOptions) {
  useEffect(() => {
    if (!isEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Space: Play/Pause
      if (event.code === 'Space') {
        event.preventDefault()
        logger.info('PlayerHotkeys', 'Space pressed - toggle play/pause')
        onPlayPause()
        return
      }

      // Left/Up: Previous segment
      if (event.code === 'ArrowLeft' || event.code === 'ArrowUp') {
        event.preventDefault()
        logger.info('PlayerHotkeys', 'Left/Up pressed - previous segment')
        onPreviousSegment()
        return
      }

      // Right/Down: Next segment
      if (event.code === 'ArrowRight' || event.code === 'ArrowDown') {
        event.preventDefault()
        logger.info('PlayerHotkeys', 'Right/Down pressed - next segment')
        onNextSegment()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isEnabled, onPlayPause, onPreviousSegment, onNextSegment])
}
