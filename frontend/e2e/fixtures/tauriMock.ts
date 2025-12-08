/**
 * Tauri CDP Integration for E2E Tests
 *
 * Handles connection to the real Tauri app via Chrome DevTools Protocol.
 * No mocking needed - we're testing the actual app.
 */

import type { Page } from '@playwright/test'

export class TauriMock {
  constructor(private page: Page) {}

  /**
   * Setup - no-op for CDP mode (real Tauri app, no mocks needed)
   */
  async setup() {
    // In CDP mode, we connect to the real Tauri app
    // No mocking required - Tauri APIs are real
    console.log('[Tauri CDP] Setup complete (no mocks needed)')
  }

  /**
   * Ensure app is connected to backend and ready for testing
   *
   * In CDP mode, the app is already running. We just need to:
   * 1. Check if we're on /app (already connected)
   * 2. If on /, click Connect
   * 3. Wait for app-layout to be visible
   */
  async connectToBackend(backendUrl: string = 'http://localhost:8765') {
    const currentUrl = this.page.url()

    // Check if already on /app
    if (currentUrl.includes('/app')) {
      console.log('[Tauri CDP] Already on /app, checking layout...')
      await this.page.waitForSelector('[data-testid="app-layout"]', { timeout: 10000 })
      console.log('[Tauri CDP] App ready')
      return
    }

    // If on start page, connect
    if (currentUrl.includes('localhost') || currentUrl === 'about:blank') {
      console.log('[Tauri CDP] On start page, connecting...')

      // Navigate to start page if needed
      if (!currentUrl.includes('localhost:')) {
        await this.page.goto('http://localhost:5173/')
        await this.page.waitForLoadState('networkidle')
      }

      // Click connect button
      const connectButton = this.page.locator('button').filter({ hasText: /connect/i }).first()
      if (await connectButton.isVisible()) {
        await connectButton.click()
        await this.page.waitForURL('**/app', { timeout: 15000 })
      }
    }

    await this.page.waitForSelector('[data-testid="app-layout"]', { timeout: 10000 })
    console.log('[Tauri CDP] Connected to backend:', backendUrl)
  }
}
