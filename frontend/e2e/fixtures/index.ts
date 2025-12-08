/**
 * Playwright Test Fixtures for Tauri CDP
 *
 * Architecture:
 * - WORKER-SCOPE: CDP connection, base speaker (once per test run)
 * - SUITE-SCOPE: clearProjects() in beforeAll (once per describe)
 * - TEST-SCOPE: Tests build on each other within a suite
 */

import { test as base, chromium, Browser, Page, BrowserContext } from '@playwright/test'
import { resetBackend, clearAllProjects } from './testHelpers'
import { NavigationPage } from '../pages/NavigationPage'
import { MainViewPage } from '../pages/MainViewPage'
import { ProjectSidebarPage } from '../pages/ProjectSidebarPage'
import { SegmentListPage } from '../pages/SegmentListPage'

// Configuration
export const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:8765'
export const CDP_URL = process.env.E2E_CDP_URL || 'http://localhost:9222'

// Global state for test run
let checkpointFailed = false
let checkpointError = ''
let setupComplete = false
let baseSpeakerData: { id: string; name: string } | null = null

// Test fixtures
type Fixtures = {
  cdpBrowser: Browser
  cdpContext: BrowserContext
  page: Page
  baseSpeaker: { id: string; name: string }
  navigationPage: NavigationPage
  mainViewPage: MainViewPage
  projectSidebarPage: ProjectSidebarPage
  segmentListPage: SegmentListPage
}

export const test = base.extend<Fixtures>({
  // CDP Browser connection (WORKER-SCOPE: once per test run)
  cdpBrowser: [async ({}, use) => {
    console.log(`[CDP] Connecting to ${CDP_URL}...`)
    const browser = await chromium.connectOverCDP(CDP_URL)
    console.log('[CDP] Connected!')
    await use(browser)
    // Don't disconnect - the Tauri app keeps running
  }, { scope: 'worker' }],

  // Get the existing browser context
  cdpContext: async ({ cdpBrowser }, use) => {
    const contexts = cdpBrowser.contexts()
    if (contexts.length === 0) {
      throw new Error('No browser context found. Is the Tauri app running?')
    }
    await use(contexts[0])
  },

  // Get the existing page (Tauri app)
  page: async ({ cdpContext }, use) => {
    // Fail-fast if checkpoint failed
    if (checkpointFailed) {
      throw new Error(`[CHECKPOINT FAILED] ${checkpointError}\nSkipping remaining tests.`)
    }

    const pages = cdpContext.pages()
    const appPage = pages.find(p => !p.url().includes('devtools://'))
    if (!appPage) {
      throw new Error('No app page found. Is the Tauri app running?')
    }
    console.log(`[CDP] Using page: ${appPage.url()}`)
    await use(appPage)
  },

  // Base Speaker (lazy init - uses existing or creates new)
  baseSpeaker: async ({ page }, use) => {
    if (!setupComplete) {
      // Check if speaker already exists (created by 01-smoke via UI)
      const response = await page.request.get(`${BACKEND_URL}/api/speakers/default/get`)
      if (response.ok()) {
        const speaker = await response.json()
        if (speaker && speaker.id) {
          baseSpeakerData = { id: speaker.id, name: speaker.name }
          setupComplete = true
          console.log(`[Setup] Using existing speaker: ${baseSpeakerData.name} (${baseSpeakerData.id})`)
        }
      }

      // Fallback: create speaker if none exists
      if (!setupComplete) {
        console.log('[Setup] No speaker found - creating via resetBackend...')
        baseSpeakerData = await resetBackend(page, BACKEND_URL)
        setupComplete = true
        console.log(`[Setup] Base speaker ready: ${baseSpeakerData.name} (${baseSpeakerData.id})`)
      }
    } else {
      console.log(`[Setup] Reusing existing speaker: ${baseSpeakerData?.name}`)
    }
    await use(baseSpeakerData!)
  },

  // Navigation page fixture
  navigationPage: async ({ page }, use) => {
    await use(new NavigationPage(page))
  },

  // Main view page fixture
  mainViewPage: async ({ page }, use) => {
    await use(new MainViewPage(page))
  },

  // Project sidebar page fixture
  projectSidebarPage: async ({ page }, use) => {
    await use(new ProjectSidebarPage(page))
  },

  // Segment list page fixture
  segmentListPage: async ({ page }, use) => {
    await use(new SegmentListPage(page))
  },
})

export { expect } from '@playwright/test'

// =============================================================================
// SUITE HELPERS (call in beforeAll)
// =============================================================================

/**
 * Clear only projects (keep speakers) - for suite-level setup
 */
export async function clearProjects(page: Page): Promise<void> {
  await clearAllProjects(page, BACKEND_URL)
}

/**
 * Verify a checkpoint passes - if not, mark fail-fast
 * Call at the end of critical test suites
 */
export async function checkpoint(
  page: Page,
  name: string,
  check: () => Promise<boolean>
): Promise<void> {
  console.log(`[Checkpoint] Verifying: ${name}...`)
  try {
    const passed = await check()
    if (!passed) {
      checkpointFailed = true
      checkpointError = `Checkpoint "${name}" failed`
      throw new Error(checkpointError)
    }
    console.log(`[Checkpoint] ✓ ${name}`)
  } catch (error) {
    checkpointFailed = true
    checkpointError = `Checkpoint "${name}" error: ${error}`
    throw error
  }
}

/**
 * Reset checkpoint state (call at start of test run if needed)
 */
export function resetCheckpoints(): void {
  checkpointFailed = false
  checkpointError = ''
}

// =============================================================================
// COMMON CHECKS for checkpoints
// =============================================================================

export const checks = {
  /** Verify at least one speaker exists and is set as default */
  defaultSpeakerExists: async (page: Page): Promise<boolean> => {
    const response = await page.request.get(`${BACKEND_URL}/api/speakers/default/get`)
    if (!response.ok()) return false
    const speaker = await response.json()
    return speaker !== null && speaker.id !== undefined
  },

  /** Verify speaker appears in segment settings dropdown */
  speakerInSegmentSettings: async (page: Page, speakerName: string): Promise<boolean> => {
    // Navigate to a segment and check speaker dropdown
    // This is a placeholder - implement based on actual UI
    const response = await page.request.get(`${BACKEND_URL}/api/speakers`)
    const speakers = await response.json()
    return speakers.some((s: any) => s.name === speakerName)
  },

  /** Verify no projects exist (clean state) */
  noProjectsExist: async (page: Page): Promise<boolean> => {
    const response = await page.request.get(`${BACKEND_URL}/api/projects`)
    const projects = await response.json()
    return projects.length === 0
  },
}
