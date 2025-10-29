/// <reference types="vite/client" />

// Extend Window interface with Electron API
interface Window {
  electronAPI: import('../electron/preload').ElectronAPI
}
