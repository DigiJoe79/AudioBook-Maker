/**
 * Database Cleanup
 * Run with: npx playwright test cleanup-db.spec.ts
 */

import { test } from './fixtures'
import { clearAllProjects, clearAllSpeakers } from './fixtures/testHelpers'

test('cleanup database', async ({ page }) => {
  console.log('🧹 Cleaning up database...')

  await clearAllProjects(page, 'http://localhost:8765')
  await clearAllSpeakers(page, 'http://localhost:8765')

  console.log('✅ Database cleaned!')
})
