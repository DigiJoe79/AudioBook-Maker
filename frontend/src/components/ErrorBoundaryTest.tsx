
import { useState } from 'react'
import { Box, Button, Typography, Paper } from '@mui/material'
import { BugReport } from '@mui/icons-material'
import { ErrorBoundary } from './ErrorBoundary'

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

