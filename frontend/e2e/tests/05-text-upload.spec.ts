/**
 * 05-TEXT-UPLOAD: E2E Text Upload Tests
 *
 * TRUE E2E TESTS - All operations via UI!
 *
 * Tests:
 * 1. Upload text via TextField to Kapitel 1 with Test Speaker 2
 * 2. Upload text via File Upload to Kapitel 2 with Test Speaker 3
 *
 * PREREQUISITE: 04-project-chapter must pass (Testprojekt with 2 chapters)
 * CHECKPOINT: Both chapters have segments
 */

import { test, expect, BACKEND_URL, checkpoint } from '../fixtures'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Create a test text file
 */
function createTestTextFile(filename: string, content: string): string {
  const tempPath = path.join(process.cwd(), 'e2e', filename)
  fs.writeFileSync(tempPath, content, 'utf-8')
  return tempPath
}

/**
 * Cleanup test text files
 */
function cleanupTestTextFiles(...filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Long text for testing (~1 A4 page)
const LONG_TEXT = `Die Kunst des Geschichtenerzählens ist so alt wie die Menschheit selbst. Seit den frühesten Tagen unserer Existenz haben wir Geschichten erzählt, um Wissen weiterzugeben, Emotionen zu teilen und unsere Erfahrungen zu verarbeiten. Von den Höhlenmalereien unserer Vorfahren bis zu den modernsten digitalen Medien hat sich die Form des Erzählens gewandelt, aber der grundlegende Wunsch, Geschichten zu teilen, ist geblieben.

In der heutigen digitalen Welt erleben wir eine Renaissance des gesprochenen Wortes. Hörbücher haben sich von einem Nischenprodukt zu einem bedeutenden Teil des Buchmarktes entwickelt. Menschen hören Geschichten während der Fahrt zur Arbeit, beim Sport oder einfach zum Entspannen. Die Technologie hat es möglich gemacht, dass jeder Zugang zu einer praktisch unbegrenzten Bibliothek von Geschichten hat.

Die Text-zu-Sprache-Technologie hat in den letzten Jahren enorme Fortschritte gemacht. Was einst robotisch und unnatürlich klang, nähert sich heute immer mehr der menschlichen Sprache an. Moderne TTS-Systeme können Emotionen vermitteln, Pausen setzen und sogar verschiedene Stimmen für unterschiedliche Charaktere verwenden. Diese Entwicklung eröffnet völlig neue Möglichkeiten für Autoren, Verlage und Content-Ersteller.

Doch trotz aller technologischen Fortschritte bleibt die menschliche Komponente unverzichtbar. Ein erfahrener Sprecher kann Nuancen erfassen und vermitteln, die selbst die fortschrittlichste KI noch nicht vollständig reproduzieren kann. Die Kombination aus menschlicher Kreativität und technologischer Unterstützung scheint der vielversprechendste Weg in die Zukunft zu sein.

Die Demokratisierung der Audiobook-Produktion bedeutet auch, dass mehr Stimmen gehört werden können. Geschichten, die früher nie den Weg zu einem professionellen Hörbuch gefunden hätten, können nun von ihren Autoren selbst oder von engagierten Vorlesern zum Leben erweckt werden. Dies bereichert die kulturelle Landschaft und ermöglicht eine größere Vielfalt an Perspektiven und Erzählungen.`

// Test data
let testTextFile: string

test.describe('05-Text-Upload', () => {

  test.beforeAll(async () => {
    // Create test text file for file upload test
    testTextFile = createTestTextFile('test-upload.txt', LONG_TEXT)
    console.log('[Text-Upload] Test text file created')
  })

  test.afterAll(async () => {
    cleanupTestTextFiles(testTextFile)
    console.log('[Text-Upload] Test text file cleaned up')
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

    // Navigate to Main view
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })
  })

  test('should upload text to Kapitel 1 with Test Speaker 2', async ({ page }) => {
    // Step 1: Find and expand Testprojekt
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

    // Step 2: Select Kapitel 1
    const chapter1Item = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 1' })
    await expect(chapter1Item).toBeVisible({ timeout: 3000 })
    await chapter1Item.click()
    // Wait for chapter to be selected by checking upload button appears
    await expect(page.getByTestId('upload-text-button')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Selected Kapitel 1')

    // Step 3: Click "Upload Text" button
    await expect(page.getByTestId('upload-text-button')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('upload-text-button').click()
    console.log('[Text-Upload] Clicked Upload Text button')

    // Step 4: Wait for dialog
    await expect(page.getByTestId('text-upload-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Dialog opened')

    // Step 5: Enter long text
    const textInput = page.getByTestId('text-upload-text-input').locator('textarea').first()
    await textInput.fill(LONG_TEXT)
    console.log('[Text-Upload] Text entered')

    // Step 6: Open TTS Accordion
    await page.getByTestId('text-upload-tts-accordion').click()

    // Step 7: Wait for accordion to expand and verify speaker select is visible
    const speakerSelect = page.getByTestId('text-upload-speaker-select')
    await expect(speakerSelect).toBeVisible({ timeout: 3000 })
    console.log('[Text-Upload] TTS accordion opened')

    // Get the current selected value (MUI Select shows value in a hidden input or in the display)
    const selectedSpeaker = await speakerSelect.locator('input').inputValue().catch(() => null)
      || await speakerSelect.textContent()
    console.log(`[Text-Upload] Current speaker: ${selectedSpeaker}`)

    // Note: Default speaker might be "Test Speaker" or already set
    // We verify it's visible and then change it

    // Step 8: Select "Test Speaker 2"
    await speakerSelect.click()
    const option = page.getByRole('option', { name: 'Test Speaker 2' })
    await expect(option).toBeVisible({ timeout: 2000 })
    await option.click()
    console.log('[Text-Upload] Selected Test Speaker 2')

    // Step 9: Click Submit
    await page.getByTestId('text-upload-submit-button').click()
    console.log('[Text-Upload] Clicked Submit')

    // Step 10: Wait for dialog to close and segments to be created
    await expect(page.getByTestId('text-upload-dialog')).not.toBeVisible({ timeout: 30000 })
    console.log('[Text-Upload] Dialog closed')

    // Step 11: Verify segments were created (via API) - poll until segments appear
    const projectsResponse = await page.request.get(`${BACKEND_URL}/api/projects`)
    const projects = await projectsResponse.json()
    const testprojekt = projects.find((p: any) => p.title === 'Testprojekt')
    const kapitel1Info = testprojekt?.chapters.find((c: any) => c.title === 'Kapitel 1')

    expect(kapitel1Info).toBeTruthy()

    // Poll for segments to appear (SSE should have updated, but API call confirms)
    await expect(async () => {
      const chapterResponse = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel1Info.id}`)
      const chapter = await chapterResponse.json()
      expect(chapter.segments?.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10000 })

    // Get chapter with segments for final verification
    const chapterResponse = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel1Info.id}`)
    const chapter = await chapterResponse.json()

    console.log(`[Text-Upload] Created ${chapter.segments.length} segments in Kapitel 1 ✓`)

    // Verify speaker is set to Test Speaker 2
    const firstSegment = chapter.segments[0]
    expect(firstSegment.ttsSpeakerName).toBe('Test Speaker 2')
    console.log('[Text-Upload] Speaker verified: Test Speaker 2 ✓')
  })

  test('should upload text file to Kapitel 2 with Test Speaker 3', async ({ page }) => {
    // Step 1: Find and expand Testprojekt
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

    // Step 2: Select Kapitel 2
    const chapter2Item = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 2' })
    await expect(chapter2Item).toBeVisible({ timeout: 3000 })
    await chapter2Item.click()
    // Wait for chapter to be selected
    await expect(page.getByTestId('upload-text-button')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Selected Kapitel 2')

    // Step 3: Click "Upload Text" button
    await expect(page.getByTestId('upload-text-button')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('upload-text-button').click()
    console.log('[Text-Upload] Clicked Upload Text button')

    // Step 4: Wait for dialog
    await expect(page.getByTestId('text-upload-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Dialog opened')

    // Step 5: Upload text file via file input
    const fileInput = page.getByTestId('file-input')
    await fileInput.setInputFiles(testTextFile)
    console.log('[Text-Upload] Text file uploaded')

    // Step 6: Verify file is selected (file info visible)
    await expect(page.getByTestId('selected-file-info')).toBeVisible({ timeout: 3000 })
    console.log('[Text-Upload] File selected confirmed')

    // Step 7: Open TTS Accordion
    await page.getByTestId('text-upload-tts-accordion').click()
    const speakerSelect = page.getByTestId('text-upload-speaker-select')
    await expect(speakerSelect).toBeVisible({ timeout: 3000 })
    console.log('[Text-Upload] TTS accordion opened')

    // Step 8: Select "Test Speaker 3"
    await speakerSelect.click()
    const option = page.getByRole('option', { name: 'Test Speaker 3' })
    await expect(option).toBeVisible({ timeout: 2000 })
    await option.click()
    console.log('[Text-Upload] Selected Test Speaker 3')

    // Step 9: Click Submit
    await page.getByTestId('text-upload-submit-button').click()
    console.log('[Text-Upload] Clicked Submit')

    // Step 10: Wait for dialog to close and segments to be created
    await expect(page.getByTestId('text-upload-dialog')).not.toBeVisible({ timeout: 30000 })
    console.log('[Text-Upload] Dialog closed')

    // Step 11: Verify segments were created (via API) - poll until segments appear
    const projectsResponse = await page.request.get(`${BACKEND_URL}/api/projects`)
    const projects = await projectsResponse.json()
    const testprojekt = projects.find((p: any) => p.title === 'Testprojekt')
    const kapitel2Info = testprojekt?.chapters.find((c: any) => c.title === 'Kapitel 2')

    expect(kapitel2Info).toBeTruthy()

    // Poll for segments to appear
    await expect(async () => {
      const chapterResponse = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel2Info.id}`)
      const chapter = await chapterResponse.json()
      expect(chapter.segments?.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10000 })

    // Get chapter with segments for final verification
    const chapterResponse = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel2Info.id}`)
    const chapter = await chapterResponse.json()

    console.log(`[Text-Upload] Created ${chapter.segments.length} segments in Kapitel 2 via file upload ✓`)

    // Verify speaker is set to Test Speaker 3
    const firstSegment = chapter.segments[0]
    expect(firstSegment.ttsSpeakerName).toBe('Test Speaker 3')
    console.log('[Text-Upload] Speaker verified: Test Speaker 3 ✓')
  })

  test('CHECKPOINT: Both chapters have segments', async ({ page }) => {
    await checkpoint(page, 'Both chapters have segments', async () => {
      const response = await page.request.get(`${BACKEND_URL}/api/projects`)
      const projects = await response.json()

      const testprojekt = projects.find((p: any) => p.title === 'Testprojekt')
      if (!testprojekt) return false

      const kapitel1Info = testprojekt.chapters.find((c: any) => c.title === 'Kapitel 1')
      const kapitel2Info = testprojekt.chapters.find((c: any) => c.title === 'Kapitel 2')

      if (!kapitel1Info || !kapitel2Info) return false

      // Get chapters with segments
      const chapter1Response = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel1Info.id}`)
      const chapter1 = await chapter1Response.json()

      const chapter2Response = await page.request.get(`${BACKEND_URL}/api/chapters/${kapitel2Info.id}`)
      const chapter2 = await chapter2Response.json()

      return chapter1.segments?.length > 0 && chapter2.segments?.length > 0
    })
  })

  test('should verify Kapitel 1 first segment has Test Speaker 2 via Settings Dialog', async ({ page }) => {
    // Step 1: Find and expand Testprojekt, select Kapitel 1
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

    // Step 2: Select Kapitel 1
    const chapter1Item = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 1' })
    await expect(chapter1Item).toBeVisible({ timeout: 3000 })
    await chapter1Item.click()
    // Wait for segments to load
    await expect(page.getByTestId('segment-menu-button').first()).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Selected Kapitel 1 for validation')

    // Step 3: Click the menu button on first segment
    const segmentMenuButton = page.getByTestId('segment-menu-button').first()
    await expect(segmentMenuButton).toBeVisible({ timeout: 3000 })
    await segmentMenuButton.click()
    console.log('[Text-Upload] Opened segment menu')

    // Step 4: Click "Settings" in segment menu
    await expect(page.getByTestId('segment-menu-settings')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('segment-menu-settings').click()
    console.log('[Text-Upload] Clicked Settings')

    // Step 5: Wait for EditSegmentSettingsDialog
    await expect(page.getByTestId('segment-settings-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Settings dialog opened')

    // Step 6: Verify speaker is "Test Speaker 2"
    const speakerSelect = page.getByTestId('segment-settings-speaker-select')
    await expect(speakerSelect).toBeVisible({ timeout: 3000 })

    // Get the selected value from MUI Select
    const selectedValue = await speakerSelect.textContent()
    expect(selectedValue).toContain('Test Speaker 2')
    console.log('[Text-Upload] Speaker verified: Test Speaker 2 ✓')

    // Close dialog
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('segment-settings-dialog')).not.toBeVisible({ timeout: 3000 })
  })

  test('should verify Kapitel 2 first segment has Test Speaker 3 via Settings Dialog', async ({ page }) => {
    // Step 1: Find and expand Testprojekt, select Kapitel 2
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

    // Step 2: Select Kapitel 2
    const chapter2Item = page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 2' })
    await expect(chapter2Item).toBeVisible({ timeout: 3000 })
    await chapter2Item.click()
    // Wait for segments to load
    await expect(page.getByTestId('segment-menu-button').first()).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Selected Kapitel 2 for validation')

    // Step 3: Click the menu button on first segment
    const segmentMenuButton = page.getByTestId('segment-menu-button').first()
    await segmentMenuButton.click()
    console.log('[Text-Upload] Opened segment menu')

    // Step 4: Click "Settings" in segment menu
    await expect(page.getByTestId('segment-menu-settings')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('segment-menu-settings').click()
    console.log('[Text-Upload] Clicked Settings')

    // Step 5: Wait for EditSegmentSettingsDialog
    await expect(page.getByTestId('segment-settings-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Text-Upload] Settings dialog opened')

    // Step 6: Verify speaker is "Test Speaker 3"
    const speakerSelect = page.getByTestId('segment-settings-speaker-select')
    await expect(speakerSelect).toBeVisible({ timeout: 3000 })

    // Get the selected value from MUI Select
    const selectedValue = await speakerSelect.textContent()
    expect(selectedValue).toContain('Test Speaker 3')
    console.log('[Text-Upload] Speaker verified: Test Speaker 3 ✓')

    // Close dialog
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('segment-settings-dialog')).not.toBeVisible({ timeout: 3000 })
  })
})
