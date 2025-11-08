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
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});