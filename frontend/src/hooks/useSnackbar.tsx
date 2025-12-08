/**
 * useSnackbar Hook - Centralized snackbar notifications
 *
 * Provides a showSnackbar() function that displays non-blocking notifications
 * for success, error, info, and warning messages using Material-UI Snackbar.
 *
 * Consistent with useError/useConfirm pattern for unified notification system.
 */

import { useState, useCallback } from 'react'
import { Snackbar, Alert, AlertColor } from '@mui/material'

interface SnackbarOptions {
  /** Severity level (default: 'info') */
  severity?: AlertColor
  /** Auto-hide duration in milliseconds (default: 3000) */
  autoHideDuration?: number
  /** Alert variant (default: 'filled') */
  variant?: 'filled' | 'outlined' | 'standard'
}

interface SnackbarState {
  open: boolean
  message: string
  severity: AlertColor
  autoHideDuration: number
  variant: 'filled' | 'outlined' | 'standard'
}

export function useSnackbar() {
  const [state, setState] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'info',
    autoHideDuration: 3000,
    variant: 'filled',
  })

  const showSnackbar = useCallback(
    (message: string, options?: SnackbarOptions): void => {
      setState({
        open: true,
        message,
        severity: options?.severity || 'info',
        autoHideDuration: options?.autoHideDuration || 3000,
        variant: options?.variant || 'filled',
      })
    },
    []
  )

  const handleClose = useCallback((_event?: React.SyntheticEvent | Event, reason?: string) => {
    // Don't close on clickaway - only on auto-hide or explicit close button
    if (reason === 'clickaway') {
      return
    }
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const SnackbarComponent = useCallback(
    () => (
      <Snackbar
        open={state.open}
        autoHideDuration={state.autoHideDuration}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ top: '10px !important' }}
      >
        <Alert
          onClose={handleClose}
          severity={state.severity}
          variant={state.variant}
          sx={{ width: '100%' }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    ),
    [state, handleClose]
  )

  return { showSnackbar, SnackbarComponent }
}
