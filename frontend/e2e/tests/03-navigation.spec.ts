/**
 * 03-NAVIGATION: E2E Navigation Tests
 *
 * Tests the Teams/Discord-style navigation with:
 * - View switching (6 views)
 * - Keyboard shortcuts (Ctrl+1-6)
 * - Back navigation (Ctrl+[)
 * - Sidebar toggle (Ctrl+B)
 *
 * PREREQUISITE: 01-smoke must pass (base speaker exists)
 */

import { test, expect, BACKEND_URL } from '../fixtures'

test.describe('03-Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we're on /app (baseSpeaker from smoke ensures no gate)
    if (!page.url().includes('/app')) {
      const connectButton = page.locator('button').filter({ hasText: /verbinden|connect/i }).first()
      if (await connectButton.isVisible({ timeout: 2000 })) {
        await connectButton.click()
        await page.waitForURL('**/app', { timeout: 10000 })
      }
    }
    await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: 5000 })
  })

  test('should display all navigation buttons', async ({ page }) => {
    // Verify all nav buttons are visible
    await expect(page.getByTestId('nav-main')).toBeVisible()
    await expect(page.getByTestId('nav-import')).toBeVisible()
    await expect(page.getByTestId('nav-speakers')).toBeVisible()
    await expect(page.getByTestId('nav-pronunciation')).toBeVisible()
    await expect(page.getByTestId('nav-monitoring')).toBeVisible()
    await expect(page.getByTestId('nav-settings')).toBeVisible()
    console.log('[Navigation] All 6 nav buttons visible')
  })

  test('should navigate between views by clicking', async ({ page }) => {
    // Navigate to each view and verify it's visible
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Main view OK')

    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Import view OK')

    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Speakers view OK')

    await page.getByTestId('nav-pronunciation').click()
    await expect(page.getByTestId('pronunciation-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Pronunciation view OK')

    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Monitoring view OK')

    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Settings view OK')
  })

  test('should navigate using Ctrl+1-6 keyboard shortcuts', async ({ page }) => {
    // Ctrl+1 → Main View
    await page.keyboard.press('Control+1')
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+1 → Main view')

    // Ctrl+2 → Import View
    await page.keyboard.press('Control+2')
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+2 → Import view')

    // Ctrl+3 → Speakers View
    await page.keyboard.press('Control+3')
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+3 → Speakers view')

    // Ctrl+4 → Pronunciation View
    await page.keyboard.press('Control+4')
    await expect(page.getByTestId('pronunciation-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+4 → Pronunciation view')

    // Ctrl+5 → Monitoring View
    await page.keyboard.press('Control+5')
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+5 → Monitoring view')

    // Ctrl+6 → Settings View
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+6 → Settings view')
  })

  test('should go back with Ctrl+[ shortcut', async ({ page }) => {
    // Start at Main View
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })

    // Navigate to Settings
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 3000 })

    // Go back to Main View
    await page.keyboard.press('Control+BracketLeft')
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })
    console.log('[Navigation] Ctrl+[ goes back')
  })

  test('should toggle sidebar with Ctrl+B', async ({ page }) => {
    // Go to Main View (has sidebar)
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })

    // Get sidebar state
    const sidebar = page.getByTestId('project-sidebar')
    const initiallyVisible = await sidebar.isVisible()

    // Toggle sidebar and wait for state change
    await page.keyboard.press('Control+b')

    // Wait for sidebar visibility to change
    if (initiallyVisible) {
      await expect(sidebar).not.toBeVisible({ timeout: 2000 })
    } else {
      await expect(sidebar).toBeVisible({ timeout: 2000 })
    }
    const nowVisible = await sidebar.isVisible()
    expect(nowVisible).not.toBe(initiallyVisible)

    // Toggle sidebar back
    await page.keyboard.press('Control+b')

    // Wait for sidebar visibility to return to original state
    if (initiallyVisible) {
      await expect(sidebar).toBeVisible({ timeout: 2000 })
    } else {
      await expect(sidebar).not.toBeVisible({ timeout: 2000 })
    }
    const nowVisible2 = await sidebar.isVisible()
    expect(nowVisible2).toBe(initiallyVisible)

    console.log(`[Navigation] Ctrl+B toggled sidebar: ${initiallyVisible} → ${nowVisible}`)
  })
})
