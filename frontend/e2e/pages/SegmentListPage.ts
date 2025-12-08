/**
 * Segment List Page Object Model
 *
 * Handles interactions with the segment list:
 * - Segment selection
 * - Segment creation
 * - Segment editing/deletion
 * - Drag & Drop reordering
 * - TTS generation
 */

import { Page, Locator } from '@playwright/test'

export class SegmentListPage {
  readonly page: Page

  // Command toolbar buttons
  readonly createSegmentButton: Locator
  readonly createDividerButton: Locator
  readonly generateChapterButton: Locator
  readonly analyzeChapterButton: Locator

  constructor(page: Page) {
    this.page = page

    // Command toolbar buttons
    this.createSegmentButton = page.getByTestId('create-segment-button')
    this.createDividerButton = page.getByTestId('create-divider-button')
    this.generateChapterButton = page.getByTestId('generate-chapter-button')
    this.analyzeChapterButton = page.getByTestId('analyze-chapter-button')
  }

  // Get segment by index
  getSegment(index: number): Locator {
    return this.page.getByTestId(`segment-item-${index}`)
  }

  // Get segment by ID
  getSegmentById(segmentId: string): Locator {
    return this.page.getByTestId(`segment-${segmentId}`)
  }

  // Get total segment count
  async getSegmentCount(): Promise<number> {
    return await this.page.locator('[data-testid^="segment-item-"]').count()
  }

  // Click segment
  async clickSegment(index: number): Promise<void> {
    await this.getSegment(index).click()
  }

  // Create new text segment
  async createTextSegment(text: string): Promise<void> {
    await this.createSegmentButton.click()

    // Fill quick create dialog
    const dialog = this.page.getByTestId('quick-create-segment-dialog')
    await dialog.getByLabel(/text/i).fill(text)
    await dialog.getByRole('button', { name: /create/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Create new divider segment
  async createDivider(pauseDuration: number = 1.0): Promise<void> {
    await this.createDividerButton.click()

    // Fill quick create divider dialog
    const dialog = this.page.getByTestId('quick-create-divider-dialog')
    const input = dialog.getByLabel(/pause duration/i)
    await input.clear()
    await input.fill(pauseDuration.toString())
    await dialog.getByRole('button', { name: /create/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Edit segment text
  async editSegmentText(index: number, newText: string): Promise<void> {
    // Open segment menu
    await this.getSegment(index).getByTestId('segment-menu-button').click()

    // Click edit
    await this.page.getByRole('menuitem', { name: /edit text/i }).click()

    // Fill edit dialog
    const dialog = this.page.getByTestId('edit-segment-dialog')
    const textInput = dialog.getByLabel(/text/i)
    await textInput.clear()
    await textInput.fill(newText)
    await dialog.getByRole('button', { name: /save/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Delete segment
  async deleteSegment(index: number): Promise<void> {
    // Open segment menu
    await this.getSegment(index).getByTestId('segment-menu-button').click()

    // Click delete
    await this.page.getByRole('menuitem', { name: /delete/i }).click()

    // Confirm deletion
    const confirmDialog = this.page.getByTestId('confirm-delete-dialog')
    await confirmDialog.getByRole('button', { name: /delete/i }).click()

    // Wait for dialog to close
    await confirmDialog.waitFor({ state: 'hidden' })
  }

  // Regenerate segment audio
  async regenerateSegment(index: number): Promise<void> {
    // Open segment menu
    await this.getSegment(index).getByTestId('segment-menu-button').click()

    // Click regenerate
    await this.page.getByRole('menuitem', { name: /regenerate/i }).click()
  }

  // Generate entire chapter
  async generateChapter(): Promise<void> {
    await this.generateChapterButton.click()

    // Wait for confirmation (if any)
    // For now, assume immediate start
  }

  // Analyze chapter with STT
  async analyzeChapter(): Promise<void> {
    await this.analyzeChapterButton.click()
  }

  // Drag segment from index A to index B
  async dragSegment(fromIndex: number, toIndex: number): Promise<void> {
    const fromSegment = this.getSegment(fromIndex)
    const toSegment = this.getSegment(toIndex)

    // Get bounding boxes
    const fromBox = await fromSegment.boundingBox()
    const toBox = await toSegment.boundingBox()

    if (!fromBox || !toBox) {
      throw new Error('Cannot drag: segment not visible')
    }

    // Perform drag
    await this.page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
    await this.page.mouse.down()
    await this.page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, {
      steps: 10,
    })
    await this.page.mouse.up()
  }

  // Get segment text
  async getSegmentText(index: number): Promise<string> {
    const segment = this.getSegment(index)
    const textElement = segment.getByTestId('segment-text')
    return (await textElement.textContent()) || ''
  }

  // Get segment status
  async getSegmentStatus(index: number): Promise<string> {
    const segment = this.getSegment(index)
    const statusChip = segment.getByTestId('segment-status')
    return (await statusChip.textContent()) || ''
  }

  // Check if segment is playing
  async isSegmentPlaying(index: number): Promise<boolean> {
    const segment = this.getSegment(index)
    const playButton = segment.getByTestId('play-button')
    const icon = await playButton.getAttribute('aria-label')
    return icon === 'Pause'
  }

  // Play segment
  async playSegment(index: number): Promise<void> {
    const segment = this.getSegment(index)
    await segment.getByTestId('play-button').click()
  }

  // Check if segment has quality indicator
  async hasQualityIndicator(index: number): Promise<boolean> {
    const segment = this.getSegment(index)
    return await segment.getByTestId('quality-indicator').isVisible()
  }

  // Get segment quality status
  async getSegmentQualityStatus(index: number): Promise<string | null> {
    const segment = this.getSegment(index)
    const indicator = segment.getByTestId('quality-indicator')
    if (await indicator.isVisible()) {
      return await indicator.getAttribute('data-quality-status')
    }
    return null
  }

  // Wait for segment status change
  async waitForSegmentStatus(index: number, status: string, timeout = 10000): Promise<void> {
    const segment = this.getSegment(index)
    const statusChip = segment.getByTestId('segment-status')
    await statusChip.waitFor({ state: 'visible', timeout })

    // Poll for status
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const currentStatus = await statusChip.textContent()
      if (currentStatus === status) {
        return
      }
      await this.page.waitForTimeout(100)
    }

    throw new Error(`Segment status did not change to "${status}" within ${timeout}ms`)
  }
}
