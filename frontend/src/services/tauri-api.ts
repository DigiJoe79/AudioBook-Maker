import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { logger } from '../utils/logger';


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
  async ping(): Promise<string> {
    return await invoke('ping');
  }

  async checkBackendHealth(): Promise<boolean> {
    try {
      return await invoke('check_backend_health');
    } catch (error) {
      logger.error('[TauriAPI] Backend health check failed:', error);
      return false;
    }
  }

  async getAppInfo(): Promise<AppInfo> {
    return await invoke('get_app_info');
  }

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
        await invoke('save_project_file', { path: savePath, content });
        return savePath;
      }
    } catch (error) {
      logger.error('[TauriAPI] Failed to save project file:', error);
      throw error;
    }
    return null;
  }

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

  async downloadExportedAudio(
    jobId: string,
    backendUrl: string,
    defaultFilename: string
  ): Promise<string | null> {
    try {
      const savePath = await save({
        defaultPath: defaultFilename,
        filters: [
          {
            name: 'Audio Files',
            extensions: ['mp3', 'm4a', 'wav'],
          },
        ],
      });

      if (!savePath) {
        logger.debug('[TauriAPI] User cancelled export download');
        return null;
      }

      const downloadUrl = `${backendUrl}/api/audio/export/${jobId}/download`;
      logger.info('[TauriAPI] Downloading from:', downloadUrl);

      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Backend returned error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      await writeFile(savePath, uint8Array);

      logger.info(`[TauriAPI] File saved successfully to: ${savePath}`);
      return savePath;
    } catch (error) {
      logger.error('[TauriAPI] Failed to download exported audio:', error);
      throw error;
    }
  }
}

export const tauriAPI = new TauriAPIService();

export default tauriAPI;