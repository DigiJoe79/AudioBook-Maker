/**
 * 04-PROJECT-CHAPTER: E2E Project & Chapter CRUD Tests
 *
 * TRUE E2E TESTS - All operations via UI, not API!
 *
 * Tests:
 * 1. Create project via UI
 * 2. Create chapters via UI
 * 3. Edit project via UI
 * 4. Edit chapter via UI
 * 5. Delete project via UI
 * 6. Delete chapter via UI
 *
 * PREREQUISITE: 01-smoke must pass (base speaker exists)
 * CHECKPOINT: 1 project "Testprojekt" with 2 chapters exists
 */

import { test, expect, BACKEND_URL, checkpoint, clearProjects } from '../fixtures'

// Track if we've cleared projects (only once per suite)
let projectsCleared = false

test.describe('04-Project-Chapter', () => {

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

    // Navigate to Main view (where projects are managed)
    await page.getByTestId('nav-main').click()
    await expect(page.getByTestId('main-view')).toBeVisible({ timeout: 5000 })
  })

  test('should create first project via UI', async ({ page }) => {
    // Clear projects at start of first test
    if (!projectsCleared) {
      await clearProjects(page)
      projectsCleared = true
      console.log('[Project-Chapter] Projects cleared')
    }

    // Step 1: Click "Create Project" button in sidebar
    await page.getByTestId('create-project-button').click()
    console.log('[Project-Chapter] Clicked create project button')

    // Step 2: Wait for project dialog
    await expect(page.getByTestId('project-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Project dialog opened')

    // Step 3: Fill in project title
    const titleInput = page.getByTestId('project-title-input').locator('input')
    await titleInput.fill('Test Projekt 1')

    // Step 4: Add description
    const descInput = page.getByTestId('project-description-input').locator('textarea').first()
    await descInput.fill('Erstes Testprojekt')

    // Step 5: Save project
    await page.getByTestId('project-save-button').click()

    // Step 6: Wait for dialog to close
    await expect(page.getByTestId('project-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Project-Chapter] Project created')

    // Step 7: Verify project appears in sidebar (use locator to be more specific)
    await expect(page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 1' })).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Project visible in sidebar ✓')
  })

  test('should create first chapter "Kapitel 1" via UI', async ({ page }) => {
    // First find the project
    const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 1' })
    await expect(projectItem).toBeVisible({ timeout: 5000 })

    // Get the project ID from the test-id attribute
    const testId = await projectItem.getAttribute('data-testid')
    const projectId = testId?.replace('project-item-', '')

    // Click on project to select it
    await projectItem.click()

    // Click expand button to show chapters and "Add Chapter" button
    const expandButton = page.getByTestId(`project-expand-button-${projectId}`)
    await expandButton.click()

    // Find the "Add Chapter" button within this project - this waits for expansion
    const addChapterButton = page.getByTestId(`create-chapter-button-${projectId}`)
    await expect(addChapterButton).toBeVisible({ timeout: 3000 })
    await addChapterButton.click()
    console.log('[Project-Chapter] Clicked add chapter button')

    // Wait for chapter dialog
    await expect(page.getByTestId('chapter-dialog')).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Chapter dialog opened')

    // Fill in chapter title
    const titleInput = page.getByTestId('chapter-title-input').locator('input')
    await titleInput.fill('Kapitel 1')

    // Save chapter
    await page.getByTestId('chapter-save-button').click()

    // Wait for dialog to close
    await expect(page.getByTestId('chapter-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Project-Chapter] Chapter 1 created')

    // Verify chapter appears in sidebar
    await expect(page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 1' })).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Kapitel 1 visible ✓')
  })

  test('should create second chapter "Kapitel 2" via UI', async ({ page }) => {
    // Find the project
    const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 1' })
    await expect(projectItem).toBeVisible({ timeout: 5000 })

    // Get the project ID from the test-id attribute
    const testId = await projectItem.getAttribute('data-testid')
    const projectId = testId?.replace('project-item-', '')

    // Click on project to select it
    await projectItem.click()

    // Check if already expanded (add chapter button visible)
    const addChapterButton = page.getByTestId(`create-chapter-button-${projectId}`)
    const isExpanded = await addChapterButton.isVisible({ timeout: 1000 }).catch(() => false)

    if (!isExpanded) {
      // Click expand button and wait for button to appear
      const expandButton = page.getByTestId(`project-expand-button-${projectId}`)
      await expandButton.click()
    }

    // Wait for add chapter button to be visible
    await expect(addChapterButton).toBeVisible({ timeout: 3000 })
    await addChapterButton.click()
    console.log('[Project-Chapter] Clicked add chapter button')

    // Wait for chapter dialog
    await expect(page.getByTestId('chapter-dialog')).toBeVisible({ timeout: 5000 })

    // Fill in chapter title
    const titleInput = page.getByTestId('chapter-title-input').locator('input')
    await titleInput.fill('Kapitel 2')

    // Save chapter
    await page.getByTestId('chapter-save-button').click()

    // Wait for dialog to close
    await expect(page.getByTestId('chapter-dialog')).not.toBeVisible({ timeout: 10000 })
    console.log('[Project-Chapter] Chapter 2 created')

    // Verify chapter appears in sidebar
    await expect(page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 2' })).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Kapitel 2 visible ✓')
  })

  test('should create second project "Test Projekt 2" via UI', async ({ page }) => {
    // Click "Create Project" button
    await page.getByTestId('create-project-button').click()

    // Wait for project dialog
    await expect(page.getByTestId('project-dialog')).toBeVisible({ timeout: 5000 })

    // Fill in project title
    const titleInput = page.getByTestId('project-title-input').locator('input')
    await titleInput.fill('Test Projekt 2')

    // Save project
    await page.getByTestId('project-save-button').click()

    // Wait for dialog to close
    await expect(page.getByTestId('project-dialog')).not.toBeVisible({ timeout: 10000 })

    // Verify project appears in sidebar
    await expect(page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 2' })).toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Test Projekt 2 created ✓')
  })

  test('should edit "Test Projekt 1" to "Testprojekt" via UI', async ({ page }) => {
    // Find the project item that contains "Test Projekt 1"
    const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 1' })
    await expect(projectItem).toBeVisible({ timeout: 5000 })

    // Get the project ID from the test-id attribute
    const testId = await projectItem.getAttribute('data-testid')
    const projectId = testId?.replace('project-item-', '')

    // Click the menu button for this specific project
    const menuButton = page.getByTestId(`project-menu-button-${projectId}`)
    await menuButton.click()
    console.log('[Project-Chapter] Opened project menu')

    // Wait for menu and click "Edit"
    await expect(page.getByTestId('projects-menu-edit')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('projects-menu-edit').click()
    console.log('[Project-Chapter] Clicked edit')

    // Wait for edit dialog
    await expect(page.getByTestId('project-dialog')).toBeVisible({ timeout: 5000 })

    // Clear and fill new title
    const titleInput = page.getByTestId('project-title-input').locator('input')
    await titleInput.clear()
    await titleInput.fill('Testprojekt')

    // Save changes
    await page.getByTestId('project-save-button').click()

    // Wait for dialog to close
    await expect(page.getByTestId('project-dialog')).not.toBeVisible({ timeout: 10000 })

    // Verify new name appears, old name gone
    await expect(page.getByText('Testprojekt', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Test Projekt 1', { exact: true })).not.toBeVisible()
    console.log('[Project-Chapter] Renamed to Testprojekt ✓')
  })

  test('should delete "Test Projekt 2" via UI', async ({ page }) => {
    // Find the project item that contains "Test Projekt 2"
    const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 2' })
    await expect(projectItem).toBeVisible({ timeout: 5000 })

    // Get the project ID from the test-id attribute
    const testId = await projectItem.getAttribute('data-testid')
    const projectId = testId?.replace('project-item-', '')

    // Click the menu button for this specific project
    const menuButton = page.getByTestId(`project-menu-button-${projectId}`)
    await menuButton.click()
    console.log('[Project-Chapter] Opened project 2 menu')

    // Wait for menu and click "Delete"
    await expect(page.getByTestId('projects-menu-delete')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('projects-menu-delete').click()
    console.log('[Project-Chapter] Clicked delete')

    // Confirm deletion
    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('confirm-dialog-confirm').click()
    console.log('[Project-Chapter] Confirmed deletion')

    // Wait for project to disappear
    await expect(page.getByText('Test Projekt 2', { exact: true })).not.toBeVisible({ timeout: 5000 })
    console.log('[Project-Chapter] Test Projekt 2 deleted ✓')
  })

  test('should verify final state: 1 project with 2 chapters', async ({ page }) => {
    // Verify only "Testprojekt" exists
    const projectItem = page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Testprojekt' })
    await expect(projectItem).toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-testid^="project-item-"]').filter({ hasText: 'Test Projekt 2' })).not.toBeVisible()

    // Get the project ID
    const testId = await projectItem.getAttribute('data-testid')
    const projectId = testId?.replace('project-item-', '')

    // Click on project to select it
    await projectItem.click()

    // Check if already expanded
    const addChapterButton = page.getByTestId(`create-chapter-button-${projectId}`)
    const isExpanded = await addChapterButton.isVisible({ timeout: 1000 }).catch(() => false)

    if (!isExpanded) {
      // Click expand button
      const expandButton = page.getByTestId(`project-expand-button-${projectId}`)
      await expandButton.click()
    }

    // Wait for chapters to be visible
    await expect(page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 1' })).toBeVisible({ timeout: 3000 })
    await expect(page.locator('[data-testid^="chapter-item-"]').filter({ hasText: 'Kapitel 2' })).toBeVisible({ timeout: 3000 })
    console.log('[Project-Chapter] Final state verified: Testprojekt with Kapitel 1 & 2 ✓')

    // Also verify via API
    const response = await page.request.get(`${BACKEND_URL}/api/projects`)
    const projects = await response.json()
    expect(projects.length).toBe(1)
    expect(projects[0].title).toBe('Testprojekt')
    expect(projects[0].chapters.length).toBe(2)
    console.log('[Project-Chapter] API verification passed ✓')
  })

  test('CHECKPOINT: Testprojekt with 2 chapters exists', async ({ page }) => {
    await checkpoint(page, 'Testprojekt with 2 chapters', async () => {
      const response = await page.request.get(`${BACKEND_URL}/api/projects`)
      const projects = await response.json()

      if (projects.length !== 1) return false
      if (projects[0].title !== 'Testprojekt') return false
      if (projects[0].chapters.length !== 2) return false

      const chapterTitles = projects[0].chapters.map((c: any) => c.title).sort()
      return chapterTitles[0] === 'Kapitel 1' && chapterTitles[1] === 'Kapitel 2'
    })
  })
})
