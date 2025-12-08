import { defineConfig } from '@playwright/test'

/**
 * Playwright Configuration for Audiobook Maker E2E Tests
 *
 * Tests the real Tauri app via CDP (Chrome DevTools Protocol).
 *
 * Prerequisites:
 * 1. Backend running: cd backend && ./venv/Scripts/python main.py
 * 2. Tauri app running with CDP enabled
 *
 * Run tests:
 *   npm run test:e2e
 */

export default defineConfig({
  testDir: './e2e',

  // Output directories - keep everything in e2e/
  outputDir: './e2e/test-results',

  // Test configuration
  fullyParallel: false, // Run sequentially (database state dependencies)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker (shared database state)

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: './e2e/playwright-report' }],
    ['list'],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  // Test timeout and expect timeout
  timeout: 60_000, // 60s per test (TTS generation can be slow)
  expect: {
    timeout: 10_000, // 10s for assertions
  },

  use: {
    // Trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Viewport
    viewport: { width: 1280, height: 720 },
  },

  // Single project for Tauri CDP
  projects: [
    {
      name: 'tauri',
      use: {},
    },
  ],

  // No webServer - Tauri app must be started manually
})
