import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },

  clearScreen: false,

  base: './',

  envPrefix: ['VITE_', 'TAURI_'],

  optimizeDeps: {
    include: ['@emotion/react', '@emotion/styled', '@mui/material'],
  },

  build: {
    target: 'ES2021',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
    cssCodeSplit: true,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});