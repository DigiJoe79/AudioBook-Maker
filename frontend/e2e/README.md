# E2E Tests - Audiobook Maker

End-to-End tests using Playwright for critical user workflows.

## Quick Start

```bash
# Install dependencies (if not already)
npm install

# Run all E2E tests
npm run test:e2e

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run in debug mode (step through tests)
npm run test:e2e:debug

# View test report
npm run test:e2e:report
```

## Test Suites

| Suite | File | Coverage |
|-------|------|----------|
| **Navigation** | `navigation.spec.ts` | 6 views, keyboard shortcuts, badges |
| **Project Management** | `project-management.spec.ts` | Projects, chapters, sidebar |
| **Segment Management** | `segment-management.spec.ts` | CRUD, status indicators, virtualization |
| **Drag & Drop** | `drag-and-drop.spec.ts` | Segment reordering, keyboard DnD |
| **TTS Workflow** | `tts-workflow.spec.ts` | Generation, jobs, SSE updates |
| **AudioPlayer** | `audio-player.spec.ts` | Playback, waveform, seeking |

## Running Specific Tests

```bash
# Run single test suite
npx playwright test e2e/tests/navigation.spec.ts

# Run tests matching pattern
npx playwright test --grep "should create"

# Run tests in specific browser
npx playwright test --project=chromium
```

## Writing Tests

See `E2E_TESTING_GUIDE.md` for detailed patterns and best practices.

### Quick Example

```typescript
import { test, expect } from '../fixtures'

test('should create project', async ({ projectSidebarPage }) => {
  await projectSidebarPage.createProject('My Project')
  const exists = await projectSidebarPage.projectExists('My Project')
  expect(exists).toBe(true)
})
```

## Test Data

Tests use a mock backend with pre-defined test data:
- 1 test project with 2 chapters
- 4 segments (3 text, 1 divider)
- 2 active speakers
- XTTS engine configuration

See `fixtures/testData.ts` for details.

## CI/CD

Tests run automatically on:
- Every push to `main`
- Every pull request
- Manual workflow dispatch

View results in GitHub Actions.

## Troubleshooting

### Tests failing with "Element not found"

1. Verify component has `data-testid` attribute
2. Run in headed mode: `npm run test:e2e:headed`
3. Check if element is conditionally rendered

### Tests are flaky

1. Use Playwright's auto-waiting (avoid `waitForTimeout`)
2. Check test uses stable selectors (`data-testid`)
3. Review test isolation (database state reset)

### Playwright browsers not installed

```bash
npx playwright install
```

## Documentation

- **Full Guide:** `E2E_TESTING_GUIDE.md`
- **Playwright Docs:** https://playwright.dev/
- **Audit Report:** `CODEBASE_AUDIT_REPORT_FINAL.md` (P0.1)
