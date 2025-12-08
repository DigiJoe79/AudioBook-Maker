/**
 * Mock Backend for E2E Tests
 *
 * Intercepts API calls and provides test data without requiring a real backend.
 * Supports:
 * - Project/Chapter/Segment CRUD
 * - TTS job simulation
 * - SSE event streaming
 * - Speaker management
 */

import { Page, Route } from '@playwright/test'
import { testData } from './testData'

export class MockBackend {
  private routes: Route[] = []

  constructor(private page: Page) {}

  async start(): Promise<void> {
    // Mock health endpoint
    await this.page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          backendRunning: true,
          sseAvailable: true,
        }),
      })
    })

    // Mock projects endpoint
    await this.page.route('**/api/projects', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testData.projects),
        })
      } else if (route.request().method() === 'POST') {
        const data = route.request().postDataJSON()
        const newProject = {
          id: `proj-${Date.now()}`,
          ...data,
          chapters: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        testData.projects.push(newProject)
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newProject),
        })
      }
    })

    // Mock project detail endpoint
    await this.page.route('**/api/projects/*', async (route) => {
      const projectId = route.request().url().split('/').pop()?.split('?')[0]
      const project = testData.projects.find((p) => p.id === projectId)

      if (route.request().method() === 'GET') {
        if (project) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(project),
          })
        } else {
          await route.fulfill({ status: 404 })
        }
      } else if (route.request().method() === 'DELETE') {
        const index = testData.projects.findIndex((p) => p.id === projectId)
        if (index !== -1) {
          testData.projects.splice(index, 1)
          await route.fulfill({ status: 204 })
        } else {
          await route.fulfill({ status: 404 })
        }
      }
    })

    // Mock chapters endpoint
    await this.page.route('**/api/projects/*/chapters', async (route) => {
      const projectId = route.request().url().split('/projects/')[1].split('/')[0]
      const project = testData.projects.find((p) => p.id === projectId)

      if (route.request().method() === 'POST' && project) {
        const data = route.request().postDataJSON()
        const newChapter = {
          id: `ch-${Date.now()}`,
          projectId,
          ...data,
          segments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        project.chapters.push(newChapter)
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newChapter),
        })
      }
    })

    // Mock chapter detail endpoint
    await this.page.route('**/api/chapters/*', async (route) => {
      const chapterId = route.request().url().split('/').pop()?.split('?')[0]

      // Find chapter across all projects
      let chapter = null
      for (const project of testData.projects) {
        chapter = project.chapters.find((c) => c.id === chapterId)
        if (chapter) break
      }

      if (route.request().method() === 'GET') {
        if (chapter) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(chapter),
          })
        } else {
          await route.fulfill({ status: 404 })
        }
      }
    })

    // Mock segments endpoint
    await this.page.route('**/api/chapters/*/segments', async (route) => {
      const chapterId = route.request().url().split('/chapters/')[1].split('/')[0]

      // Find chapter
      let chapter = null
      for (const project of testData.projects) {
        chapter = project.chapters.find((c) => c.id === chapterId)
        if (chapter) break
      }

      if (route.request().method() === 'GET' && chapter) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(chapter.segments || []),
        })
      } else if (route.request().method() === 'POST' && chapter) {
        const data = route.request().postDataJSON()
        const newSegment = {
          id: `seg-${Date.now()}`,
          chapterId,
          orderIndex: chapter.segments?.length || 0,
          status: 'pending',
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        if (!chapter.segments) chapter.segments = []
        chapter.segments.push(newSegment)
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newSegment),
        })
      }
    })

    // Mock segment reorder endpoint
    await this.page.route('**/api/chapters/*/segments/reorder', async (route) => {
      if (route.request().method() === 'PUT') {
        const data = route.request().postDataJSON()
        const { segmentIds } = data

        const chapterId = route.request().url().split('/chapters/')[1].split('/')[0]
        let chapter = null
        for (const project of testData.projects) {
          chapter = project.chapters.find((c) => c.id === chapterId)
          if (chapter) break
        }

        if (chapter && chapter.segments) {
          // Reorder segments
          const reordered = segmentIds.map((id: string) =>
            chapter!.segments!.find((s) => s.id === id)
          ).filter(Boolean)

          // Update order indices
          reordered.forEach((seg: any, idx: number) => {
            seg.orderIndex = idx
          })

          chapter.segments = reordered

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(reordered),
          })
        } else {
          await route.fulfill({ status: 404 })
        }
      }
    })

    // Mock TTS engines endpoint
    await this.page.route('**/api/tts/engines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testData.ttsEngines),
      })
    })

    // Mock speakers endpoint
    await this.page.route('**/api/speakers', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testData.speakers),
        })
      }
    })

    // Mock TTS generation endpoint
    await this.page.route('**/api/tts/generate/chapter/*', async (route) => {
      if (route.request().method() === 'POST') {
        const jobId = `job-${Date.now()}`
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            jobId,
            chapterId: route.request().url().split('/').pop(),
            status: 'pending',
            createdAt: new Date().toISOString(),
          }),
        })
      }
    })

    // Mock SSE endpoint (returns empty stream for now)
    await this.page.route('**/api/events/subscribe', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"connected"}\n\n',
      })
    })

    // Mock settings endpoint
    await this.page.route('**/api/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testData.settings),
      })
    })
  }

  async stop(): Promise<void> {
    // Cleanup routes
    for (const route of this.routes) {
      await route.abort()
    }
  }

  // Helper: Simulate SSE event
  async emitSSEEvent(eventType: string, data: any): Promise<void> {
    // Note: This would require custom SSE handling
    // For now, we'll rely on direct state updates
    console.log('SSE Event:', eventType, data)
  }

  // Helper: Reset test data
  resetData(): void {
    testData.projects = []
    testData.speakers = []
  }
}
