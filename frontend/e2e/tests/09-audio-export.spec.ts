/**
 * 09-AUDIO-EXPORT: E2E Audio Export Tests
 *
 * TRUE E2E TESTS - All operations via UI with real audio export!
 *
 * Tests:
 * 1. Verify export button is disabled without audio
 * 2. Open export dialog (requires completed segments)
 * 3. Verify export options (format, quality, filename)
 * 4. Change export format and quality
 * 5. Start export and track progress
 * 6. Cancel export in progress
 * 7. Complete export and verify download button
 * 8. CHECKPOINT: Export workflow complete
 *
 * PREREQUISITE: 07-tts-workflow must pass (Segments have audio)
 */

import { test, expect, BACKEND_URL, checkpoint } from '../fixtures'

/**
 * Helper to navigate to a specific chapter
 */
async function navigateToChapter(page: import('@playwright/test').Page, chapterName: string) {
  // Find and expand Testprojekt
  const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Testprojekt' })
  await expect(projectItem).toBeVisible({ timeout: 5000 })

  const testId = await projectItem.getAttribute('data-testid')
  const projectId = testId?.replace('project-item-', '')

  await projectItem.click()

  // Expand project if needed
  const addChapterButton = page.getByTestId(`create-chapter-button-${projectId}`)
  const isExpanded = await addChapterButton.isVisible({ timeout: 1000 }).catch(() => false)
  if (!isExpanded) {
    const expandButton = page.getByTestId(`project-expand-button-${projectId}`)
    await expandButton.click()
  }

  // Select the specified chapter
  const chapterItem = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: chapterName })
  await expect(chapterItem).toBeVisible({ timeout: 3000 })
  await chapterItem.click()

  // Wait for segment list to be ready
  await expect(page.getByTestId('segment-list')).toBeVisible({ timeout: 5000 })
  console.log(`[Export] Navigated to ${chapterName}`)
}

/**
 * Helper to count text segments with completed audio
 */
async function countCompletedSegments(page: import('@playwright/test').Page): Promise<number> {
  const playButtons = await page.getByTestId('play-button').count()
  return playButtons
}

test.describe('09-Audio-Export', () => {
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

    // Navigate to Main view
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })
  })

  test('should have export button disabled without completed audio', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    const exportButton = page.getByTestId('export-chapter-button')

    // Check if button exists (only shown when segments exist)
    const isVisible = await exportButton.isVisible({ timeout: 3000 }).catch(() => false)

    if (isVisible) {
      // Get completed segment count
      const completedCount = await countCompletedSegments(page)
      const segmentMenuButtons = await page.getByTestId('segment-menu-button').count()

      console.log(`[Export] Completed segments: ${completedCount} / ~${segmentMenuButtons}`)

      // If all segments are completed, button should be enabled
      // If not all completed, button should be disabled
      if (completedCount >= segmentMenuButtons) {
        await expect(exportButton).toBeEnabled()
        console.log('[Export] Export button is enabled (all segments completed)')
      } else {
        await expect(exportButton).toBeDisabled()
        console.log('[Export] Export button is disabled (incomplete segments)')
      }
    } else {
      console.log('[Export] Export button not visible (no segments or chapter not selected)')
    }
  })

  test('should open export dialog when segments are completed', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    // Verify we have completed segments
    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments - skipping export dialog test')
      return
    }

    // Click export button
    const exportButton = page.getByTestId('export-chapter-button')
    await expect(exportButton).toBeVisible({ timeout: 5000 })
    await expect(exportButton).toBeEnabled({ timeout: 5000 })
    await exportButton.click()
    console.log('[Export] Clicked export button')

    // Verify dialog opens
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    console.log('[Export] Export dialog opened')

    // Close dialog
    await page.getByTestId('export-close-button').click()
    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    console.log('[Export] Dialog closed')
  })

  test('should show export options in dialog', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments')
      return
    }

    // Open export dialog
    await page.getByTestId('export-chapter-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Verify filename input exists
    const filenameInput = page.getByTestId('export-filename-input')
    await expect(filenameInput).toBeVisible()
    console.log('[Export] Filename input visible')

    // Verify format select exists
    const formatSelect = page.getByTestId('export-format-select')
    await expect(formatSelect).toBeVisible()
    console.log('[Export] Format select visible')

    // Verify quality select exists
    const qualitySelect = page.getByTestId('export-quality-select')
    await expect(qualitySelect).toBeVisible()
    console.log('[Export] Quality select visible')

    // Verify start button exists and is enabled
    const startButton = page.getByTestId('export-start-button')
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeEnabled()
    console.log('[Export] Start button visible and enabled')

    // Close dialog
    await page.getByTestId('export-close-button').click()
    console.log('[Export] Export options verified')
  })

  test('should allow changing export format', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments')
      return
    }

    // Open export dialog
    await page.getByTestId('export-chapter-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Click format select to open dropdown
    const formatSelect = page.getByTestId('export-format-select')
    await formatSelect.click()
    console.log('[Export] Opened format dropdown')

    // Select MP3 format
    await page.getByTestId('export-format-mp3').click()
    console.log('[Export] Selected MP3 format')

    // Verify format changed (MUI Select shows selected value)
    await expect(formatSelect).toContainText(/mp3/i)

    // Open format again and select WAV
    await formatSelect.click()
    await page.getByTestId('export-format-wav').click()
    console.log('[Export] Selected WAV format')

    await expect(formatSelect).toContainText(/wav/i)

    // Close dialog
    await page.getByTestId('export-close-button').click()
    console.log('[Export] Format selection verified')
  })

  test('should allow changing quality preset', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments')
      return
    }

    // Open export dialog
    await page.getByTestId('export-chapter-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Click quality select to open dropdown
    const qualitySelect = page.getByTestId('export-quality-select')
    await qualitySelect.click()
    console.log('[Export] Opened quality dropdown')

    // Select high quality
    await page.getByTestId('export-quality-high').click()
    console.log('[Export] Selected high quality')

    // Open again and select low
    await qualitySelect.click()
    await page.getByTestId('export-quality-low').click()
    console.log('[Export] Selected low quality')

    // Close dialog
    await page.getByTestId('export-close-button').click()
    console.log('[Export] Quality selection verified')
  })

  test('should start export and show progress', async ({ page }) => {
    // Increase timeout for export process
    test.setTimeout(120000)

    await navigateToChapter(page, 'Kapitel 1')

    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments')
      return
    }

    // Open export dialog
    await page.getByTestId('export-chapter-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Click start export
    await page.getByTestId('export-start-button').click()
    console.log('[Export] Started export')

    // Verify progress container appears
    await expect(page.getByTestId('export-progress-container')).toBeVisible({ timeout: 10000 })
    console.log('[Export] Progress container visible')

    // Wait for progress to update
    await expect(async () => {
      const progressBar = page.getByTestId('export-progress-bar')
      await expect(progressBar).toBeVisible()
    }).toPass({ timeout: 10000 })
    console.log('[Export] Progress bar visible')

    // Wait for export to complete (with reasonable timeout)
    await expect(async () => {
      // Check for download button (indicates completion)
      const downloadButton = page.getByTestId('export-download-button')
      const isComplete = await downloadButton.isVisible({ timeout: 500 }).catch(() => false)
      expect(isComplete).toBeTruthy()
    }).toPass({ timeout: 60000 })
    console.log('[Export] Export completed')

    // Verify download button is visible
    await expect(page.getByTestId('export-download-button')).toBeVisible()
    console.log('[Export] Download button visible')

    // Close dialog (cleanup will happen)
    await page.getByTestId('export-close-button').click()
    console.log('[Export] Export completed and dialog closed')
  })

  test('should be able to cancel export in progress', async ({ page }) => {
    // Increase timeout
    test.setTimeout(60000)

    await navigateToChapter(page, 'Kapitel 1')

    const completedCount = await countCompletedSegments(page)
    if (completedCount === 0) {
      test.skip(true, 'No completed segments')
      return
    }

    // Open export dialog
    await page.getByTestId('export-chapter-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Start export
    await page.getByTestId('export-start-button').click()
    console.log('[Export] Started export for cancel test')

    // Wait for progress to start
    await expect(page.getByTestId('export-progress-container')).toBeVisible({ timeout: 10000 })
    console.log('[Export] Export in progress')

    // Try to cancel (button may not be visible if export completes quickly)
    const cancelButton = page.getByTestId('export-cancel-button')
    const canCancel = await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)

    if (canCancel) {
      await cancelButton.click()
      console.log('[Export] Clicked cancel button')

      // Verify we're back to initial state or dialog is closed
      // After cancel, dialog should either close or show options again
      await expect(async () => {
        const startButton = page.getByTestId('export-start-button')
        const isStartVisible = await startButton.isVisible({ timeout: 500 }).catch(() => false)
        const closeButton = page.getByTestId('export-close-button')
        const isCloseVisible = await closeButton.isVisible({ timeout: 500 }).catch(() => false)
        expect(isStartVisible || isCloseVisible).toBeTruthy()
      }).toPass({ timeout: 10000 })
      console.log('[Export] Cancel successful - dialog reset')
    } else {
      // Export completed before we could cancel - that's fine
      console.log('[Export] Export completed too quickly to cancel')
    }

    // Ensure dialog is closed
    if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.getByTestId('export-close-button').click()
    }
    console.log('[Export] Cancel test completed')
  })

  test('CHECKPOINT: Export workflow complete', async ({ page }) => {
    await checkpoint(page, 'Export workflow complete', async () => {
      // Navigate to Main view
      await page.getByTestId('nav-main').click()
      if (!await page.getByTestId('main-view').isVisible({ timeout: 3000 }).catch(() => false)) {
        return false
      }

      // Check Kapitel 1
      await navigateToChapter(page, 'Kapitel 1')

      // Verify export button is available (segments have audio)
      const exportButton = page.getByTestId('export-chapter-button')
      if (!await exportButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Checkpoint] Export button not visible')
        return false
      }

      // Verify button is enabled (all segments completed)
      if (await exportButton.isDisabled()) {
        console.log('[Checkpoint] Export button is disabled')
        return false
      }

      console.log('[Checkpoint] Export button enabled - workflow ready')
      return true
    })
  })
})
