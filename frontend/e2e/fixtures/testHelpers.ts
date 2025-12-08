/**
 * Test Helper Functions
 */

import type { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Create a minimal valid WAV file for testing
 * @param filename - Name of the WAV file (will be created in e2e/ directory)
 * @param durationSeconds - Duration in seconds (default: 1)
 * @returns Absolute path to the created file
 */
export function createTestWavFile(filename: string, durationSeconds: number = 1): string {
  const sampleRate = 22050
  const numSamples = Math.floor(sampleRate * durationSeconds)

  // WAV header (44 bytes)
  const wavHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x00, 0x00, 0x00, 0x00, // File size (will update)
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6d, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 = PCM)
    0x01, 0x00,             // NumChannels (1 = mono)
    0x22, 0x56, 0x00, 0x00, // SampleRate (22050)
    0x44, 0xac, 0x00, 0x00, // ByteRate (22050 * 1 * 2)
    0x02, 0x00,             // BlockAlign (1 * 2)
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00, // Subchunk2Size (will update)
  ])

  const silenceData = Buffer.alloc(numSamples * 2) // 16-bit samples = 2 bytes each
  const wavFile = Buffer.concat([wavHeader, silenceData])

  // Update file size in header (file size - 8)
  const fileSize = wavFile.length - 8
  wavFile.writeUInt32LE(fileSize, 4)

  // Update data chunk size
  const dataSize = silenceData.length
  wavFile.writeUInt32LE(dataSize, 40)

  // Write to e2e/ directory
  const tempPath = path.join(process.cwd(), 'e2e', filename)
  fs.writeFileSync(tempPath, wavFile)

  return tempPath
}

/**
 * Delete test WAV files (cleanup helper)
 */
export function cleanupTestWavFiles(...filePaths: string[]): void {
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

/**
 * Clear all projects from backend database
 * WARNING: Deletes ALL data in the backend!
 */
export async function clearAllProjects(page: Page, backendUrl: string = 'http://localhost:8765') {
  // Get all projects
  const response = await page.request.get(`${backendUrl}/api/projects`)
  const projects = await response.json()

  // Delete each project
  for (const project of projects) {
    await page.request.delete(`${backendUrl}/api/projects/${project.id}`)
  }

  console.log(`[Test Helper] Cleared ${projects.length} projects`)
}

/**
 * Clear all speakers from backend
 */
export async function clearAllSpeakers(page: Page, backendUrl: string = 'http://localhost:8765') {
  const response = await page.request.get(`${backendUrl}/api/speakers`)
  const speakers = await response.json()

  for (const speaker of speakers) {
    await page.request.delete(`${backendUrl}/api/speakers/${speaker.id}`)
  }

  console.log(`[Test Helper] Cleared ${speakers.length} speakers`)
}

/**
 * Clear all pronunciation rules from backend
 */
export async function clearAllPronunciationRules(page: Page, backendUrl: string = 'http://localhost:8765') {
  const response = await page.request.get(`${backendUrl}/api/pronunciation/rules`)
  if (!response.ok()) {
    console.log('[Test Helper] No pronunciation rules to clear')
    return
  }

  const data = await response.json()
  const rules = data.rules || []

  for (const rule of rules) {
    await page.request.delete(`${backendUrl}/api/pronunciation/rules/${rule.id}`)
  }

  console.log(`[Test Helper] Cleared ${rules.length} pronunciation rules`)
}

/**
 * Create a default test speaker with sample
 * Required for tests to work (app shows overlay if no speakers exist)
 *
 * Two-step process:
 * 1. Create speaker (JSON)
 * 2. Upload sample (multipart/form-data)
 */
export async function createDefaultSpeaker(page: Page, backendUrl: string = 'http://localhost:8765') {
  // Step 1: Create speaker (JSON)
  const createResponse = await page.request.post(`${backendUrl}/api/speakers`, {
    data: {
      name: 'Test Speaker',
      description: 'Default test speaker for E2E tests',
      gender: 'neutral',
      languages: ['en'],
      tags: ['test']
    }
  })

  if (!createResponse.ok()) {
    throw new Error(`Failed to create speaker: ${createResponse.status()} ${await createResponse.text()}`)
  }

  const speaker = await createResponse.json()
  console.log(`[Test Helper] Created speaker: ${speaker.name} (${speaker.id})`)

  // Step 2: Upload sample (multipart/form-data)
  // Create a minimal WAV file (1 second silence)
  const wavFile = createWavBuffer(1) // 1 second

  const sampleResponse = await page.request.post(`${backendUrl}/api/speakers/${speaker.id}/samples`, {
    multipart: {
      file: {
        name: 'test-sample.wav',
        mimeType: 'audio/wav',
        buffer: wavFile
      }
    }
  })

  if (!sampleResponse.ok()) {
    console.warn(`[Test Helper] Warning: Failed to upload sample: ${sampleResponse.status()}`)
    // Don't fail - speaker without sample is still valid for basic tests
  } else {
    console.log(`[Test Helper] Uploaded sample for speaker ${speaker.id}`)
  }

  // Step 3: Set as default speaker (required for app to not show gate)
  const defaultResponse = await page.request.post(`${backendUrl}/api/speakers/${speaker.id}/set-default`)
  if (!defaultResponse.ok()) {
    console.warn(`[Test Helper] Warning: Failed to set default speaker: ${defaultResponse.status()}`)
  } else {
    console.log(`[Test Helper] Set ${speaker.name} as default speaker`)
  }

  return speaker
}

/**
 * Create a minimal valid WAV buffer (in-memory, no file I/O)
 */
function createWavBuffer(durationSeconds: number): Buffer {
  const sampleRate = 22050
  const numSamples = Math.floor(sampleRate * durationSeconds)

  // WAV header (44 bytes)
  const header = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x00, 0x00, 0x00, 0x00, // File size (will update)
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6d, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 = PCM)
    0x01, 0x00,             // NumChannels (1 = mono)
    0x22, 0x56, 0x00, 0x00, // SampleRate (22050)
    0x44, 0xac, 0x00, 0x00, // ByteRate
    0x02, 0x00,             // BlockAlign
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00, // Subchunk2Size (will update)
  ])

  const silenceData = Buffer.alloc(numSamples * 2) // 16-bit samples
  const wavFile = Buffer.concat([header, silenceData])

  // Update file size (file size - 8)
  wavFile.writeUInt32LE(wavFile.length - 8, 4)
  // Update data chunk size
  wavFile.writeUInt32LE(silenceData.length, 40)

  return wavFile
}

/**
 * Clear backend to empty state (no speakers!)
 * Used for testing the EmptySpeakersState gate
 */
export async function clearBackend(page: Page, backendUrl: string = 'http://localhost:8765'): Promise<void> {
  await clearAllProjects(page, backendUrl)
  await clearAllSpeakers(page, backendUrl)
  await clearAllPronunciationRules(page, backendUrl)
  console.log('[Test Helper] Backend cleared (no speakers)')
}

/**
 * Reset backend to clean state and create default speaker
 * Deletes all projects, chapters, segments, speakers, then creates a test speaker
 * Returns the created speaker for use in fixtures
 *
 * Note: After clearing all speakers, the app will show the EmptySpeakersState gate.
 * This is expected behavior. The new speaker is created immediately after.
 */
export async function resetBackend(page: Page, backendUrl: string = 'http://localhost:8765'): Promise<{ id: string; name: string }> {
  await clearAllProjects(page, backendUrl)
  await clearAllSpeakers(page, backendUrl)
  await clearAllPronunciationRules(page, backendUrl)

  // Create default speaker immediately - app may briefly show gate
  const speaker = await createDefaultSpeaker(page, backendUrl)

  // Give app time to receive SSE and update state
  await page.waitForTimeout(500)

  // If app went to start page, reconnect
  if (!page.url().includes('/app')) {
    console.log('[Test Helper] App showed gate, reconnecting...')
    const connectButton = page.locator('button').filter({ hasText: /verbinden|connect/i }).first()
    if (await connectButton.isVisible({ timeout: 2000 })) {
      await connectButton.click()
      await page.waitForURL('**/app', { timeout: 10000 })
    }
  }

  console.log('[Test Helper] Backend reset complete')
  return speaker
}

/**
 * Get project order indices from database via SQL
 * Returns map of project ID to order_index
 */
export async function getProjectOrderIndices(page: Page, backendUrl: string = 'http://localhost:8765'): Promise<Map<string, number>> {
  const response = await page.request.post(`${backendUrl}/api/debug/query`, {
    data: {
      query: 'SELECT id, order_index FROM projects ORDER BY order_index'
    }
  })

  if (!response.ok()) {
    // Fallback: use API and extract orderIndex
    const projectsResponse = await page.request.get(`${backendUrl}/api/projects`)
    const projects = await projectsResponse.json()

    const map = new Map<string, number>()
    projects.forEach((p: any) => {
      map.set(p.id, p.orderIndex)
    })
    return map
  }

  const rows = await response.json()
  const map = new Map<string, number>()
  rows.forEach((row: any) => {
    map.set(row.id, row.order_index)
  })
  return map
}

/**
 * Get chapter order indices from database via SQL
 * Returns map of chapter ID to order_index
 */
export async function getChapterOrderIndices(page: Page, projectId: string, backendUrl: string = 'http://localhost:8765'): Promise<Map<string, number>> {
  const response = await page.request.post(`${backendUrl}/api/debug/query`, {
    data: {
      query: `SELECT id, order_index FROM chapters WHERE project_id = '${projectId}' ORDER BY order_index`
    }
  })

  if (!response.ok()) {
    // Fallback: use API and extract orderIndex
    const projectsResponse = await page.request.get(`${backendUrl}/api/projects`)
    const projects = await projectsResponse.json()
    const project = projects.find((p: any) => p.id === projectId)

    const map = new Map<string, number>()
    if (project && project.chapters) {
      project.chapters.forEach((c: any) => {
        map.set(c.id, c.orderIndex)
      })
    }
    return map
  }

  const rows = await response.json()
  const map = new Map<string, number>()
  rows.forEach((row: any) => {
    map.set(row.id, row.order_index)
  })
  return map
}

/**
 * Create project via API
 */
export async function createProject(page: Page, title: string, backendUrl: string = 'http://localhost:8765') {
  const response = await page.request.post(`${backendUrl}/api/projects`, {
    data: { title }
  })

  if (!response.ok()) {
    throw new Error(`Failed to create project: ${response.status()}`)
  }

  return await response.json()
}

/**
 * Create chapter via API
 */
export async function createChapter(page: Page, projectId: string, title: string, orderIndex: number, backendUrl: string = 'http://localhost:8765') {
  const response = await page.request.post(`${backendUrl}/api/chapters`, {
    data: {
      projectId,
      title,
      orderIndex
    }
  })

  if (!response.ok()) {
    const errorText = await response.text()
    throw new Error(`Failed to create chapter: ${response.status()} - ${errorText}`)
  }

  return await response.json()
}

/**
 * Bulk create test data: projects with chapters
 */
export async function createBulkTestData(
  page: Page,
  numProjects: number,
  chaptersPerProject: number,
  backendUrl: string = 'http://localhost:8765'
) {
  const projects = []

  for (let p = 1; p <= numProjects; p++) {
    const project = await createProject(page, `Project ${p}`, backendUrl)

    const chapters = []
    for (let c = 1; c <= chaptersPerProject; c++) {
      const chapter = await createChapter(page, project.id, `P${p}-C${c}`, c - 1, backendUrl)
      chapters.push(chapter)
    }

    projects.push({ ...project, chapters })
  }

  return projects
}
