/**
 * AudioPlayerContext
 *
 * Provides access to the AudioPlayer's updateSegment function
 * for centralized SSE event handling.
 *
 * Architecture:
 * - ChapterStreamPlayer exposes updateSegment via this context
 * - useSSESegmentHandlers can trigger updates without direct coupling
 * - Maintains separation of concerns (SSE handlers don't know about player internals)
 */

import React, { createContext, useContext, ReactNode, useCallback, useRef, useMemo } from 'react'

interface AudioPlayerContextValue {
  /**
   * Register the updateSegment function from the active AudioPlayer
   * Only one player can be active at a time (the one in MainView)
   */
  registerUpdateSegment: (updateFn: (segmentId: string) => Promise<void>) => void

  /**
   * Trigger audio/waveform update for a segment
   * @param segmentId - Segment ID to update, or empty string for full chapter update
   */
  triggerUpdate: (segmentId: string) => Promise<void>
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

interface AudioPlayerProviderProps {
  children: ReactNode
}

export function AudioPlayerProvider({ children }: AudioPlayerProviderProps) {
  // Store the latest updateSegment function from the active player
  const updateSegmentRef = useRef<((segmentId: string) => Promise<void>) | null>(null)

  const registerUpdateSegment = useCallback((updateFn: (segmentId: string) => Promise<void>) => {
    updateSegmentRef.current = updateFn
  }, [])

  const triggerUpdate = useCallback(async (segmentId: string) => {
    if (updateSegmentRef.current) {
      await updateSegmentRef.current(segmentId)
    }
  }, [])

  const contextValue = useMemo(
    () => ({ registerUpdateSegment, triggerUpdate }),
    [registerUpdateSegment, triggerUpdate]
  )

  return (
    <AudioPlayerContext.Provider value={contextValue}>
      {children}
    </AudioPlayerContext.Provider>
  )
}

/**
 * Hook to access AudioPlayer context
 * @throws Error if used outside AudioPlayerProvider
 */
export function useAudioPlayerContext(): AudioPlayerContextValue {
  const context = useContext(AudioPlayerContext)
  if (!context) {
    throw new Error('useAudioPlayerContext must be used within AudioPlayerProvider')
  }
  return context
}
