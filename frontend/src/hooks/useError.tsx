/**
 * useError Hook - Promise-based error dialog
 *
 * Provides a showError() function that displays error messages
 * in a Material-UI dialog instead of native alert().
 */

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorDialog } from '@components/dialogs/ErrorDialog'

interface ErrorOptions {
  title: string
  message: string
  icon?: React.ReactNode
  closeText?: string
}

interface ErrorState extends ErrorOptions {
  open: boolean
  resolve: (() => void) | null
}

export function useError() {
  const { t } = useTranslation()
  const [state, setState] = useState<ErrorState>({
    open: false,
    title: '',
    message: '',
    resolve: null,
  })

  const resolveRef = useRef<(() => void) | null>(null)

  const showError = useCallback(
    (title: string, message: string, options?: Partial<ErrorOptions>): Promise<void> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve
        setState({
          open: true,
          title,
          message,
          icon: options?.icon,
          closeText: options?.closeText || t('common.ok'),
          resolve,
        })
      })
    },
    [t]
  )

  const handleClose = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current()
      resolveRef.current = null
    }
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const ErrorDialogComponent = useCallback(
    () => (
      <ErrorDialog
        open={state.open}
        onClose={handleClose}
        title={state.title}
        message={state.message}
        icon={state.icon}
        closeText={state.closeText}
      />
    ),
    [state, handleClose]
  )

  return { showError, ErrorDialog: ErrorDialogComponent }
}
