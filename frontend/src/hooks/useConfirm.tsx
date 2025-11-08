/**
 * useConfirm Hook - Promise-based confirmation dialog
 *
 * Provides a confirm() function that returns a Promise,
 * making it a drop-in replacement for Tauri's ask() dialog
 * but with Material-UI theming (respects dark mode).
 */

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog'

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning'
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

export function useConfirm() {
  const { t } = useTranslation()
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    resolve: null,
  })

  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((title: string, message: string, options?: Partial<ConfirmOptions>): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        open: true,
        title,
        message,
        confirmText: options?.confirmText || t('common.yes'),
        cancelText: options?.cancelText || t('common.no'),
        confirmColor: options?.confirmColor || 'warning',
        resolve,
      })
    })
  }, [t])

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true)
      resolveRef.current = null
    }
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false)
      resolveRef.current = null
    }
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const ConfirmDialogComponent = useCallback(
    () => (
      <ConfirmDialog
        open={state.open}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        confirmColor={state.confirmColor}
      />
    ),
    [state, handleConfirm, handleCancel]
  )

  return { confirm, ConfirmDialog: ConfirmDialogComponent }
}