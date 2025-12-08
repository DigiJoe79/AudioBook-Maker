/**
 * Main View Page Object Model
 *
 * Handles interactions with the main audiobook editing view:
 * - Project sidebar toggling
 * - Chapter view
 * - AudioPlayer
 */

import { Page, Locator } from '@playwright/test'

export class MainViewPage {
  readonly page: Page

  // Main view elements
  readonly sidebarToggleButton: Locator
  readonly projectSidebar: Locator
  readonly chapterView: Locator
  readonly audioPlayer: Locator

  // No speakers overlay
  readonly noSpeakersOverlay: Locator
  readonly noSpeakersGoToSpeakersButton: Locator

  constructor(page: Page) {
    this.page = page

    // Main view elements
    this.sidebarToggleButton = page.getByTestId('sidebar-toggle')
    this.projectSidebar = page.getByTestId('project-sidebar')
    this.chapterView = page.getByTestId('chapter-view')
    this.audioPlayer = page.getByTestId('audio-player')

    // No speakers overlay
    this.noSpeakersOverlay = page.getByTestId('no-speakers-overlay')
    this.noSpeakersGoToSpeakersButton = page.getByRole('button', {
      name: /go to speakers/i,
    })
  }

  // Toggle project sidebar
  async toggleProjectSidebar(): Promise<void> {
    await this.sidebarToggleButton.click()
  }

  // Check if sidebar is collapsed
  async isProjectSidebarCollapsed(): Promise<boolean> {
    const width = await this.projectSidebar.evaluate((el) =>
      window.getComputedStyle(el).getPropertyValue('width')
    )
    return width === '0px'
  }

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  async pressCtrlB(): Promise<void> {
    await this.page.keyboard.press('Control+B')
  }

  // Check if no speakers overlay is visible
  async isNoSpeakersOverlayVisible(): Promise<boolean> {
    return await this.noSpeakersOverlay.isVisible()
  }

  // Click "Go to Speakers" button
  async clickGoToSpeakers(): Promise<void> {
    await this.noSpeakersGoToSpeakersButton.click()
  }

  // Wait for main view to be ready
  async waitForReady(): Promise<void> {
    await this.chapterView.waitFor({ state: 'visible' })
  }
}
