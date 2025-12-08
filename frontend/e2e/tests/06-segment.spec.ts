/**
 * 06-SEGMENT: E2E Segment Management Tests
 *
 * TRUE E2E TESTS - All operations via UI!
 *
 * Tests:
 * 1. Create title segment "Kapitel 1" via Drag & Drop
 * 2. Create divider via Drag & Drop
 * 3. Verify segments have correct speaker (Test Speaker)
 * 4. Update segment text via EditSegmentDialog
 * 5. Update segment speaker via EditSegmentSettingsDialog
 * 6. Delete segment
 *
 * PREREQUISITE: 05-text-upload must pass (Kapitel 1 has segments)
 * CHECKPOINT: Segment CRUD operations work correctly
 */

import { test, expect, BACKEND_URL, checkpoint } from '../fixtures'

/**
 * Helper for @dnd-kit drag and drop with Playwright.
 * Drags from source element to a pixel position (like a real user would).
 * Key: PointerSensor needs distance > 8px to activate.
 */
async function dndKitDragToPosition(
  page: import('@playwright/test').Page,
  sourceSelector: string,
  targetX: number,
  targetY: number
) {
  const source = page.locator(sourceSelector)
  await expect(source).toBeVisible({ timeout: 3000 })

  const sourceBox = await source.boundingBox()
  if (!sourceBox) {
    throw new Error('Cannot get bounding box for source')
  }

  const startX = sourceBox.x + sourceBox.width / 2
  const startY = sourceBox.y + sourceBox.height / 2

  // Step 1: Move to source and hover
  await page.mouse.move(startX, startY)
  await page.waitForTimeout(100)

  // Step 2: Mouse down to start drag
  await page.mouse.down()
  await page.waitForTimeout(100)

  // Step 3: Move in steps (required for @dnd-kit PointerSensor)
  // First move 10px to activate (distance constraint is 8px)
  await page.mouse.move(startX + 10, startY, { steps: 5 })
  await page.waitForTimeout(50)

  // Then move to target in multiple steps
  const steps = 20
  for (let i = 1; i <= steps; i++) {
    const x = startX + 10 + ((targetX - startX - 10) * i) / steps
    const y = startY + ((targetY - startY) * i) / steps
    await page.mouse.move(x, y)
    await page.waitForTimeout(10)
  }

  // Step 4: Final position and release
  await page.mouse.move(targetX, targetY)
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

// Helper to navigate to Kapitel 1
async function navigateToKapitel1(page: import('@playwright/test').Page) {
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

  // Select Kapitel 1
  const chapter1Item = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 1' })
  await expect(chapter1Item).toBeVisible({ timeout: 3000 })
  await chapter1Item.click()

  // Wait for segment list to be ready
  await expect(page.getByTestId('segment-list')).toBeVisible({ timeout: 5000 })
}

test.describe('06-Segment', () => {
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

  test('should create divider via Drag & Drop at position 0 (SSE test)', async ({ page }) => {
    // Navigate ONCE at the start
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // Get the segment list's bounding box to find drop position
    const listBox = await segmentList.boundingBox()
    if (!listBox) throw new Error('Cannot get segment list bounding box')

    // Count segments before (count menu buttons as proxy for segment items)
    const segmentCountBefore = await page.getByTestId('segment-menu-button').count()
    console.log(`[Segment] Segment count before: ${segmentCountBefore}`)

    // Drop at the TOP of the segment list (position 0)
    // X: center of list, Y: near top of list
    const dropX = listBox.x + listBox.width / 2
    const dropY = listBox.y + 120  // 120px from top of list
    console.log(`[Segment] Drop target: x=${dropX}, y=${dropY}`)

    // Drag "Pause" chip to top of segment list
    await dndKitDragToPosition(
      page,
      '[data-testid="create-divider-button"]',
      dropX,
      dropY
    )
    console.log('[Segment] Dragged Pause chip to top of segment list (= position 0)')

    // Wait for QuickCreateDividerDialog
    await expect(page.getByTestId('quick-create-divider-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Segment] QuickCreateDividerDialog opened')

    // The default duration should be 2s, let's keep it
    // Click Add Pause button
    await page.getByTestId('quick-create-divider-submit').click()
    console.log('[Segment] Clicked Add Pause')

    // Wait for dialog to close
    await expect(page.getByTestId('quick-create-divider-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Segment] Dialog closed')

    // NO navigation here! Wait for SSE to update the UI
    // The segment count should increase via SSE event, not via refetch
    await expect(async () => {
      const count = await page.getByTestId('segment-menu-button').count()
      expect(count).toBe(segmentCountBefore + 1)
    }).toPass({ timeout: 5000 })
    console.log('[Segment] SSE updated segment count ✓')

    // Verify first item in list is now a divider (via SSE update, no refetch)
    const firstListItem = segmentList.locator('li').first()
    await expect(firstListItem).toContainText('Szenenumbruch', { timeout: 5000 })
    console.log('[Segment] Divider created at position 0 via SSE ✓')
  })

  test('should create title segment "Kapitel 1" via Drag & Drop at position 0 (SSE test)', async ({ page }) => {
    // Navigate ONCE at the start
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // Verify first item is the divider from previous test (loaded via refetch from navigation)
    const firstListItem = segmentList.locator('li').first()
    await expect(firstListItem).toContainText('Szenenumbruch')
    console.log('[Segment] First segment is divider (from previous test)')

    // Get the segment list's bounding box to find drop position
    const listBox = await segmentList.boundingBox()
    if (!listBox) throw new Error('Cannot get segment list bounding box')

    // Count segments before
    const segmentCountBefore = await page.getByTestId('segment-menu-button').count()
    console.log(`[Segment] Segment count before: ${segmentCountBefore}`)

    // Drop at the TOP of the segment list (position 0)
    const dropX = listBox.x + listBox.width / 2
    const dropY = listBox.y + 120  // 120px from top of list
    console.log(`[Segment] Drop target: x=${dropX}, y=${dropY}`)

    // Drag "Text Segment" chip to top of segment list
    await dndKitDragToPosition(
      page,
      '[data-testid="create-segment-button"]',
      dropX,
      dropY
    )
    console.log('[Segment] Dragged Text Segment chip to top of list (= position 0)')

    // Wait for QuickCreateSegmentDialog
    await expect(page.getByTestId('quick-create-segment-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Segment] QuickCreateSegmentDialog opened')

    // Fill in the segment text
    const textInput = page.getByTestId('quick-create-segment-text-input')
    await textInput.fill('Kapitel 1')
    console.log('[Segment] Entered text: "Kapitel 1"')

    // Click Create button
    await page.getByTestId('quick-create-segment-submit').click()
    console.log('[Segment] Clicked Create')

    // Wait for dialog to close
    await expect(page.getByTestId('quick-create-segment-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Segment] Dialog closed')

    // NO navigation here! Wait for SSE to update the UI
    // The segment count should increase via SSE event, not via refetch
    await expect(async () => {
      const count = await page.getByTestId('segment-menu-button').count()
      expect(count).toBe(segmentCountBefore + 1)
    }).toPass({ timeout: 5000 })
    console.log('[Segment] SSE updated segment count ✓')

    // Verify order in UI via SSE update (no refetch)
    const listItems = segmentList.locator('li')
    await expect(listItems.first()).toContainText('Kapitel 1', { timeout: 5000 })
    await expect(listItems.nth(1)).toContainText('Szenenumbruch')

    console.log('[Segment] Title "Kapitel 1" at position 0, Divider at position 1 via SSE ✓')
  })

  test('should verify segment structure: Title (0), Divider (1), Text segments (2+)', async ({ page }) => {
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // Count all segments in UI (using menu buttons as proxy)
    const totalSegments = await page.getByTestId('segment-menu-button').count()
    console.log(`[Segment] Total segments in UI: ${totalSegments}`)

    // Verify we have at least 3 segments (title, divider, and at least one from text-upload)
    expect(totalSegments).toBeGreaterThanOrEqual(3)

    // Use list items for position verification
    const listItems = segmentList.locator('li')

    // Position 0: Title segment "Kapitel 1"
    await expect(listItems.first()).toContainText('Kapitel 1')
    console.log('[Segment] Position 0: Title "Kapitel 1" ✓')

    // Position 1: Divider
    await expect(listItems.nth(1)).toContainText('Szenenumbruch')
    console.log('[Segment] Position 1: Divider ✓')

    // Position 2+: Text segments from text-upload (should contain story text)
    await expect(listItems.nth(2)).toContainText('Kunst des Geschichtenerzählens')
    console.log('[Segment] Position 2+: Text segments present ✓')
  })

  test('should update segment text via EditSegmentDialog', async ({ page }) => {
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // First segment should be "Kapitel 1"
    const firstListItem = segmentList.locator('li').first()
    await expect(firstListItem).toContainText('Kapitel 1')

    const segmentMenuButton = page.getByTestId('segment-menu-button').first()
    await expect(segmentMenuButton).toBeVisible({ timeout: 5000 })
    await segmentMenuButton.click()
    console.log('[Segment] Opened segment menu')

    // Click Edit Text
    await expect(page.getByTestId('segment-menu-edit')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('segment-menu-edit').click()
    console.log('[Segment] Clicked Edit Text')

    // Wait for EditSegmentDialog
    await expect(page.getByTestId('edit-segment-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Segment] EditSegmentDialog opened')

    // Get the editor and current text
    const editor = page.getByTestId('edit-segment-text-editor')
    await expect(editor).toBeVisible({ timeout: 3000 })

    // Clear and enter new text (using keyboard)
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Kapitel 1 - Einleitung')
    console.log('[Segment] Changed text to "Kapitel 1 - Einleitung"')

    // Click Save
    await page.getByTestId('edit-segment-save-button').click()
    console.log('[Segment] Clicked Save')

    // Wait for dialog to close
    await expect(page.getByTestId('edit-segment-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Segment] Dialog closed')

    // NO navigation - wait for SSE to update the UI
    await expect(async () => {
      const firstItem = segmentList.locator('li').first()
      await expect(firstItem).toContainText('Kapitel 1 - Einleitung')
    }).toPass({ timeout: 5000 })
    console.log('[Segment] Text updated via SSE ✓')
  })

  test('should update segment speaker via EditSegmentSettingsDialog', async ({ page }) => {
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // First segment should be "Kapitel 1 - Einleitung" from previous test
    const firstListItem = segmentList.locator('li').first()
    await expect(firstListItem).toContainText('Kapitel 1 - Einleitung')
    console.log('[Segment] Found target segment: Kapitel 1 - Einleitung')

    // Open menu on first segment
    const segmentMenuButton = page.getByTestId('segment-menu-button').first()
    await expect(segmentMenuButton).toBeVisible({ timeout: 5000 })
    await segmentMenuButton.click()
    console.log('[Segment] Opened segment menu')

    // Click Settings
    await expect(page.getByTestId('segment-menu-settings')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('segment-menu-settings').click()
    console.log('[Segment] Clicked Settings')

    // Wait for EditSegmentSettingsDialog
    await expect(page.getByTestId('segment-settings-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Segment] EditSegmentSettingsDialog opened')

    // Change speaker - select a different one
    const speakerSelect = page.getByTestId('segment-settings-speaker-select')
    await expect(speakerSelect).toBeVisible({ timeout: 3000 })
    await speakerSelect.click()

    // Select Test Speaker 3 (different from current)
    const option = page.getByRole('option', { name: 'Test Speaker 3' })
    await expect(option).toBeVisible({ timeout: 2000 })
    await option.click()
    console.log('[Segment] Selected Test Speaker 3')

    // Click Save
    await page.getByRole('button', { name: /save|speichern/i }).click()
    console.log('[Segment] Clicked Save')

    // Wait for dialog to close
    await expect(page.getByTestId('segment-settings-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Segment] Dialog closed')

    // NO navigation - wait for SSE, then re-open settings to verify speaker was changed
    await expect(async () => {
      await segmentMenuButton.click()
      await page.getByTestId('segment-menu-settings').click()
      await expect(page.getByTestId('segment-settings-dialog')).toBeVisible({ timeout: 2000 })

      // Verify selected speaker in dropdown shows "Test Speaker 3"
      const speakerSelectAfter = page.getByTestId('segment-settings-speaker-select')
      await expect(speakerSelectAfter).toContainText('Test Speaker 3')
    }).toPass({ timeout: 5000 })
    console.log('[Segment] Speaker updated to Test Speaker 3 via SSE ✓')

    // Close dialog
    await page.getByRole('button', { name: /cancel|abbrechen/i }).click()
  })

  test('should delete segment via SegmentMenu', async ({ page }) => {
    await navigateToKapitel1(page)
    console.log('[Segment] Selected Kapitel 1')

    // Wait for segment list to load
    const segmentList = page.getByTestId('segment-list')
    await expect(segmentList).toBeVisible({ timeout: 5000 })

    // Count segments before deletion (using menu buttons as proxy)
    const segmentCountBefore = await page.getByTestId('segment-menu-button').count()
    console.log(`[Segment] Segment count before: ${segmentCountBefore}`)

    // Get the text of the last segment
    const lastListItem = segmentList.locator('li').last()
    const lastSegmentText = await lastListItem.textContent()
    console.log(`[Segment] Last segment text: ${lastSegmentText?.substring(0, 50)}...`)

    // We'll delete the LAST segment (to avoid affecting our title/divider structure)
    const segmentMenuButtons = page.getByTestId('segment-menu-button')
    const lastMenuButton = segmentMenuButtons.last()
    await expect(lastMenuButton).toBeVisible({ timeout: 5000 })
    await lastMenuButton.click()
    console.log('[Segment] Opened last segment menu')

    // Click Delete
    await expect(page.getByTestId('segment-menu-delete')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('segment-menu-delete').click()
    console.log('[Segment] Clicked Delete')

    // Wait for confirmation dialog
    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Segment] Confirmation dialog opened')

    // Confirm deletion
    await page.getByTestId('confirm-dialog-confirm').click()
    console.log('[Segment] Confirmed deletion')

    // Wait for dialog to close
    await expect(page.getByTestId('confirm-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Segment] Dialog closed')

    // NO navigation - wait for SSE to update the UI
    await expect(async () => {
      const count = await page.getByTestId('segment-menu-button').count()
      expect(count).toBe(segmentCountBefore - 1)
    }).toPass({ timeout: 5000 })

    const segmentCountAfter = await page.getByTestId('segment-menu-button').count()
    console.log(`[Segment] Segment count: ${segmentCountBefore} → ${segmentCountAfter} via SSE ✓`)
  })

  test('CHECKPOINT: Segment CRUD operations verified', async ({ page }) => {
    await checkpoint(page, 'Segment CRUD verified', async () => {
      // Navigate to Kapitel 1
      await navigateToKapitel1(page)

      // Wait for segment list
      const segmentList = page.getByTestId('segment-list')
      if (!await segmentList.isVisible({ timeout: 3000 })) return false

      // 1. Has segments
      const segmentCount = await page.getByTestId('segment-menu-button').count()
      if (segmentCount === 0) return false

      // 2. First segment contains "Kapitel 1 - Einleitung" (after edit)
      const firstListItem = segmentList.locator('li').first()
      const firstSegmentText = await firstListItem.textContent()
      if (!firstSegmentText?.includes('Kapitel 1 - Einleitung')) return false

      // 3. Second segment is a divider
      const secondListItem = segmentList.locator('li').nth(1)
      const secondSegmentText = await secondListItem.textContent()
      if (!secondSegmentText?.includes('Szenenumbruch')) return false

      return true
    })
  })
})
