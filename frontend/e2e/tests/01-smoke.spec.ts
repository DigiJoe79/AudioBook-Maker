/**
 * 01-SMOKE: E2E Smoke Test
 *
 * MUST RUN FIRST - tests Gate behavior and creates first speaker via UI.
 *
 * TRUE E2E TESTS:
 * 1. Clear backend completely (no speakers)
 * 2. Verify EmptySpeakersState gate is shown
 * 3. Verify other views are blocked
 * 4. Create first speaker via UI (not API!)
 * 5. Verify all views are now accessible
 * 6. CHECKPOINT: Default speaker exists
 */

import { test, expect, BACKEND_URL, checkpoint, checks } from '../fixtures'
import {
  clearBackend,
  createTestWavFile,
  cleanupTestWavFiles
} from '../fixtures/testHelpers'

// Test data
let testWavFile: string

test.describe('01-Smoke', () => {

  test.beforeAll(async () => {
    testWavFile = createTestWavFile('smoke-test-sample.wav', 2)
    console.log('[Smoke] Test WAV file created')
  })

  test.afterAll(async () => {
    cleanupTestWavFiles(testWavFile)
    console.log('[Smoke] Test WAV file cleaned up')
  })

  test('should show EmptySpeakersState gate when no speakers exist', async ({ page }) => {
    // Step 1: Clear backend completely (no speakers!)
    await clearBackend(page, BACKEND_URL)
    console.log('[Smoke] Backend cleared - no speakers')

    // Step 2: Reload page to see gate
    // Navigate to start and reconnect
    await page.goto('http://localhost:5173/')

    // Connect to backend - wait for button to be ready
    const connectButton = page.locator('button').filter({ hasText: /verbinden|connect/i }).first()
    await expect(connectButton).toBeVisible({ timeout: 5000 })
    await connectButton.click()
    await page.waitForURL('**/app', { timeout: 15000 })

    // Step 3: Verify EmptySpeakersState is shown
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('empty-speakers-state')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] EmptySpeakersState gate visible ✓')
  })

  test('should block other views when no speakers exist (gate)', async ({ page }) => {
    // Verify we're on speakers view with gate
    await expect(page.getByTestId('empty-speakers-state')).toBeVisible({ timeout: 3000 })

    // Try Main view - should be blocked
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 2000 })
    console.log('[Smoke] Main view blocked by gate ✓')

    // Try Import view - should be blocked
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 2000 })
    console.log('[Smoke] Import view blocked by gate ✓')

    // Try Pronunciation view - should be blocked
    await page.getByTestId('nav-pronunciation').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 2000 })
    console.log('[Smoke] Pronunciation view blocked by gate ✓')

    // Try Monitoring view - should be blocked
    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 2000 })
    console.log('[Smoke] Monitoring view blocked by gate ✓')

    // Settings view - should be ALLOWED (configuration always accessible)
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 2000 })
    console.log('[Smoke] Settings view accessible (allowed during gate) ✓')

    // Go back to speakers for next test
    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 2000 })
  })

  test('should create first speaker via UI and unlock app', async ({ page }) => {
    // Navigate back to speakers view (might be on settings from previous test)
    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 3000 })

    // Verify we're on gate
    await expect(page.getByTestId('empty-speakers-state')).toBeVisible({ timeout: 3000 })

    // Step 1: Click "Create first speaker" button
    await page.getByTestId('empty-speakers-create-button').click()
    console.log('[Smoke] Clicked create first speaker button')

    // Step 2: Wait for modal
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })

    // Step 3: Fill in speaker data
    const nameInput = page.getByTestId('speaker-name-input').locator('input')
    await nameInput.fill('Test Speaker')

    // Step 4: Expand optional section (use role to be specific)
    const optionalDetailsButton = page.getByRole('button', { name: /optionale details|optional details/i })
    await optionalDetailsButton.click()
    // Wait for accordion to expand by checking description input is visible
    const descInput = page.getByTestId('speaker-description-input').locator('textarea').first()
    await expect(descInput).toBeVisible({ timeout: 2000 })

    // Step 5: Add description
    await descInput.fill('Default test speaker for E2E tests')

    // Step 6: Select gender (MUI Select uses listbox)
    await page.getByTestId('speaker-gender-select').click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible({ timeout: 2000 })
    await listbox.getByText(/neutral/i).first().click()

    // Step 7: Upload audio sample (required!)
    const fileInput = page.getByTestId('speaker-sample-file-input')
    await fileInput.setInputFiles(testWavFile)
    console.log('[Smoke] Audio sample uploaded')

    // Step 8: Save speaker
    await page.getByTestId('speaker-save-button').click()

    // Step 9: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 10000 })
    console.log('[Smoke] First speaker created via UI ✓')

    // Step 10: Verify gate is gone - speaker list visible
    await expect(page.getByTestId('empty-speakers-state')).not.toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Test Speaker', { exact: true })).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Gate removed, speaker list visible ✓')

    // Step 11: Set as default via API (for other tests)
    const speakersResponse = await page.request.get(`${BACKEND_URL}/api/speakers`)
    const speakers = await speakersResponse.json()
    const testSpeaker = speakers.find((s: any) => s.name === 'Test Speaker')
    if (testSpeaker) {
      await page.request.post(`${BACKEND_URL}/api/speakers/${testSpeaker.id}/set-default`)
      console.log('[Smoke] Set as default speaker')
    }
  })

  test('should allow navigation to all views after speaker exists', async ({ page }) => {
    // Now all views should be accessible

    // Navigate to Main view
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Main view accessible ✓')

    // Navigate to Import view
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Import view accessible ✓')

    // Navigate to Speakers view
    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Speakers view accessible ✓')

    // Navigate to Pronunciation view
    await page.getByTestId('nav-pronunciation').click()
    await expect(page.getByTestId('pronunciation-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Pronunciation view accessible ✓')

    // Navigate to Monitoring view
    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Monitoring view accessible ✓')

    // Navigate to Settings view
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 5000 })
    console.log('[Smoke] Settings view accessible ✓')

    // Navigate back to Speakers view
    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 5000 })

    console.log('[Smoke] All 6 views now accessible!')
  })

  test('CHECKPOINT: default speaker exists', async ({ page }) => {
    // This checkpoint MUST pass for subsequent test suites to run
    await checkpoint(page, 'Default Speaker Exists', () =>
      checks.defaultSpeakerExists(page)
    )
  })
})
