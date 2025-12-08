/**
 * Error Boundary Component
 *
 * Catches React errors in child components and displays a user-friendly fallback UI.
 * Prevents the entire app from crashing when errors occur in specific components.
 *
 * Features:
 * - Catches rendering errors, lifecycle errors, and constructor errors
 * - Logs errors with the logger utility for debugging
 * - Provides retry functionality to recover from temporary errors
 * - i18n support for German and English
 * - Graceful degradation for critical vs. non-critical components
 *
 * Usage:
 * <ErrorBoundary context="MainView" critical={false}>
 *   <MainView />
 * </ErrorBoundary>
 */

import React, { Component, ReactNode, ErrorInfo } from 'react'
import { Box, Typography, Button, Paper, Alert, AlertTitle } from '@mui/material'
import { ErrorOutline, Refresh } from '@mui/icons-material'
import { withTranslation, WithTranslation } from 'react-i18next'
import { logger } from '@utils/logger'

interface Props extends WithTranslation {
  children: ReactNode
  context?: string
  critical?: boolean
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { context, onError } = this.props
    logger.group('⚠️ Error Boundary', `Caught error${context ? ` in ${context}` : ''}`, {
      'Error Name': error.name,
      'Error Message': error.message,
      'Component Stack': errorInfo.componentStack?.split('\n')[0] || 'N/A',
      'Full Stack': error.stack || 'N/A'
    }, '#F44336')
    this.setState({ errorInfo })
    if (onError) {
      try { onError(error, errorInfo) }
      catch (handlerError) { logger.error('[ErrorBoundary] Error in custom error handler:', handlerError) }
    }
  }

  handleRetry = (): void => {
    logger.info(`[ErrorBoundary${this.props.context ? `:${this.props.context}` : ''}] Retrying...`)
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback, critical, context, t } = this.props

    if (!hasError) return children
    if (fallback) return fallback

    const isCritical = critical ?? true

    return (
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: isCritical ? '100vh' : '400px', padding: 3, backgroundColor: isCritical ? 'background.default' :
          'transparent'
      }}>
        <Paper elevation={isCritical ? 3 : 1} sx={{ maxWidth: 600, width: '100%', padding: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <ErrorOutline sx={{ fontSize: isCritical ? 80 : 60, color: 'error.main', mb: 2 }} />
            <Typography variant={isCritical ? 'h4' : 'h5'} gutterBottom>{t('errorBoundary.title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {context ? t('errorBoundary.contextMessage', { context }) : t('errorBoundary.genericMessage')}
            </Typography>
          </Box>
          {import.meta.env.DEV && error && (
            <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
              <AlertTitle>{t('errorBoundary.devErrorTitle')}</AlertTitle>
              <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>{error.name}: {error.message}</Typography>
            </Alert>
          )}
          <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
            <AlertTitle>{t('errorBoundary.instructionsTitle')}</AlertTitle>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li><Typography variant="body2">{t('errorBoundary.instructions.refresh')}</Typography></li>
              <li><Typography variant="body2">{t('errorBoundary.instructions.checkBackend')}</Typography></li>
              <li><Typography variant="body2">{t('errorBoundary.instructions.contactSupport')}</Typography></li>
            </ul>
          </Alert>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="contained" color="primary" startIcon={<Refresh />} onClick={this.handleRetry}>{t('errorBoundary.retry')}</Button>
            {isCritical && <Button variant="outlined" onClick={() => window.location.reload()}>{t('errorBoundary.reloadPage')}</Button>}
          </Box>
          {import.meta.env.DEV && error?.stack && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom>{t('errorBoundary.devStackTrace')}</Typography>
              <Paper variant="outlined" sx={{ padding: 2, backgroundColor: 'grey.900', maxHeight: 200, overflow: 'auto' }}>
                <Typography variant="body2" component="pre" sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'grey.300', whiteSpace: 'pre-wrap', margin: 0 }}>{error.stack}</Typography>
              </Paper>
            </Box>
          )}
        </Paper>
      </Box>
    )
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryClass)

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  options?: Omit<Props, 'children' | 't' | 'i18n' | 'tReady'>
) {
  return (props: P) => (
    <ErrorBoundary {...options}>
      <Component {...props} />
    </ErrorBoundary>
  )
}