import { logger } from '@utils/logger';

/**
 * Tauri API Service
 * Provides native file system operations for Tauri desktop app
 */

class TauriAPIService {
  /**
   * Download exported audio file from backend using native Tauri dialog
   *
   * This replaces the browser-based download method which doesn't work in Tauri.
   * Uses frontend-only implementation with Tauri plugins (dialog + fs).
   *
   * @param jobId Export job ID from backend
   * @param backendUrl Backend base URL (e.g., "http://localhost:8765")
   * @param defaultFilename Suggested filename for save dialog
   * @returns Path where the file was saved, or null if cancelled
   */
  async downloadExportedAudio(
    jobId: string,
    backendUrl: string,
    defaultFilename: string
  ): Promise<string | null> {
    try {
      // Import dynamically to avoid issues in non-Tauri environments
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeFile } = await import('@tauri-apps/plugin-fs');

      // 1. Show native save dialog
      const savePath = await save({
        defaultPath: defaultFilename,
        filters: [
          {
            name: 'Audio Files',
            extensions: ['mp3', 'm4a', 'wav'],
          },
        ],
      });

      // User cancelled the dialog
      if (!savePath) {
        logger.debug('[TauriAPI] User cancelled export download');
        return null;
      }

      // 2. Download file from backend via HTTP
      const downloadUrl = `${backendUrl}/api/audio/export/${jobId}/download`;
      logger.group(
        '📤 Export',
        'Downloading from backend',
        { url: downloadUrl },
        '#2196F3'
      );

      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Backend returned error: ${response.status} ${response.statusText}`);
      }

      // 3. Convert response to binary data
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // 4. Write file using Tauri FS plugin
      await writeFile(savePath, uint8Array);

      logger.group(
        '📤 Export',
        'File saved successfully',
        { path: savePath },
        '#4CAF50'
      );
      return savePath;
    } catch (error) {
      logger.error('[TauriAPI] Failed to download exported audio:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const tauriAPI = new TauriAPIService();
