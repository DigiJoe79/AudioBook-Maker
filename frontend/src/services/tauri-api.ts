import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { logger } from '../utils/logger';

/**
 * Tauri API Service
 * Provides a clean interface to Tauri commands and plugins
 */

export interface AppInfo {
  version: string;
  name: string;
  platform: string;
  arch: string;
}

export interface ProjectData {
  name: string;
  chapters: any[];
  settings: any;
}

class TauriAPIService {
  /**
   * Test connectivity to the Tauri backend
   */
  async ping(): Promise<string> {
    return await invoke('ping');
  }

  /**
   * Check if the Python backend is running
   */
  async checkBackendHealth(): Promise<boolean> {
    try {
      return await invoke('check_backend_health');
    } catch (error) {
      logger.error('[TauriAPI] Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Get application information
   */
  async getAppInfo(): Promise<AppInfo> {
    return await invoke('get_app_info');
  }

  /**
   * Open a project file using the native file dialog
   */
  async openProjectFile(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Audiobook Project',
            extensions: ['abp'],
          },
          {
            name: 'Text Files',
            extensions: ['txt', 'md', 'epub'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        return content;
      }
    } catch (error) {
      logger.error('[TauriAPI] Failed to open project file:', error);
    }
    return null;
  }

  /**
   * Save a project file using the native save dialog
   */
  async saveProjectFile(content: string, defaultPath?: string): Promise<string | null> {
    try {
      const savePath = await save({
        defaultPath,
        filters: [
          {
            name: 'Audiobook Project',
            extensions: ['abp'],
          },
        ],
      });

      if (savePath) {
        await writeTextFile(savePath, content);
        // Also update the backend state
        await invoke('save_project_file', { path: savePath, content });
        return savePath;
      }
    } catch (error) {
      logger.error('[TauriAPI] Failed to save project file:', error);
      throw error;
    }
    return null;
  }

  /**
   * Export audio file
   */
  async exportAudio(
    format: 'mp3' | 'wav' | 'm4a',
    audioData: Uint8Array
  ): Promise<string | null> {
    try {
      const savePath = await save({
        filters: [
          {
            name: `Audio Files`,
            extensions: [format],
          },
        ],
      });

      if (savePath) {
        await invoke('export_audio', {
          format,
          path: savePath,
          audioData: Array.from(audioData),
        });
        return savePath;
      }
    } catch (error) {
      logger.error('[TauriAPI] Failed to export audio:', error);
      throw error;
    }
    return null;
  }

  /**
   * Open a text file for import
   */
  async openTextFile(): Promise<{ path: string; content: string } | null> {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Text Files',
            extensions: ['txt', 'md', 'epub', 'pdf'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        return { path: selected, content };
      }
    } catch (error) {
      logger.error('[TauriAPI] Failed to open text file:', error);
    }
    return null;
  }

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

// Export for direct use in components
export default tauriAPI;