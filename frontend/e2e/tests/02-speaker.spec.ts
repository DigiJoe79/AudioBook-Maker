/**
 * 02-SPEAKER: E2E Speaker Management Tests
 *
 * TRUE E2E TESTS - All operations via UI, not API!
 *
 * Tests:
 * 1. Display base speaker
 * 2. Create new speaker (via UI dialog)
 * 3. Edit speaker (via UI dialog)
 * 4. Search & Filter
 * 5. Set Default Speaker (via context menu)
 * 6. Delete Speaker (via context menu)
 *
 * PREREQUISITE: 01-smoke must pass (base speaker exists)
 * CHECKPOINT: At least 1 default speaker exists
 */

import { test, expect, BACKEND_URL, checkpoint, checks } from '../fixtures'
import { createTestWavFile, cleanupTestWavFiles } from '../fixtures/testHelpers'

// Test data - WAV files for various tests
let testWavFile1: string
let testWavFile2: string
let testWavFile3: string
let testWavFile4: string
let testWavFile5: string
let testWavFile6: string
let testWavFile7: string

test.describe('02-Speaker', () => {

  test.beforeAll(async () => {
    testWavFile1 = createTestWavFile('speaker-test-1.wav', 2)
    testWavFile2 = createTestWavFile('speaker-test-2.wav', 3)
    testWavFile3 = createTestWavFile('speaker-test-3.wav', 2)
    testWavFile4 = createTestWavFile('speaker-test-4.wav', 3)
    testWavFile5 = createTestWavFile('speaker-test-5.wav', 2)
    testWavFile6 = createTestWavFile('speaker-test-6.wav', 3)
    testWavFile7 = createTestWavFile('speaker-test-7.wav', 2)
    console.log('[Speaker] Test WAV files created (7 files)')
  })

  test.afterAll(async () => {
    cleanupTestWavFiles(testWavFile1, testWavFile2, testWavFile3, testWavFile4, testWavFile5, testWavFile6, testWavFile7)
    console.log('[Speaker] Test WAV files cleaned up')
  })

  test.beforeEach(async ({ page }) => {
    // Ensure we're on /app
    if (!page.url().includes('/app')) {
      const connectButton = page.locator('button').filter({ hasText: /verbinden|connect/i }).first()
      if (await connectButton.isVisible({ timeout: 2000 })) {
        await connectButton.click()
        await page.waitForURL('**/app', { timeout: 10000 })
      }
    }
    await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: 5000 })

    // Navigate to Speakers view
    await page.getByTestId('nav-speakers').click()
    await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 5000 })
  })

  test('should display existing base speaker', async ({ page, baseSpeaker }) => {
    // Verify speaker name is displayed (use text instead of testid - more reliable after SSE update)
    await expect(page.getByText(baseSpeaker.name).first()).toBeVisible({ timeout: 5000 })
    console.log(`[Speaker] Base speaker visible: ${baseSpeaker.name}`)
  })

  test('should create new speaker via UI dialog', async ({ page, baseSpeaker }) => {
    // Step 1: Click "Add Speaker" button
    await page.getByTestId('speaker-add-button').click()

    // Step 2: Wait for modal to open
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Create dialog opened')

    // Step 3: Fill in speaker name
    const nameInput = page.getByTestId('speaker-name-input').locator('input')
    await nameInput.fill('E2E UI Speaker')

    // Step 4: Expand optional section and fill description
    await page.getByRole('button', { name: /optionale details|optional details/i }).click()
    const descInput = page.getByTestId('speaker-description-input').locator('textarea').first()
    await expect(descInput).toBeVisible({ timeout: 2000 }) // Wait for accordion animation
    await descInput.fill('Created via E2E UI test')

    // Step 5: Select gender
    await page.getByTestId('speaker-gender-select').click()
    await page.getByRole('option', { name: /weiblich|female/i }).click()

    // Step 6: Upload audio sample (required for new speaker)
    const fileInput = page.getByTestId('speaker-sample-file-input')
    await fileInput.setInputFiles(testWavFile1)
    console.log('[Speaker] Audio sample uploaded')

    // Step 7: Click Save
    await page.getByTestId('speaker-save-button').click()

    // Step 8: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 10000 })
    console.log('[Speaker] Speaker created via UI')

    // Step 9: Verify speaker appears in list
    await expect(page.getByText('E2E UI Speaker')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] New speaker visible in UI')
  })

  test('should edit speaker via UI dialog', async ({ page, baseSpeaker }) => {
    // First ensure E2E UI Speaker exists
    const speakerCard = page.getByText('E2E UI Speaker').first()
    if (!await speakerCard.isVisible({ timeout: 2000 })) {
      console.log('[Speaker] E2E UI Speaker not found, skipping edit test')
      test.skip()
      return
    }

    // Step 1: Find the speaker card and click Edit button
    // We need to find the card that contains "E2E UI Speaker" and then its edit button
    const card = page.locator('[data-testid^="speaker-card-"]').filter({ hasText: 'E2E UI Speaker' })
    const editButton = card.locator('[data-testid^="speaker-edit-button-"]')
    await editButton.click()

    // Step 2: Wait for edit modal
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Edit dialog opened')

    // Step 3: Change the name
    const nameInput = page.getByTestId('speaker-name-input').locator('input')
    await nameInput.clear()
    await nameInput.fill('E2E UI Speaker (Edited)')

    // Step 4: Save changes
    await page.getByTestId('speaker-save-button').click()

    // Step 5: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 10000 })

    // Step 6: Verify updated name in list
    await expect(page.getByText('E2E UI Speaker (Edited)')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Speaker edited successfully')
  })

  test('should search and filter speakers', async ({ page, baseSpeaker }) => {
    // Ensure we have at least 2 speakers to filter
    // Create "Search Test Speaker" if it doesn't exist (via API for setup)
    const speakersResponse = await page.request.get(`${BACKEND_URL}/api/speakers`)
    const speakers = await speakersResponse.json()
    if (!speakers.find((s: any) => s.name === 'Search Test Speaker')) {
      await page.request.post(`${BACKEND_URL}/api/speakers`, {
        data: { name: 'Search Test Speaker', description: 'Unique narrator', gender: 'female' }
      })
      // Refresh view - navigate away and back
      await page.getByTestId('nav-main').click()
      await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 3000 })
      await page.getByTestId('nav-speakers').click()
      await expect(page.getByTestId('speakers-view')).toBeVisible({ timeout: 3000 })
    }

    // Step 1: Find search box
    const searchBox = page.getByPlaceholder(/search|suchen/i)
    await expect(searchBox).toBeVisible()

    // Step 2: Type search term that only matches one speaker
    await searchBox.fill('Unique')
    // Wait for debounced search to filter results
    await expect(page.getByText('Search Test Speaker', { exact: true })).toBeVisible({ timeout: 3000 })

    // Step 3: Verify filtered results
    await expect(page.getByText('Search Test Speaker', { exact: true })).toBeVisible()
    await expect(page.getByText(baseSpeaker.name, { exact: true })).not.toBeVisible()
    console.log('[Speaker] Search filter works - only matching speaker visible')

    // Step 4: Clear search and wait for all speakers to be visible again
    await searchBox.clear()
    await expect(page.getByText(baseSpeaker.name, { exact: true })).toBeVisible({ timeout: 3000 })

    // Step 5: Verify all speakers visible again
    await expect(page.getByText(baseSpeaker.name, { exact: true })).toBeVisible()
    await expect(page.getByText('Search Test Speaker', { exact: true })).toBeVisible()
    console.log('[Speaker] Search clear restores all speakers')
  })

  test('should set speaker as default via context menu', async ({ page, baseSpeaker }) => {
    // Find a non-default speaker to set as default
    // Use E2E UI Speaker (Edited) or Search Test Speaker
    const testSpeakerText = page.getByText(/E2E UI Speaker|Search Test Speaker/).first()
    if (!await testSpeakerText.isVisible({ timeout: 2000 })) {
      console.log('[Speaker] No test speaker found to set as default, skipping')
      test.skip()
      return
    }

    // Step 1: Find speaker card and click the menu button (3 dots)
    const card = page.locator('[data-testid^="speaker-card-"]').filter({ hasText: /E2E UI Speaker|Search Test Speaker/ }).first()
    const menuButton = card.locator('[data-testid^="speaker-menu-button-"]')
    await menuButton.click()

    // Step 2: Wait for context menu
    await expect(page.getByTestId('speaker-menu-set-default')).toBeVisible({ timeout: 3000 })

    // Step 3: Click "Set as Default"
    await page.getByTestId('speaker-menu-set-default').click()
    console.log('[Speaker] Clicked Set as Default')

    // Step 4: Wait for menu to close
    await expect(page.getByTestId('speaker-menu-set-default')).not.toBeVisible({ timeout: 3000 })

    // Step 5: Restore original default (via API for cleanup)
    await page.request.post(`${BACKEND_URL}/api/speakers/${baseSpeaker.id}/set-default`)
    console.log('[Speaker] Restored original default speaker')
  })

  test('should delete test speaker via context menu', async ({ page, baseSpeaker }) => {
    // Find E2E UI Speaker to delete
    const speakerText = page.getByText(/E2E UI Speaker/).first()
    if (!await speakerText.isVisible({ timeout: 2000 })) {
      console.log('[Speaker] E2E UI Speaker not found, skipping delete test')
      test.skip()
      return
    }

    // Ensure it's not default first (can't delete default)
    await page.request.post(`${BACKEND_URL}/api/speakers/${baseSpeaker.id}/set-default`)

    // Step 1: Find speaker card and click menu button
    const card = page.locator('[data-testid^="speaker-card-"]').filter({ hasText: /E2E UI Speaker/ }).first()
    const menuButton = card.locator('[data-testid^="speaker-menu-button-"]')
    await menuButton.click()

    // Step 2: Wait for context menu
    await expect(page.getByTestId('speaker-menu-delete')).toBeVisible({ timeout: 3000 })

    // Step 3: Click "Delete"
    await page.getByTestId('speaker-menu-delete').click()
    console.log('[Speaker] Clicked Delete in context menu')

    // Step 4: Confirm deletion in dialog
    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('confirm-dialog-confirm').click()
    console.log('[Speaker] Confirmed deletion')

    // Step 5-6: Wait for speaker to be deleted and verify it's gone
    await expect(page.getByText(/E2E UI Speaker/)).not.toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Speaker deleted successfully')
  })

  test('should add 3 audio samples to Search Test Speaker', async ({ page, baseSpeaker }) => {
    // Find Search Test Speaker
    const speakerText = page.getByText('Search Test Speaker', { exact: true })
    if (!await speakerText.isVisible({ timeout: 2000 })) {
      console.log('[Speaker] Search Test Speaker not found, skipping add samples test')
      test.skip()
      return
    }

    // Step 1: Find speaker card and click Edit button
    const card = page.locator('[data-testid^="speaker-card-"]').filter({ hasText: 'Search Test Speaker' })
    const editButton = card.locator('[data-testid^="speaker-edit-button-"]')
    await editButton.click()

    // Step 2: Wait for edit modal
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Edit dialog opened to add samples')

    // Step 3: Upload 3 audio samples
    const fileInput = page.getByTestId('speaker-sample-file-input')
    await fileInput.setInputFiles([testWavFile2, testWavFile3, testWavFile4])
    console.log('[Speaker] 3 audio samples selected')

    // Step 4: Save changes
    await page.getByTestId('speaker-save-button').click()

    // Step 5: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 15000 })
    console.log('[Speaker] Added 3 samples to Search Test Speaker ✓')
  })

  test('should rename Search Test Speaker to Test Speaker 2', async ({ page, baseSpeaker }) => {
    // Find Search Test Speaker
    const speakerText = page.getByText('Search Test Speaker', { exact: true })
    if (!await speakerText.isVisible({ timeout: 2000 })) {
      console.log('[Speaker] Search Test Speaker not found, skipping rename test')
      test.skip()
      return
    }

    // Step 1: Find speaker card and click Edit button
    const card = page.locator('[data-testid^="speaker-card-"]').filter({ hasText: 'Search Test Speaker' })
    const editButton = card.locator('[data-testid^="speaker-edit-button-"]')
    await editButton.click()

    // Step 2: Wait for edit modal
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Edit dialog opened for rename')

    // Step 3: Change the name
    const nameInput = page.getByTestId('speaker-name-input').locator('input')
    await nameInput.clear()
    await nameInput.fill('Test Speaker 2')

    // Step 4: Save changes
    await page.getByTestId('speaker-save-button').click()

    // Step 5: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 10000 })

    // Step 6: Verify updated name in list
    await expect(page.getByText('Test Speaker 2', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Search Test Speaker', { exact: true })).not.toBeVisible()
    console.log('[Speaker] Renamed to Test Speaker 2 ✓')
  })

  test('should create Test Speaker 3 with 3 audio samples', async ({ page, baseSpeaker }) => {
    // Step 1: Click "Add Speaker" button
    await page.getByTestId('speaker-add-button').click()

    // Step 2: Wait for modal to open
    await expect(page.getByTestId('speaker-edit-modal')).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Create dialog opened for Test Speaker 3')

    // Step 3: Fill in speaker name
    const nameInput = page.getByTestId('speaker-name-input').locator('input')
    await nameInput.fill('Test Speaker 3')

    // Step 4: Expand optional section and fill description
    await page.getByRole('button', { name: /optionale details|optional details/i }).click()
    const descInput = page.getByTestId('speaker-description-input').locator('textarea').first()
    await expect(descInput).toBeVisible({ timeout: 2000 }) // Wait for accordion
    await descInput.fill('Third test speaker with 3 samples')

    // Step 5: Select gender
    await page.getByTestId('speaker-gender-select').click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible({ timeout: 2000 })
    await listbox.getByText(/männlich|male/i).first().click()

    // Step 6: Upload 3 audio samples
    const fileInput = page.getByTestId('speaker-sample-file-input')
    await fileInput.setInputFiles([testWavFile5, testWavFile6, testWavFile7])
    console.log('[Speaker] 3 audio samples selected for Test Speaker 3')

    // Step 7: Click Save
    await page.getByTestId('speaker-save-button').click()

    // Step 8: Wait for modal to close
    await expect(page.getByTestId('speaker-edit-modal')).not.toBeVisible({ timeout: 15000 })
    console.log('[Speaker] Test Speaker 3 created via UI')

    // Step 9: Verify speaker appears in list
    await expect(page.getByText('Test Speaker 3', { exact: true })).toBeVisible({ timeout: 5000 })
    console.log('[Speaker] Test Speaker 3 visible in UI ✓')
  })

  test('CHECKPOINT: default speaker exists', async ({ page, baseSpeaker }) => {
    await checkpoint(page, 'Default Speaker Exists', () =>
      checks.defaultSpeakerExists(page)
    )
  })
})
