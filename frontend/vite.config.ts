import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri expects the frontend to be served from this port in development
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Tauri uses a custom protocol for assets
  base: './',

  // Environment variables prefix
  envPrefix: ['VITE_', 'TAURI_'],

  // Fix for Material-UI/Emotion in production builds
  optimizeDeps: {
    include: ['@emotion/react', '@emotion/styled', '@mui/material'],
  },

  build: {
    // Tauri uses the ES2021 target
    target: 'ES2021',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
    // Ensure CSS is properly injected
    cssCodeSplit: true,
    // Suppress chunk size warning (acceptable for Tauri desktop app)
    chunkSizeWarningLimit: 1500,
  },

  // Drop console.* calls in production builds (P3.3)
  esbuild: {
    drop: process.env.TAURI_DEBUG ? [] : ['console'],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types/index.ts'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@pages': path.resolve(__dirname, './src/pages'),
    },
  },
});