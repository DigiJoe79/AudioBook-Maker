/**
 * useTauriFileDrop - Shared hook for Tauri 2.0 file drop handling
 *
 * Provides:
 * - Tauri onDragDropEvent listener setup/cleanup
 * - isDragging state for visual feedback
 * - Path-to-File conversion with MIME type detection
 * - Duplicate event prevention
 * - Graceful fallback when running in browser
 *
 * Usage:
 * const { isDragging } = useTauriFileDrop({
 *   onDrop: (files) => handleFiles(files),
 *   componentName: 'MyUploadZone',
 *   getMimeType: (ext) => ext === 'md' ? 'text/markdown' : 'text/plain',
 * })
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { logger } from '@/utils/logger'

/**
 * Default MIME type mapping for common file extensions
 */
const DEFAULT_MIME_TYPES: Record<string, string> = {
  // Text
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  // Audio
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  // Fallback
  default: 'application/octet-stream',
}

interface UseTauriFileDropOptions {
  /**
   * Callback when files are dropped
   * Receives an array of File objects converted from Tauri paths
   */
  onDrop: (files: File[]) => void

  /**
   * Component name for logging (e.g., 'FileUploadArea')
   */
  componentName: string

  /**
   * Whether file drop is disabled
   */
  disabled?: boolean

  /**
   * Custom MIME type resolver
   * If not provided, uses default mapping based on extension
   */
  getMimeType?: (extension: string) => string

  /**
   * Whether to process only the first file (single file mode)
   * Default: false (process all files)
   */
  singleFile?: boolean
}

interface UseTauriFileDropResult {
  /**
   * Whether a file is currently being dragged over the window
   */
  isDragging: boolean
}

/**
 * Hook for handling Tauri 2.0 file drop events
 *
 * Abstracts the common pattern of:
 * 1. Setting up Tauri onDragDropEvent listener
 * 2. Managing isDragging state for visual feedback
 * 3. Converting file paths to File objects
 * 4. Preventing duplicate drop event processing
 */
export function useTauriFileDrop({
  onDrop,
  componentName,
  disabled = false,
  getMimeType,
  singleFile = false,
}: UseTauriFileDropOptions): UseTauriFileDropResult {
  const [isDragging, setIsDragging] = useState(false)
  const isProcessingDropRef = useRef(false)

  /**
   * Resolve MIME type from file extension
   */
  const resolveMimeType = useCallback(
    (extension: string): string => {
      if (getMimeType) {
        return getMimeType(extension)
      }
      return DEFAULT_MIME_TYPES[extension] || DEFAULT_MIME_TYPES.default
    },
    [getMimeType]
  )

  /**
   * Convert Tauri file paths to File objects
   */
  const convertPathsToFiles = useCallback(
    async (paths: string[]): Promise<File[]> => {
      // Import Tauri FS plugin dynamically
      const { readFile } = await import('@tauri-apps/plugin-fs')

      const pathsToProcess = singleFile ? paths.slice(0, 1) : paths

      const filePromises = pathsToProcess.map(async (path) => {
        // Read file as binary
        const uint8Array = await readFile(path)

        // Convert Uint8Array to Blob
        const blob = new Blob([uint8Array])

        // Extract filename from path (handles both Windows and Unix paths)
        const fileName = path.split('\\').pop()?.split('/').pop() || 'file'

        // Determine MIME type from extension
        const extension = fileName.split('.').pop()?.toLowerCase() || ''
        const mimeType = resolveMimeType(extension)

        return new File([blob], fileName, { type: mimeType })
      })

      return Promise.all(filePromises)
    },
    [resolveMimeType, singleFile]
  )

  /**
   * Handle Tauri file drop event
   */
  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      if (disabled) return

      // Prevent duplicate processing (Tauri may fire event multiple times)
      if (isProcessingDropRef.current) {
        logger.debug(`[${componentName}] Already processing drop, ignoring duplicate event`)
        return
      }

      isProcessingDropRef.current = true

      try {
        logger.debug(`[${componentName}] Tauri file drop`, { paths })
        const files = await convertPathsToFiles(paths)
        onDrop(files)
      } catch (error) {
        logger.error(`[${componentName}] Failed to process dropped files`, { error })
      } finally {
        // Reset processing flag after a short delay to allow for legitimate re-drops
        setTimeout(() => {
          isProcessingDropRef.current = false
        }, 500)
      }
    },
    [disabled, componentName, convertPathsToFiles, onDrop]
  )

  /**
   * Set up Tauri drag-drop event listener
   */
  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setupTauriFileDrop = async () => {
      try {
        const currentWindow = getCurrentWindow()
        unlisten = await currentWindow.onDragDropEvent((event) => {
          if (event.payload.type === 'over') {
            setIsDragging(true)
          } else if (event.payload.type === 'drop') {
            setIsDragging(false)
            handleTauriFileDrop(event.payload.paths)
          } else if (event.payload.type === 'leave') {
            setIsDragging(false)
          }
        })
      } catch (error) {
        logger.warn(`[${componentName}] Tauri file drop not available (running in browser)`, { error })
      }
    }

    setupTauriFileDrop()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [handleTauriFileDrop, componentName])

  return { isDragging }
}
