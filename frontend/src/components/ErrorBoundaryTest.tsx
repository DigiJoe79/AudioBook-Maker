/**
 * Error Boundary Test Component
 *
 * This component is used to test Error Boundary functionality.
 * It can be imported and rendered in development to verify error handling.
 *
 * Usage:
 * import { ErrorBoundaryTest } from './components/ErrorBoundaryTest'
 *
 * // In your component:
 * {import.meta.env.DEV && <ErrorBoundaryTest />}
 */

import { useState } from 'react'
import { Box, Button, Typography, Paper } from '@mui/material'
import { BugReport } from '@mui/icons-material'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Component that throws an error when button is clicked
 */
function BuggyComponent({ shouldError }: { shouldError: boolean }) {
  if (shouldError) {
    throw new Error('Test error from BuggyComponent!')
  }

  return (
    <Typography>
      Component is working fine. Click the button below to trigger an error.
    </Typography>
  )
}

/**
 * Test harness for Error Boundary
 */
export function ErrorBoundaryTest() {
  const [triggerError, setTriggerError] = useState(false)

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 2, bgcolor: 'warning.light' }}>
        <Typography variant="h6" gutterBottom>
          <BugReport sx={{ verticalAlign: 'middle', mr: 1 }} />
          Error Boundary Test (Development Only)
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          This component tests the Error Boundary implementation.
          Click the button to trigger a React error and see the fallback UI.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <ErrorBoundary context="Test" critical={false}>
          <BuggyComponent shouldError={triggerError} />
        </ErrorBoundary>

        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            color="error"
            onClick={() => setTriggerError(true)}
            startIcon={<BugReport />}
          >
            Trigger Test Error
          </Button>
          <Button
            variant="outlined"
            onClick={() => setTriggerError(false)}
            sx={{ ml: 2 }}
          >
            Reset
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}

/**
 * Scenarios to test Error Boundaries:
 *
 * 1. **Rendering Error (Component)**:
 *    - Import ErrorBoundaryTest in any component
 *    - Click "Trigger Test Error" button
 *    - Should show ErrorBoundary fallback UI
 *    - Click "Retry" to reset
 *
 * 2. **Lifecycle Error (useEffect)**:
 *    - Add this to any component:
 *      useEffect(() => { throw new Error('useEffect error!') }, [])
 *    - Should be caught by nearest ErrorBoundary
 *
 * 3. **Event Handler Error**:
 *    - Note: Event handler errors are NOT caught by ErrorBoundary
 *    - These must be handled with try-catch
 *
 * 4. **Async Error**:
 *    - Note: Async errors are NOT caught by ErrorBoundary
 *    - Use error handling in promises/async functions
 *
 * 5. **Critical vs Non-Critical**:
 *    - Critical (App-level): Shows full-screen error with reload option
 *    - Non-Critical (Component-level): Shows inline error with retry
 *
 * 6. **Context-Specific Messages**:
 *    - Each context shows different error message
 *    - Different recovery instructions
 *
 * 7. **Development Features**:
 *    - Stack trace visible in DEV mode
 *    - Error details logged with logger
 */
