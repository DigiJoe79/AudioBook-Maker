/**
 * WaveformCanvas Component
 *
 * Canvas-based waveform visualization:
 * - Renders segment peaks
 * - Shows pause blocks
 * - Playback cursor
 * - Click-to-seek
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { Box, CircularProgress, useTheme } from '@mui/material'
import { EnhancedSegmentBoundary } from '@/types'
import { WaveformRenderer } from '@/utils/waveformRenderer'
import { logger } from '@/utils/logger'

interface WaveformCanvasProps {
  boundaries: EnhancedSegmentBoundary[]
  peaks: Map<string, Float32Array>
  currentTime: number
  isLoading?: boolean
  width?: number
  height?: number
  onSeek?: (time: number) => void
}

export default function WaveformCanvas({
  boundaries,
  peaks,
  currentTime,
  isLoading = false,
  width,
  height = 80,
  onSeek,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WaveformRenderer | null>(null)
  const theme = useTheme()
  const [canvasWidth, setCanvasWidth] = useState(width || 800)
  const [isDragging, setIsDragging] = useState(false)
  const animationFrameRef = useRef<number | null>(null)

  // Track container width if width is not provided
  useEffect(() => {
    if (width !== undefined) return // Fixed width provided

    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(entry.contentRect.width)
      }
    })

    resizeObserver.observe(container)

    // Set initial width
    setCanvasWidth(container.clientWidth)

    return () => {
      resizeObserver.disconnect()
    }
  }, [width])

  // Initialize renderer once
  useEffect(() => {
    if (!canvasRef.current) return

    // Don't re-create renderer if it already exists (component remount)
    if (rendererRef.current) {
      return
    }

    const renderer = new WaveformRenderer(canvasRef.current, {
      width: canvasWidth,
      height,
      backgroundColor: theme.palette.background.default,
      waveColor: theme.palette.primary.light,
      progressColor: theme.palette.primary.main,
      cursorColor: theme.palette.primary.dark,
      pauseColor: theme.palette.mode === 'dark' ? '#4a3030' : '#ffcccc',
      autoPauseColor: theme.palette.mode === 'dark' ? '#2a2a2a' : '#e0e0e0',
    })

    rendererRef.current = renderer

    // Enable performance logging to debug rendering issues (set to true for debugging)
    renderer.setPerformanceLogging(false)

    // NO cleanup - let the renderer persist across remounts (React 18 StrictMode)
    // The ref will be reused if the component remounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update renderer when width/height/theme changes
  useEffect(() => {
    if (!rendererRef.current) return

    rendererRef.current.updateOptions({
      width: canvasWidth,
      height,
      backgroundColor: theme.palette.background.default,
      waveColor: theme.palette.primary.light,
      progressColor: theme.palette.primary.main,
      cursorColor: theme.palette.primary.dark,
      pauseColor: theme.palette.mode === 'dark' ? '#4a3030' : '#ffcccc',
      autoPauseColor: theme.palette.mode === 'dark' ? '#2a2a2a' : '#e0e0e0',
    })

    // Re-render with new dimensions
    rendererRef.current.render()
  }, [canvasWidth, height, theme])

  // Update boundaries and reset window
  useEffect(() => {
    if (!rendererRef.current) return

    // IMPORTANT: Only render if canvas has valid dimensions
    // Otherwise we render into a 0×80px canvas → invisible!
    if (canvasWidth <= 0) {
      return
    }

    rendererRef.current.setBoundaries(boundaries)
    rendererRef.current.resetWindow()
    // Force render immediately (bypasses throttling) after boundaries change
    rendererRef.current.forceRender()
  }, [boundaries, canvasWidth])

  // Update peaks
  useEffect(() => {
    if (!rendererRef.current) return

    // IMPORTANT: Only render if canvas has valid dimensions
    if (canvasWidth <= 0) {
      return
    }

    peaks.forEach((peakData, segmentId) => {
      rendererRef.current?.setPeaks(segmentId, peakData)
    })

    // Force render after peaks are loaded (bypasses throttling)
    if (peaks.size > 0) {
      rendererRef.current.forceRender()
    }
  }, [peaks.size, canvasWidth])

  // Update current time with smooth animation
  useEffect(() => {
    if (!rendererRef.current) return

    const renderer = rendererRef.current

    // Update time in renderer (this is cheap, just sets a variable)
    // The renderer will handle window re-centering if needed (in setCurrentTime)
    renderer.setCurrentTime(currentTime)

    // Normal playback → use throttled render
    // The renderer's setCurrentTime() will mark cache dirty if window scrolled
    // Only schedule ONE render at a time
    // The renderer has internal throttling to prevent excessive redraws
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(() => {
        rendererRef.current?.render()
        animationFrameRef.current = null
      })
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [currentTime])

  // Render when boundaries or peaks change
  // NOTE: peaks is a Map, so we track its size to detect changes
  useEffect(() => {
    if (!rendererRef.current) return

    // IMPORTANT: Only render if canvas has valid dimensions
    if (canvasWidth <= 0) {
      return
    }

    rendererRef.current.render()
  }, [boundaries, peaks.size, canvasWidth])

  // Handle mouse down (start drag)
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current || !onSeek) return

    setIsDragging(true)

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const time = rendererRef.current.xToTime(x)

    logger.info('WaveformCanvas', 'Seek started (drag)', { time })
    onSeek(time)
  }, [onSeek])

  // Handle mouse move (dragging)
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !rendererRef.current || !onSeek) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const time = rendererRef.current.xToTime(x)

    onSeek(time)
  }, [isDragging, onSeek])

  // Handle mouse up (end drag)
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      logger.info('WaveformCanvas', 'Seek ended (drag release)')
    }
  }, [isDragging])

  // Handle mouse leave (cancel drag)
  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      logger.info('WaveformCanvas', 'Seek cancelled (mouse left canvas)')
    }
  }, [isDragging])

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Loading indicator */}
      {isLoading && (
        <CircularProgress
          size={24}
          sx={{
            position: 'absolute',
            zIndex: 1,
          }}
        />
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={height}
        data-testid="waveform-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          cursor: onSeek ? (isDragging ? 'grabbing' : 'pointer') : 'default',
          opacity: isLoading ? 0.5 : 1,
          userSelect: 'none', // Prevent text selection during drag
        }}
      />
    </Box>
  )
}
