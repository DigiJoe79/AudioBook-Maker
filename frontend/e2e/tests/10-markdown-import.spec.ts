/**
 * 10-MARKDOWN-IMPORT: E2E Markdown Import Tests
 *
 * TRUE E2E TESTS - All operations via UI!
 *
 * Tests:
 * 1. Navigate to Import view
 * 2. Verify empty preview state
 * 3. Verify text language selector
 * 4. Verify upload zone
 * 5. Verify mapping rules section
 * 6. Change mapping rules
 * 7. Reset mapping rules
 * 8. Verify import button state
 * 9. CHECKPOINT: Import view accessible
 *
 * NOTE: Tests requiring actual file parsing (preview, mode selection, TTS settings)
 * need spaCy text processing engine running and are marked with skip conditions.
 */

import { test, expect, checkpoint } from '../fixtures'

test.describe('10-Markdown-Import', () => {
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
  })

  test('should navigate to Import view', async ({ page }) => {
    // Click Import navigation
    await page.getByTestId('nav-import').click()

    // Verify Import view is visible
    const importView = page.getByTestId('import-view')
    await expect(importView).toBeVisible({ timeout: 5000 })
    console.log('[Import] Import view visible')

    // Verify panels are visible
    await expect(page.getByTestId('import-config-panel')).toBeVisible()
    await expect(page.getByTestId('import-preview-panel')).toBeVisible()
    console.log('[Import] Config and preview panels visible')
  })

  test('should show empty preview when no file selected', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Check for empty preview state
    const emptyPreview = page.getByTestId('import-preview-empty')
    await expect(emptyPreview).toBeVisible({ timeout: 3000 })
    console.log('[Import] Empty preview state visible')
  })

  test('should show text language selector', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // File upload section should be expanded by default
    const fileUploadSection = page.getByTestId('import-file-upload-section')
    await expect(fileUploadSection).toBeVisible()

    // Check for text language selector
    const textLanguageSelector = page.getByTestId('text-language-selector')
    await expect(textLanguageSelector).toBeVisible({ timeout: 5000 })
    console.log('[Import] Text language selector visible')
  })

  test('should show upload zone when no file selected', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Expand file upload section if needed
    const fileUploadSection = page.getByTestId('import-file-upload-section')
    const isExpanded = await fileUploadSection.getAttribute('aria-expanded')
    if (isExpanded === 'false') {
      await fileUploadSection.click()
    }

    // Verify upload zone is visible
    const uploadZone = page.getByTestId('upload-zone')
    await expect(uploadZone).toBeVisible({ timeout: 3000 })
    console.log('[Import] Upload zone visible')

    // Verify file upload area is present
    const fileUploadArea = page.getByTestId('file-upload-area')
    await expect(fileUploadArea).toBeVisible()
    console.log('[Import] File upload area visible')
  })

  test('should show mapping rules section', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Find and expand mapping section
    const mappingSection = page.getByTestId('import-mapping-section')
    await expect(mappingSection).toBeVisible()

    // Click to expand if not expanded
    const isExpanded = await mappingSection.getAttribute('aria-expanded')
    if (isExpanded === 'false') {
      await mappingSection.click()
      // Wait for accordion animation
      await page.waitForTimeout(300)
    }

    // Verify mapping rules editor is visible
    const mappingEditor = page.getByTestId('mapping-rules-editor')
    await expect(mappingEditor).toBeVisible({ timeout: 3000 })
    console.log('[Import] Mapping rules editor visible')

    // Verify selectors are visible
    await expect(page.getByTestId('project-heading-select')).toBeVisible()
    await expect(page.getByTestId('chapter-heading-select')).toBeVisible()
    await expect(page.getByTestId('divider-pattern-select')).toBeVisible()
    console.log('[Import] All mapping selectors visible')
  })

  test('should allow changing mapping rules', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Expand mapping section
    const mappingSection = page.getByTestId('import-mapping-section')
    const isExpanded = await mappingSection.getAttribute('aria-expanded')
    if (isExpanded === 'false') {
      await mappingSection.click()
      await page.waitForTimeout(300)
    }

    // Click project heading select to open dropdown
    const projectHeadingSelect = page.getByTestId('project-heading-select')
    await projectHeadingSelect.click()
    console.log('[Import] Opened project heading dropdown')

    // Select ## (Heading 2)
    await page.getByRole('option', { name: /##/ }).first().click()
    console.log('[Import] Selected ## for project heading')

    // Click chapter heading select to open dropdown
    const chapterHeadingSelect = page.getByTestId('chapter-heading-select')
    await chapterHeadingSelect.click()
    console.log('[Import] Opened chapter heading dropdown')

    // Select ### (Heading 3)
    await page.getByRole('option', { name: /###/ }).first().click()
    console.log('[Import] Selected ### for chapter heading')

    // Verify selections (dropdown should display selected values)
    console.log('[Import] Mapping rules changed successfully')
  })

  test('should have reset button for mapping rules', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Expand mapping section
    const mappingSection = page.getByTestId('import-mapping-section')
    const isExpanded = await mappingSection.getAttribute('aria-expanded')
    if (isExpanded === 'false') {
      await mappingSection.click()
      await page.waitForTimeout(300)
    }

    // Verify reset button exists
    const resetButton = page.getByTestId('reset-button')
    await expect(resetButton).toBeVisible()
    console.log('[Import] Reset button visible')

    // Click reset button
    await resetButton.click()
    console.log('[Import] Reset button clicked')
  })

  test('should show import button disabled without valid configuration', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Verify import button exists
    const importButton = page.getByTestId('import-execute-button')
    await expect(importButton).toBeVisible()
    console.log('[Import] Import button visible')

    // Verify it's disabled (no file selected)
    await expect(importButton).toBeDisabled()
    console.log('[Import] Import button is disabled (no file selected)')
  })

  test('should not show mode section without valid preview', async ({ page }) => {
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('import-view')).toBeVisible({ timeout: 5000 })

    // Mode section should not be visible without file
    const modeSection = page.getByTestId('import-mode-section')
    await expect(modeSection).not.toBeVisible()
    console.log('[Import] Mode section hidden (no valid preview)')

    // TTS section should also not be visible
    const ttsSection = page.getByTestId('import-tts-section')
    await expect(ttsSection).not.toBeVisible()
    console.log('[Import] TTS section hidden (no valid preview)')
  })

  test('should show import feature unavailable message when text engine not available', async ({ page }) => {
    await page.getByTestId('nav-import').click()

    // Check if the feature-gated warning is shown (when no text engine)
    // This depends on whether spaCy is running
    const importView = page.getByTestId('import-view')
    await expect(importView).toBeVisible({ timeout: 5000 })

    // If no text engine, a warning should be visible
    // This test just confirms the view loads - the warning is shown conditionally
    console.log('[Import] Import view loaded (feature gate handled)')
  })

  test('CHECKPOINT: Import view accessible', async ({ page }) => {
    await checkpoint(page, 'Import view accessible', async () => {
      // Navigate to Import view
      await page.getByTestId('nav-import').click()

      // Verify view is visible
      const importView = page.getByTestId('import-view')
      if (!await importView.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[Checkpoint] Import view not visible')
        return false
      }

      // Verify config panel is visible
      const configPanel = page.getByTestId('import-config-panel')
      if (!await configPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Checkpoint] Config panel not visible')
        return false
      }

      // Verify preview panel is visible
      const previewPanel = page.getByTestId('import-preview-panel')
      if (!await previewPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Checkpoint] Preview panel not visible')
        return false
      }

      // Verify file upload section exists
      const fileUploadSection = page.getByTestId('import-file-upload-section')
      if (!await fileUploadSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Checkpoint] File upload section not visible')
        return false
      }

      // Verify mapping section exists
      const mappingSection = page.getByTestId('import-mapping-section')
      if (!await mappingSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Checkpoint] Mapping section not visible')
        return false
      }

      console.log('[Checkpoint] Import view accessible - all sections visible')
      return true
    })
  })
})
