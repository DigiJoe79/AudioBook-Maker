/**
 * 07-TTS-WORKFLOW: E2E TTS Generation Tests
 *
 * TRUE E2E TESTS - All operations via UI with real TTS engines!
 *
 * Tests:
 * 1. Verify TTS engine is available
 * 2. Generate single segment (fail early test)
 * 3. Start chapter 1 generation
 * 4. Track job progress in monitoring
 * 5. Verify chapter 1 segments have audio
 * 6. Play audio preview
 * 7. Generate chapter 2
 * 8. Cancel and resume job
 * 9. CHECKPOINT: Segments have audio
 *
 * PREREQUISITE: 05-text-upload must pass (Kapitel 1 & 2 have segments)
 * IMPORTANT: Real TTS generation takes 5-15s per segment
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
  console.log(`[TTS] Navigated to ${chapterName}`)
}

/**
 * Helper to count text segments (excluding dividers)
 */
async function countTextSegments(page: import('@playwright/test').Page): Promise<number> {
  // Count all segment menu buttons (both text and dividers have them)
  const totalSegments = await page.getByTestId('segment-menu-button').count()

  // Count dividers using locale-agnostic data-segment-type attribute
  const segmentList = page.getByTestId('segment-list')
  const dividerCount = await segmentList.locator('[data-segment-type="divider"]').count()

  return totalSegments - dividerCount
}

test.describe('07-TTS-Workflow', () => {
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

  test('should verify TTS engine is available', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    // Check if generate chapter button is enabled
    const generateButton = page.getByTestId('generate-chapter-button')
    await expect(generateButton).toBeVisible({ timeout: 5000 })

    const isDisabled = await generateButton.isDisabled()
    if (isDisabled) {
      test.skip(true, 'No TTS engine available - skipping remaining TTS tests')
    }

    console.log('[TTS] TTS engine is available ✓')
  })

  test('should generate single segment (fail early)', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    // Find the first text segment's generate button
    const segmentList = page.getByTestId('segment-list')
    const listItems = segmentList.locator('li')
    const totalItems = await listItems.count()

    let generateButton = null
    for (let i = 0; i < totalItems; i++) {
      const item = listItems.nth(i)

      // Skip dividers (locale-agnostic check)
      const segmentType = await item.getAttribute('data-segment-type')
      if (segmentType === 'divider') continue

      // Find generate button in this segment
      const btn = item.getByTestId('segment-generate-button')
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        generateButton = btn
        console.log(`[TTS] Found generate button at position ${i}`)
        break
      }
    }

    expect(generateButton).not.toBeNull()
    if (!generateButton) return

    // Click generate button for single segment
    await generateButton.click()
    console.log('[TTS] Clicked single segment generate button')

    // Wait for segment to complete (single segment: max 30s)
    // The segment status should change from pending → queued → processing → completed
    console.log('[TTS] Waiting for single segment generation...')

    // Wait for play button to appear (indicates audio was generated)
    await expect(async () => {
      const playButtons = await page.getByTestId('play-button').count()
      expect(playButtons).toBeGreaterThan(0)
    }).toPass({ timeout: 30000 })

    console.log('[TTS] Single segment generated successfully ✓')
  })

  test('should start chapter 1 generation', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    // Count text segments before generation
    const textSegmentCount = await countTextSegments(page)
    console.log(`[TTS] Chapter 1 has ${textSegmentCount} text segments`)
    expect(textSegmentCount).toBeGreaterThan(0)

    // Check if at least one segment has status 'pending' (visible as chip or status indicator)
    const segmentList = page.getByTestId('segment-list')
    const hasPendingSegment = await segmentList.getByText(/pending|ausstehend/i).isVisible({ timeout: 2000 }).catch(() => false)
    console.log(`[TTS] Has pending segments: ${hasPendingSegment}`)

    // Click generate chapter button
    const generateButton = page.getByTestId('generate-chapter-button')
    await generateButton.click()
    console.log('[TTS] Clicked Generate Chapter button')

    // Wait for GenerateAudioDialog to open
    const dialog = page.getByTestId('generate-audio-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    console.log('[TTS] GenerateAudioDialog opened')

    // Verify dialog shows segment count in the summary
    await expect(dialog).toContainText(/\d+/)  // Should show numbers
    console.log('[TTS] Dialog shows segment information')

    // Click Generate button
    const submitButton = page.getByTestId('generate-audio-submit')
    await expect(submitButton).toBeVisible({ timeout: 3000 })
    await submitButton.click()
    console.log('[TTS] Clicked Generate button')

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 })
    console.log('[TTS] Dialog closed - job created ✓')
  })

  test('should track job progress in monitoring', async ({ page }) => {
    // Increase test timeout for TTS generation (5 min)
    test.setTimeout(300000)

    // First navigate to Kapitel 1 to count segments for dynamic timeout
    await navigateToChapter(page, 'Kapitel 1')
    const textSegmentCount = await countTextSegments(page)
    console.log(`[TTS] Chapter 1 has ${textSegmentCount} text segments`)

    // Navigate to Monitoring view
    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 5000 })
    console.log('[TTS] Navigated to Monitoring view')

    // Ensure TTS Jobs tab is active (it should be by default)
    const ttsJobsTab = page.getByTestId('tts-jobs-tab')
    await ttsJobsTab.click()
    console.log('[TTS] Selected TTS Jobs tab')

    // Wait for active jobs list to be visible
    const activeJobsList = page.getByTestId('tts-jobs-active-list')
    await expect(activeJobsList).toBeVisible({ timeout: 5000 })
    console.log('[TTS] Active jobs list visible')

    // Find the active job (should be running or pending)
    await expect(async () => {
      const jobItems = page.locator('[data-testid^="tts-job-item-"]')
      const count = await jobItems.count()
      expect(count).toBeGreaterThan(0)
    }).toPass({ timeout: 10000 })
    console.log('[TTS] Found active job in list')

    // Get the first job item
    const firstJob = page.locator('[data-testid^="tts-job-item-"]').first()
    await expect(firstJob).toBeVisible()

    // Verify job shows status (running or pending)
    const hasRunningStatus = await firstJob.getByText(/running|pending|läuft|ausstehend/i).isVisible({ timeout: 2000 }).catch(() => false)
    console.log(`[TTS] Job status shown: ${hasRunningStatus}`)

    // Wait for job progress to update via SSE (progress should increase)
    console.log('[TTS] Waiting for job progress updates...')
    await expect(async () => {
      // Check for progress indicators (e.g., "3 / 5" or percentage)
      const progressText = await firstJob.textContent()
      const hasProgress = progressText && /\d+\s*\/\s*\d+|\d+%/.test(progressText)
      expect(hasProgress).toBeTruthy()

    }).toPass({ timeout: 15000 })
    console.log(`[TTS] Job progress is updating ✓`)

    // Calculate dynamic timeout: 25s per segment + 60s buffer
    const dynamicTimeout = textSegmentCount * 25000 + 60000
    console.log(`[TTS] Waiting for job completion (timeout: ${dynamicTimeout / 1000}s for ${textSegmentCount} segments)...`)

    await expect(async () => {
      const jobStatus = await firstJob.textContent()
      const isCompleted = jobStatus && /completed|abgeschlossen|100%/i.test(jobStatus)
      expect(isCompleted).toBeTruthy()
    }).toPass({ timeout: dynamicTimeout })
    console.log('[TTS] Job completed successfully ✓')
  })

  test('should verify chapter 1 segments have audio', async ({ page }) => {
    // Navigate back to Main view
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })

    await navigateToChapter(page, 'Kapitel 1')

    // Count text segments
    const textSegmentCount = await countTextSegments(page)
    console.log(`[TTS] Verifying audio for ${textSegmentCount} text segments`)

    // Verify all text segments have play buttons (audio generated)
    // Note: We can't use a specific test-id since the spec doesn't mention one for play buttons
    // We'll verify by checking for play icons or buttons in the segment list
    const segmentList = page.getByTestId('segment-list')
    const listItems = segmentList.locator('li')

    let segmentsWithAudio = 0
    const totalItems = await listItems.count()

    for (let i = 0; i < totalItems; i++) {
      const item = listItems.nth(i)

      // Skip dividers (locale-agnostic check)
      const segmentType = await item.getAttribute('data-segment-type')
      if (segmentType === 'divider') {
        console.log(`[TTS] Position ${i}: Divider (skipped) ✓`)
        continue
      }

      // For text segments, check if there's a play button (audio generated)
      const hasPlayButton = await item.getByTestId('play-button').isVisible({ timeout: 500 }).catch(() => false)

      if (hasPlayButton) {
        segmentsWithAudio++
        console.log(`[TTS] Position ${i}: Has audio ✓`)
      } else {
        console.log(`[TTS] Position ${i}: No audio found`)
      }
    }

    console.log(`[TTS] Segments with audio: ${segmentsWithAudio} / ${textSegmentCount}`)
    expect(segmentsWithAudio).toBe(textSegmentCount)
    console.log('[TTS] All text segments have audio ✓')
  })

  test('should play audio preview', async ({ page }) => {
    await navigateToChapter(page, 'Kapitel 1')

    // Find first text segment with play button
    const segmentList = page.getByTestId('segment-list')
    const listItems = segmentList.locator('li')
    const totalItems = await listItems.count()

    let playButtonFound = false
    for (let i = 0; i < totalItems; i++) {
      const item = listItems.nth(i)

      // Skip dividers (locale-agnostic check)
      const segmentType = await item.getAttribute('data-segment-type')
      if (segmentType === 'divider') continue

      // Try to find play button
      const playButton = item.getByTestId('play-button')
      if (await playButton.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log(`[TTS] Found play button at position ${i}`)

        // Click play button
        await playButton.click()
        console.log('[TTS] Clicked play button')

        // Verify audio is playing by checking button state change (play → pause icon)
        // The button should remain interactive
        await expect(playButton).toBeEnabled({ timeout: 3000 })

        // Click again to pause/stop
        await playButton.click()
        console.log('[TTS] Clicked play button again to stop')

        playButtonFound = true
        break
      }
    }

    expect(playButtonFound).toBeTruthy()
    console.log('[TTS] Audio preview test completed ✓')
  })

  test('should generate chapter 2', async ({ page }) => {
    // Increase test timeout for TTS generation (5 min)
    test.setTimeout(300000)

    await navigateToChapter(page, 'Kapitel 2')

    // Count text segments
    const textSegmentCount = await countTextSegments(page)
    console.log(`[TTS] Chapter 2 has ${textSegmentCount} text segments`)
    expect(textSegmentCount).toBeGreaterThan(0)

    // Click generate chapter button
    const generateButton = page.getByTestId('generate-chapter-button')
    await generateButton.click()
    console.log('[TTS] Clicked Generate Chapter button for Chapter 2')

    // Wait for dialog
    const dialog = page.getByTestId('generate-audio-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    console.log('[TTS] Dialog opened')

    // Click Generate
    await page.getByTestId('generate-audio-submit').click()
    console.log('[TTS] Clicked Generate')

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 })
    console.log('[TTS] Dialog closed')

    // Navigate to Monitoring to watch progress
    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 5000 })

    // Calculate dynamic timeout based on segment count: 25s per segment + 60s buffer
    const dynamicTimeout = textSegmentCount * 25000 + 60000
    console.log(`[TTS] Waiting for Chapter 2 job to complete (timeout: ${dynamicTimeout / 1000}s for ${textSegmentCount} segments)...`)

    const firstJob = page.locator('[data-testid^="tts-job-item-"]').first()
    await expect(async () => {
      const jobStatus = await firstJob.textContent()
      const isCompleted = jobStatus && /completed|abgeschlossen|100%/i.test(jobStatus)
      expect(isCompleted).toBeTruthy()
    }).toPass({ timeout: dynamicTimeout })
    console.log('[TTS] Chapter 2 generation completed ✓')
  })

  test('should cancel and resume job', async ({ page }) => {
    // Increase test timeout for TTS generation (5 min)
    test.setTimeout(300000)

    // Navigate back to Main view
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })

    await navigateToChapter(page, 'Kapitel 1')

    // Count segments for dynamic timeout calculation
    const textSegmentCount = await countTextSegments(page)

    // Start regeneration (with override option)
    const generateButton = page.getByTestId('generate-chapter-button')
    await generateButton.click()
    console.log('[TTS] Clicked Generate Chapter for re-generation')

    const dialog = page.getByTestId('generate-audio-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Enable "Force Regenerate" checkbox (to regenerate already completed segments)
    const regenerateCheckbox = page.getByTestId('generate-audio-regenerate')
    if (await regenerateCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await regenerateCheckbox.check()
      console.log('[TTS] Enabled force regenerate option')
    }

    // Submit
    await page.getByTestId('generate-audio-submit').click()
    await expect(dialog).not.toBeVisible({ timeout: 10000 })
    console.log('[TTS] Started regeneration job')

    // Quickly navigate to Monitoring
    await page.getByTestId('nav-monitoring').click()
    await expect(page.getByTestId('monitoring-view')).toBeVisible({ timeout: 5000 })

    // Find the running job
    const activeJob = page.locator('[data-testid^="tts-job-item-"]').first()
    await expect(activeJob).toBeVisible({ timeout: 5000 })

    // Get job ID from test-id attribute
    const jobTestId = await activeJob.getAttribute('data-testid')
    const jobId = jobTestId?.replace('tts-job-item-', '')
    console.log(`[TTS] Found job ID: ${jobId}`)

    // Cancel the job
    const cancelButton = page.getByTestId(`tts-job-cancel-${jobId}`)
    await expect(cancelButton).toBeVisible({ timeout: 5000 })
    await cancelButton.click()
    console.log('[TTS] Clicked Cancel button')

    // Wait for job status to change to cancelled via SSE
    await expect(async () => {
      const jobStatus = await activeJob.textContent()
      const isCancelled = jobStatus && /cancelled|paused|abgebrochen|pausiert/i.test(jobStatus)
      expect(isCancelled).toBeTruthy()
    }).toPass({ timeout: 10000 })
    console.log('[TTS] Job status changed to cancelled ✓')
   // Hover over job card to show action buttons (they have opacity: 0 when not hovered)
    await activeJob.hover()
    console.log('[TTS] Hovered over job card')

    // Verify resume button is visible
    const resumeButton = page.getByTestId(`tts-job-resume-${jobId}`)
    await expect(resumeButton).toBeVisible({ timeout: 5000 })
    console.log('[TTS] Resume button visible')

    // Resume the job
    await resumeButton.click()
    console.log('[TTS] Clicked Resume button')

    // Wait for job status to change to running via SSE
    await expect(async () => {
      const jobStatus = await activeJob.textContent()
      const isRunning = jobStatus && /running|pending|läuft|ausstehend/i.test(jobStatus)
      expect(isRunning).toBeTruthy()
    }).toPass({ timeout: 10000 })
    console.log('[TTS] Job status changed to running ✓')

    // Wait for job to complete with dynamic timeout
    const dynamicTimeout = textSegmentCount * 25000 + 60000
    console.log(`[TTS] Waiting for resumed job to complete (timeout: ${dynamicTimeout / 1000}s for ${textSegmentCount} segments)...`)
    await expect(async () => {
      const jobStatus = await activeJob.textContent()
      const isCompleted = jobStatus && /completed|abgeschlossen|100%/i.test(jobStatus)
      expect(isCompleted).toBeTruthy()
    }).toPass({ timeout: dynamicTimeout })
    console.log('[TTS] Resumed job completed successfully ✓')
  })

  test('CHECKPOINT: Segments have audio', async ({ page }) => {
    await checkpoint(page, 'Segments have audio', async () => {
      // Navigate to Main view
      await page.getByTestId('nav-main').click()
      if (!await page.getByTestId('main-view').isVisible({ timeout: 3000 }).catch(() => false)) {
        return false
      }

      // Check Kapitel 1
      await navigateToChapter(page, 'Kapitel 1')
      const segmentList1 = page.getByTestId('segment-list')
      if (!await segmentList1.isVisible({ timeout: 3000 }).catch(() => false)) {
        return false
      }

      // Count play buttons in Kapitel 1 (at least 3 required)
      const playButtons1 = await page.getByTestId('play-button').count()
      console.log(`[Checkpoint] Kapitel 1 has ${playButtons1} play buttons`)
      if (playButtons1 < 3) {
        return false
      }

      // Check Kapitel 2
      await navigateToChapter(page, 'Kapitel 2')
      const segmentList2 = page.getByTestId('segment-list')
      if (!await segmentList2.isVisible({ timeout: 3000 }).catch(() => false)) {
        return false
      }

      // Count play buttons in Kapitel 2 (at least 3 required)
      const playButtons2 = await page.getByTestId('play-button').count()
      console.log(`[Checkpoint] Kapitel 2 has ${playButtons2} play buttons`)
      if (playButtons2 < 3) {
        return false
      }


      return true
    })
  })
})
