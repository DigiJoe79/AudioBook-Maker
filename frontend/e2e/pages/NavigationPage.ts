/**
 * Navigation Page Object Model
 *
 * Handles interactions with the navigation sidebar:
 * - View switching (6 views)
 * - Keyboard shortcuts
 * - Badge indicators
 */

import { Page, Locator } from '@playwright/test'

export class NavigationPage {
  readonly page: Page

  // Navigation buttons
  readonly activityButton: Locator
  readonly mainButton: Locator
  readonly pronunciationButton: Locator
  readonly speakersButton: Locator
  readonly jobsButton: Locator
  readonly settingsButton: Locator

  // Badges
  readonly activityBadge: Locator
  readonly jobsBadge: Locator

  constructor(page: Page) {
    this.page = page

    // Navigation buttons (by data-testid)
    this.activityButton = page.getByTestId('nav-activity')
    this.mainButton = page.getByTestId('nav-main')
    this.pronunciationButton = page.getByTestId('nav-pronunciation')
    this.speakersButton = page.getByTestId('nav-speakers')
    this.jobsButton = page.getByTestId('nav-jobs')
    this.settingsButton = page.getByTestId('nav-settings')

    // Badges
    this.activityBadge = page.getByTestId('activity-badge')
    this.jobsBadge = page.getByTestId('jobs-badge')
  }

  // Navigate to views
  async navigateToActivity(): Promise<void> {
    await this.activityButton.click()
  }

  async navigateToMain(): Promise<void> {
    await this.mainButton.click()
  }

  async navigateToPronunciation(): Promise<void> {
    await this.pronunciationButton.click()
  }

  async navigateToSpeakers(): Promise<void> {
    await this.speakersButton.click()
  }

  async navigateToJobs(): Promise<void> {
    await this.jobsButton.click()
  }

  async navigateToSettings(): Promise<void> {
    await this.settingsButton.click()
  }

  // Keyboard shortcuts
  async pressCtrl1(): Promise<void> {
    await this.page.keyboard.press('Control+1')
  }

  async pressCtrl2(): Promise<void> {
    await this.page.keyboard.press('Control+2')
  }

  async pressCtrl3(): Promise<void> {
    await this.page.keyboard.press('Control+3')
  }

  async pressCtrl4(): Promise<void> {
    await this.page.keyboard.press('Control+4')
  }

  async pressCtrl5(): Promise<void> {
    await this.page.keyboard.press('Control+5')
  }

  async pressCtrl6(): Promise<void> {
    await this.page.keyboard.press('Control+6')
  }

  // Verify active view
  async isActivityViewActive(): Promise<boolean> {
    return await this.page.getByTestId('activity-view').isVisible()
  }

  async isMainViewActive(): Promise<boolean> {
    return await this.page.getByTestId('main-view').isVisible()
  }

  async isPronunciationViewActive(): Promise<boolean> {
    return await this.page.getByTestId('pronunciation-view').isVisible()
  }

  async isSpeakersViewActive(): Promise<boolean> {
    return await this.page.getByTestId('speakers-view').isVisible()
  }

  async isJobsViewActive(): Promise<boolean> {
    return await this.page.getByTestId('jobs-view').isVisible()
  }

  async isSettingsViewActive(): Promise<boolean> {
    return await this.page.getByTestId('settings-view').isVisible()
  }

  // Badge helpers
  async getActivityBadgeCount(): Promise<number> {
    const text = await this.activityBadge.textContent()
    return text ? parseInt(text, 10) : 0
  }

  async getJobsBadgeCount(): Promise<number> {
    const text = await this.jobsBadge.textContent()
    return text ? parseInt(text, 10) : 0
  }
}
