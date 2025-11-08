/**
 * UI Settings Store
 *
 * Manages UI-only settings (theme, language) stored locally in localStorage.
 * These settings are independent of backend connection.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
        set((state) => ({
          settings: {
            ...state.settings,
            theme
          }
        }));
      },

      setLanguage: (uiLanguage) => {
        set((state) => ({
          settings: {
            ...state.settings,
            uiLanguage
          }
        }));
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: {
            ...state.settings,
            ...newSettings
          }
        }));
      }
    }),
    {
      name: 'audiobook-maker:ui-settings', // localStorage key
      version: 1
    }
  )
);
