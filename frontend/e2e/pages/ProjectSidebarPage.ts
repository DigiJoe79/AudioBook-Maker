/**
 * Project Sidebar Page Object Model
 *
 * Handles interactions with the project sidebar:
 * - Project/Chapter selection
 * - Project/Chapter creation
 * - Project/Chapter editing/deletion
 */

import { Page, Locator } from '@playwright/test'

export class ProjectSidebarPage {
  readonly page: Page

  // Toolbar buttons
  readonly createProjectButton: Locator
  readonly createChapterButton: Locator

  constructor(page: Page) {
    this.page = page

    // Toolbar buttons
    this.createProjectButton = page.getByTestId('create-project-button')
    this.createChapterButton = page.getByTestId('create-chapter-button')
  }

  // Select project by title
  async selectProject(projectTitle: string): Promise<void> {
    await this.page.getByTestId(`project-${projectTitle}`).click()
  }

  // Select chapter by title
  async selectChapter(chapterTitle: string): Promise<void> {
    await this.page.getByTestId(`chapter-${chapterTitle}`).click()
  }

  // Expand/collapse project
  async toggleProject(projectTitle: string): Promise<void> {
    await this.page.getByTestId(`project-toggle-${projectTitle}`).click()
  }

  // Create new project
  async createProject(title: string): Promise<void> {
    await this.createProjectButton.click()

    // Fill create project dialog
    const dialog = this.page.getByTestId('create-project-dialog')
    await dialog.getByLabel(/project title/i).fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Create new chapter
  async createChapter(title: string): Promise<void> {
    await this.createChapterButton.click()

    // Fill create chapter dialog
    const dialog = this.page.getByTestId('create-chapter-dialog')
    await dialog.getByLabel(/chapter title/i).fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Edit project
  async editProject(projectTitle: string, newTitle: string): Promise<void> {
    // Open project menu
    await this.page.getByTestId(`project-menu-${projectTitle}`).click()

    // Click edit
    await this.page.getByRole('menuitem', { name: /edit/i }).click()

    // Fill edit dialog
    const dialog = this.page.getByTestId('edit-project-dialog')
    const titleInput = dialog.getByLabel(/project title/i)
    await titleInput.clear()
    await titleInput.fill(newTitle)
    await dialog.getByRole('button', { name: /save/i }).click()

    // Wait for dialog to close
    await dialog.waitFor({ state: 'hidden' })
  }

  // Delete project
  async deleteProject(projectTitle: string): Promise<void> {
    // Open project menu
    await this.page.getByTestId(`project-menu-${projectTitle}`).click()

    // Click delete
    await this.page.getByRole('menuitem', { name: /delete/i }).click()

    // Confirm deletion
    const confirmDialog = this.page.getByTestId('confirm-delete-dialog')
    await confirmDialog.getByRole('button', { name: /delete/i }).click()

    // Wait for dialog to close
    await confirmDialog.waitFor({ state: 'hidden' })
  }

  // Check if project exists
  async projectExists(projectTitle: string): Promise<boolean> {
    return await this.page.getByTestId(`project-${projectTitle}`).isVisible()
  }

  // Check if chapter exists
  async chapterExists(chapterTitle: string): Promise<boolean> {
    return await this.page.getByTestId(`chapter-${chapterTitle}`).isVisible()
  }

  // Get selected project title
  async getSelectedProject(): Promise<string | null> {
    const selected = this.page.locator('[data-testid^="project-"][aria-selected="true"]')
    if (await selected.count() > 0) {
      return await selected.textContent()
    }
    return null
  }

  // Get selected chapter title
  async getSelectedChapter(): Promise<string | null> {
    const selected = this.page.locator('[data-testid^="chapter-"][aria-selected="true"]')
    if (await selected.count() > 0) {
      return await selected.textContent()
    }
    return null
  }
}
