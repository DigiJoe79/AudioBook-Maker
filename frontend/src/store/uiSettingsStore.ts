/**
 * UI Settings Store
 *
 * Manages UI-only settings (theme, language) stored locally in localStorage.
 * These settings are independent of backend connection.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { produce } from 'immer';

export interface UISettings {
  theme: 'light' | 'dark' | 'system';
  uiLanguage: 'de' | 'en';
}

interface UISettingsState {
  // Settings data
  settings: UISettings;

  // Actions
  setTheme: (theme: UISettings['theme']) => void;
  setLanguage: (language: UISettings['uiLanguage']) => void;
  updateSettings: (settings: Partial<UISettings>) => void;
}

// Default UI settings
const DEFAULT_SETTINGS: UISettings = {
  theme: 'system',
  uiLanguage: 'en'
};

export const useUISettingsStore = create<UISettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,

      setTheme: (theme) => {
        set(produce((draft) => {
          draft.settings.theme = theme;
        }));
      },

      setLanguage: (uiLanguage) => {
        set(produce((draft) => {
          draft.settings.uiLanguage = uiLanguage;
        }));
      },

      updateSettings: (newSettings) => {
        set(produce((draft) => {
          Object.assign(draft.settings, newSettings);
        }));
      }
    }),
    {
      name: 'audiobook-maker:ui-settings', // localStorage key
      version: 1
    }
  )
);
