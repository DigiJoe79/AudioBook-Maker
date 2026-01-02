/**
 * Canvas Waveform Renderer
 * Renders waveform peaks to canvas with segment boundaries
 */

import { EnhancedSegmentBoundary } from '@/types'
import { logger } from '@/utils/logger'

interface WaveformRenderOptions {
  width: number
  height: number
  waveColor: string
  progressColor: string
  pauseColor: string
  autoPauseColor: string
  backgroundColor: string
  cursorColor: string
}

const DEFAULT_OPTIONS: WaveformRenderOptions = {
  width: 800,
  height: 80,
  waveColor: '#4a90e2',
  progressColor: '#1976d2',
  pauseColor: '#ffcccc',
  autoPauseColor: '#e0e0e0',
  backgroundColor: '#ffffff',
  cursorColor: '#1976d2',
}

export class WaveformRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private options: WaveformRenderOptions

  // Offscreen canvas for caching waveform (performance optimization)
  private waveformCache: HTMLCanvasElement | null = null
  private waveformCacheCtx: CanvasRenderingContext2D | null = null
  private waveformCacheDirty: boolean = true
  private cachedWindowStart: number = 0 // Track last cached window position

  private boundaries: EnhancedSegmentBoundary[] = []
  private peaks: Map<string, Float32Array> = new Map()
  private totalDuration: number = 0
  private currentTime: number = 0

  // Scrolling window settings
  private windowDuration: number = 60 // Show 1 minute window
  private windowStart: number = 0 // Current window start time

  // Performance optimization: Throttle rendering
  private lastRenderTime: number = 0
  private renderThrottleMs: number = 40 // ~25fps (1000ms / 25fps = 40ms) - smoother than 30fps for heavy redraws

  // Performance optimization: Smart scroll detection
  // NOTE: Disabled threshold for smooth scrolling - cache is redrawn on ANY scroll
  // The render throttling (30fps) already prevents excessive redraws
  private readonly SCROLL_THRESHOLD_PX = 0 // Always redraw when window scrolls
  private lastWindowStartPx: number = 0

  // Performance metrics (optional, for debugging)
  private enablePerformanceLogging: boolean = false
  private renderCount: number = 0
  private fullRedrawCount: number = 0
  private shiftRedrawCount: number = 0
  private skippedRenderCount: number = 0

  constructor(canvas: HTMLCanvasElement, options?: Partial<WaveformRenderOptions>) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context')
    }
    this.ctx = ctx
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Create offscreen canvas for waveform caching
    this.createWaveformCache()
  }

  /**
   * Create offscreen canvas for caching waveform
   */
  private createWaveformCache(): void {
    this.waveformCache = document.createElement('canvas')
    this.waveformCache.width = this.options.width
    this.waveformCache.height = this.options.height
    const ctx = this.waveformCache.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get cache canvas 2D context')
    }
    this.waveformCacheCtx = ctx
  }

  /**
   * Update renderer options (e.g., after resize)
   */
  updateOptions(options: Partial<WaveformRenderOptions>): void {
    this.options = { ...this.options, ...options }

    // Recreate cache with new dimensions if size changed
    if (options.width !== undefined || options.height !== undefined) {
      this.createWaveformCache()
      this.waveformCacheDirty = true
    }
  }

  /**
   * Enable or disable performance logging (for debugging)
   */
  setPerformanceLogging(enabled: boolean): void {
    this.enablePerformanceLogging = enabled
    if (enabled) {
      logger.debug('[WaveformRenderer] Performance logging enabled')
      // Reset counters
      this.renderCount = 0
      this.fullRedrawCount = 0
      this.shiftRedrawCount = 0
      this.skippedRenderCount = 0
    }
  }

  /**
   * Set segment boundaries (timeline structure)
   */
  setBoundaries(boundaries: EnhancedSegmentBoundary[]): void {
    this.boundaries = boundaries
    this.totalDuration = boundaries[boundaries.length - 1]?.endTime || 0
    this.waveformCacheDirty = true // Boundaries changed, need to redraw waveform
  }

  /**
   * Set peaks for a segment
   */
  setPeaks(segmentId: string, peaks: Float32Array): void {
    this.peaks.set(segmentId, peaks)
    this.waveformCacheDirty = true // Peaks changed, need to redraw waveform
  }

  /**
   * Update current playback time and scroll window if needed
   */
  setCurrentTime(time: number): void {
    const oldWindowStart = this.windowStart
    this.currentTime = time

    // Auto-scroll window to keep playhead centered after it reaches 50%
    const playheadPosition = time - this.windowStart
    const halfWindow = this.windowDuration / 2

    // IMPORTANT: Handle both forward auto-scroll AND backward seeks
    // If playhead is outside the visible window (seek backward/forward), re-center the window
    const isOutsideWindow = playheadPosition < 0 || playheadPosition > this.windowDuration

    if (isOutsideWindow) {
      // Playhead jumped outside visible window (seek) → re-center window
      this.windowStart = Math.max(0, time - halfWindow)
      this.waveformCacheDirty = true // Force redraw after seek
    } else if (playheadPosition > halfWindow && time < this.totalDuration - halfWindow) {
      // Normal auto-scroll: once playhead passes the center, start scrolling forward
      this.windowStart = time - halfWindow
    }

    // Clamp window to valid range
    this.windowStart = Math.max(0, Math.min(this.windowStart, this.totalDuration - this.windowDuration))

    // Debug: Log when window position changes
    if (this.enablePerformanceLogging && Math.abs(this.windowStart - oldWindowStart) > 0.001) {
      logger.debug('[WaveformRenderer] Window scroll', {
        oldWindowStart: oldWindowStart.toFixed(3),
        newWindowStart: this.windowStart.toFixed(3),
        delta: (this.windowStart - oldWindowStart).toFixed(3),
        currentTime: time.toFixed(3),
      })
    }
  }

  /**
   * Reset window position to start
   */
  resetWindow(): void {
    this.windowStart = 0
    this.currentTime = 0
  }

  /**
   * Seek to a specific segment by ID
   * Returns the start time of the segment, or null if not found
   */
  seekToSegment(segmentId: string): number | null {
    const boundary = this.boundaries.find(b => b.segmentId === segmentId)
    if (!boundary) return null

    const startTime = boundary.startTime
    this.currentTime = startTime
    this.windowStart = Math.max(0, startTime - this.windowDuration / 2)

    // Clamp window to valid range
    this.windowStart = Math.max(0, Math.min(this.windowStart, this.totalDuration - this.windowDuration))

    return startTime
  }

  /**
   * Force render (bypasses throttling) - use for initialization/chapter changes
   */
  forceRender(): void {
    this.lastRenderTime = 0 // Reset throttle timer
    this.waveformCacheDirty = true // Force cache redraw
    this.render()
  }

  /**
   * Render complete waveform (optimized with caching and throttling)
   */
  render(): void {
    // Performance: Throttle rendering to ~30fps
    const now = performance.now()
    const timeSinceLastRender = now - this.lastRenderTime

    if (timeSinceLastRender < this.renderThrottleMs) {
      // Too soon - skip this render
      // Caller (WaveformCanvas) is responsible for scheduling next render
      this.skippedRenderCount++
      return
    }

    this.lastRenderTime = now
    this.renderCount++

    // Check if window position changed significantly (auto-scroll during playback)
    const windowStartPx = this.timeToXAbsolute(this.windowStart)
    const scrollDeltaPx = Math.abs(windowStartPx - this.lastWindowStartPx)

    // Only mark cache dirty if scroll is > threshold (avoid redraw for sub-pixel scrolls)
    if (scrollDeltaPx > this.SCROLL_THRESHOLD_PX) {
      this.waveformCacheDirty = true
      // NOTE: Don't update cachedWindowStart yet - renderWaveformToCache needs the old value!
    }

    // If waveform cache is dirty, redraw it
    if (this.waveformCacheDirty && this.waveformCache && this.waveformCacheCtx) {
      this.renderWaveformToCache()
      this.waveformCacheDirty = false
      // NOW update the cached values after rendering
      this.cachedWindowStart = this.windowStart
      this.lastWindowStartPx = windowStartPx
    }

    // Clear main canvas
    this.clear()

    // Draw cached waveform (fast blit from offscreen canvas)
    if (this.waveformCache) {
      this.ctx.drawImage(this.waveformCache, 0, 0)
    }

    // Draw playhead on top (only thing that changes every frame)
    this.drawCursor()

    // Log performance metrics every 100 renders
    if (this.enablePerformanceLogging && this.renderCount % 100 === 0) {
      logger.debug('[WaveformRenderer] Performance Stats', {
        totalRenders: this.renderCount,
        skippedRenders: this.skippedRenderCount,
        fullRedraws: this.fullRedrawCount,
        shiftRedraws: this.shiftRedrawCount,
        avgFps: (1000 / this.renderThrottleMs).toFixed(1),
        throttleSavings: `${((this.skippedRenderCount / (this.renderCount + this.skippedRenderCount)) * 100).toFixed(1)}%`,
        shiftOptimization: `${((this.shiftRedrawCount / (this.fullRedrawCount + this.shiftRedrawCount)) * 100).toFixed(1)}%`,
      })
    }
  }

  /**
   * Render waveform to offscreen cache (called only when boundaries/peaks change)
   */
  private renderWaveformToCache(): void {
    if (!this.waveformCache || !this.waveformCacheCtx) return

    const scrollDelta = this.windowStart - this.cachedWindowStart
    const scrollDeltaPx = Math.abs(scrollDelta / this.windowDuration) * this.canvas.width

    // Debug: Log scroll delta to understand behavior
    if (this.enablePerformanceLogging && this.renderCount % 20 === 0) {
      logger.debug('[WaveformRenderer] Scroll delta', {
        scrollDeltaSec: scrollDelta.toFixed(3),
        scrollDeltaPx: scrollDeltaPx.toFixed(1),
        threshold: (this.canvas.width * 0.5).toFixed(1),
        willUseShift: scrollDeltaPx > 0 && scrollDeltaPx < this.canvas.width * 0.5,
      })
    }
    this.renderWaveformCacheFull()
  }

  /**
   * Full cache redraw (used for large scrolls or initial render)
   */
  private renderWaveformCacheFull(): void {
    if (!this.waveformCache || !this.waveformCacheCtx) return

    this.fullRedrawCount++

    const ctx = this.waveformCacheCtx

    // Clear cache canvas
    ctx.clearRect(0, 0, this.waveformCache.width, this.waveformCache.height)

    // Fill with background
    ctx.fillStyle = this.options.backgroundColor
    ctx.fillRect(0, 0, this.waveformCache.width, this.waveformCache.height)

    // Draw zero line to cache
    this.drawZeroLineToContext(ctx)

    // Draw segments to cache
    this.drawSegmentsToContext(ctx)
  }

  /**
   * Optimized cache update using canvas shift (for small scrolls during playback)
   */
  private renderWaveformCacheWithShift(scrollDelta: number): void {
    if (!this.waveformCache || !this.waveformCacheCtx) return

    this.shiftRedrawCount++

    const ctx = this.waveformCacheCtx
    const width = this.waveformCache.width
    const height = this.waveformCache.height

    // Calculate pixel shift
    const shiftPx = Math.round((scrollDelta / this.windowDuration) * width)

    if (shiftPx === 0) {
      // Sub-pixel scroll, no shift needed
      return
    }

    // Create temporary canvas to hold current content
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = width
    tempCanvas.height = height
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) return

    // Copy current cache to temp
    tempCtx.drawImage(this.waveformCache, 0, 0)

    // Clear cache
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = this.options.backgroundColor
    ctx.fillRect(0, 0, width, height)

    // Shift content
    if (shiftPx > 0) {
      // Scrolling forward (right): shift content left
      ctx.drawImage(tempCanvas, -shiftPx, 0)

      // Draw new region on the right
      const newRegionStartTime = this.windowStart + this.windowDuration - (shiftPx / width) * this.windowDuration
      this.drawRegion(ctx, newRegionStartTime, this.windowStart + this.windowDuration)
    } else {
      // Scrolling backward (left): shift content right
      const absShift = Math.abs(shiftPx)
      ctx.drawImage(tempCanvas, absShift, 0)

      // Draw new region on the left
      this.drawRegion(ctx, this.windowStart, this.windowStart + (absShift / width) * this.windowDuration)
    }

    // Redraw zero line (it might be partially obscured)
    this.drawZeroLineToContext(ctx)
  }

  /**
   * Draw only segments within a specific time region (for incremental updates)
   */
  private drawRegion(ctx: CanvasRenderingContext2D, startTime: number, endTime: number): void {
    // Calculate region position and size
    // IMPORTANT: Use timeToX which is relative to current windowStart
    const regionStartX = this.timeToX(startTime)
    const regionEndX = this.timeToX(endTime)
    const regionWidth = regionEndX - regionStartX

    ctx.fillStyle = this.options.backgroundColor
    ctx.fillRect(regionStartX, 0, regionWidth, this.canvas.height)

    // Draw segments in this region
    for (const boundary of this.boundaries) {
      // Skip segments completely outside this region
      if (boundary.endTime < startTime || boundary.startTime > endTime) {
        continue
      }

      const x = this.timeToX(boundary.startTime)
      const width = this.durationToWidth(boundary.duration)

      if (boundary.isPause) {
        continue // Pauses show through as background
      } else {
        const peaks = this.peaks.get(boundary.segmentId)
        if (peaks) {
          this.drawPeaks(ctx, peaks, x, width, boundary.startTime, boundary.duration)
        } else if (boundary.isPending) {
          this.drawPendingPlaceholder(ctx, x, width)
        } else if (!boundary.isLoaded) {
          this.drawLoadingPlaceholder(ctx, x, width)
        }
      }
    }
  }

  /**
   * Clear canvas
   */
  private clear(): void {
    // Clear canvas completely
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Fill with background color (theme-aware)
    this.ctx.fillStyle = this.options.backgroundColor
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /**
   * Draw zero line (center line, always visible)
   */
  private drawZeroLine(): void {
    this.drawZeroLineToContext(this.ctx)
  }

  /**
   * Draw zero line to specific context (for caching)
   */
  private drawZeroLineToContext(ctx: CanvasRenderingContext2D): void {
    const centerY = this.canvas.height / 2

    ctx.strokeStyle = '#666666' // Gray zero line
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.3 // Semi-transparent
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(this.canvas.width, centerY)
    ctx.stroke()
    ctx.globalAlpha = 1.0 // Reset alpha
  }

  /**
   * Draw all segments (waveform + pauses) in visible window
   */
  private drawSegments(): void {
    this.drawSegmentsToContext(this.ctx)
  }

  /**
   * Draw all segments to specific context (for caching)
   */
  private drawSegmentsToContext(ctx: CanvasRenderingContext2D): void {
    const windowEnd = this.windowStart + this.windowDuration

    for (const boundary of this.boundaries) {
      // Skip segments outside the visible window
      if (boundary.endTime < this.windowStart || boundary.startTime > windowEnd) {
        continue
      }

      const x = this.timeToX(boundary.startTime)
      const width = this.durationToWidth(boundary.duration) // Use durationToWidth for correct sizing

      if (boundary.isPause) {
        // Pause segments: No special drawing needed, zero line shows through
        // (Previously filled with pause color, now just empty space with zero line)
        continue
      } else {
        // Draw waveform peaks
        const peaks = this.peaks.get(boundary.segmentId)
        if (peaks) {
          this.drawPeaks(ctx, peaks, x, width, boundary.startTime, boundary.duration)
        } else if (boundary.isPending) {
          // Pending: Dashed outline
          this.drawPendingPlaceholder(ctx, x, width)
        } else if (!boundary.isLoaded) {
          // Not loaded: Gray placeholder
          this.drawLoadingPlaceholder(ctx, x, width)
        }
      }
    }
  }

  /**
   * Draw waveform peaks for a segment
   */
  private drawPeaks(
    ctx: CanvasRenderingContext2D,
    peaks: Float32Array,
    x: number,
    width: number,
    startTime: number,
    duration: number
  ): void {
    const barWidth = width / peaks.length
    const halfHeight = this.canvas.height / 2

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i]
      const barHeight = peak * halfHeight // 100% of half height (full range)

      const barX = x + i * barWidth
      const barY = halfHeight - barHeight

      // Color: Use waveColor for cache (no progress coloring in cache)
      // Progress coloring will be done in real-time via CSS or overlay
      ctx.fillStyle = this.options.waveColor

      ctx.fillRect(barX, barY, barWidth, barHeight * 2)
    }
  }

  /**
   * Draw placeholder for pending segments (out-of-order)
   */
  private drawPendingPlaceholder(ctx: CanvasRenderingContext2D, x: number, width: number): void {
    ctx.strokeStyle = '#ffa500'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(x, 10, width, this.canvas.height - 20)
    ctx.setLineDash([])

    // Text: "Pending..."
    ctx.fillStyle = '#ffa500'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Pending...', x + width / 2, this.canvas.height / 2)
  }

  /**
   * Draw placeholder for loading segments
   */
  private drawLoadingPlaceholder(ctx: CanvasRenderingContext2D, x: number, width: number): void {
    ctx.fillStyle = '#ccc'
    ctx.fillRect(x, 20, width, this.canvas.height - 40)
  }

  /**
   * Draw playback cursor (red, 1px)
   */
  private drawCursor(): void {
    const x = this.timeToX(this.currentTime)

    this.ctx.strokeStyle = '#ff0000' // Red
    this.ctx.lineWidth = 1
    this.ctx.beginPath()
    this.ctx.moveTo(x, 0)
    this.ctx.lineTo(x, this.canvas.height)
    this.ctx.stroke()
  }

  /**
   * Convert time (seconds) to canvas X coordinate (relative to window)
   */
  private timeToX(time: number): number {
    if (this.windowDuration === 0) return 0
    return ((time - this.windowStart) / this.windowDuration) * this.canvas.width
  }

  /**
   * Convert time (seconds) to absolute pixel position (ignoring window)
   * Used for scroll delta detection
   */
  private timeToXAbsolute(time: number): number {
    if (this.totalDuration === 0) return 0
    return (time / this.totalDuration) * this.canvas.width
  }

  /**
   * Convert duration (seconds) to pixel width
   */
  private durationToWidth(duration: number): number {
    if (this.windowDuration === 0) return 0
    return (duration / this.windowDuration) * this.canvas.width
  }

  /**
   * Convert canvas X coordinate to time (seconds) (relative to window)
   */
  xToTime(x: number): number {
    return this.windowStart + (x / this.canvas.width) * this.windowDuration
  }

  /**
   * Find segment at canvas X coordinate
   */
  findSegmentAtX(x: number): EnhancedSegmentBoundary | null {
    const time = this.xToTime(x)
    return this.boundaries.find(
      (b) => time >= b.startTime && time < b.endTime
    ) || null
  }
}
