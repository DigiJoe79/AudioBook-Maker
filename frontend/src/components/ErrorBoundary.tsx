
import React, { Component, ReactNode, ErrorInfo } from 'react'
import { Box, Typography, Button, Paper, Alert, AlertTitle } from '@mui/material'
import { ErrorOutline, Refresh } from '@mui/icons-material'
import { logger } from '../utils/logger'

interface Props {
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

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { context, onError } = this.props

    logger.error(
      `[ErrorBoundary${context ? `:${context}` : ''}]`,
      'Caught error:',
      {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        componentStack: errorInfo.componentStack,
      }
    )

    this.setState({
      errorInfo,
    })

    if (onError) {
      try {
        onError(error, errorInfo)
      } catch (handlerError) {
        logger.error('[ErrorBoundary] Error in custom error handler:', handlerError)
      }
    }
  }

  handleRetry = (): void => {
    logger.info(`[ErrorBoundary${this.props.context ? `:${this.props.context}` : ''}] Retrying...`)
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
  }

  private getErrorDetails(): { message: string; instructions: string[] } {
    const { context } = this.props

    switch (context) {
      case 'ChapterView':
        return {
          message: 'Failed to load chapter content',
          instructions: [
            'Try selecting a different chapter',
            'Check if the project still exists',
            'Refresh the page if the issue persists',
          ],
        }

      case 'SegmentList':
        return {
          message: 'Failed to load segment list',
          instructions: [
            'Try refreshing the chapter',
            'Check your backend connection',
            'Some drag & drop operations may have failed',
          ],
        }

      case 'AudioPlayer':
        return {
          message: 'Audio playback error',
          instructions: [
            'Check if the audio file exists',
            'Try regenerating the audio',
            'Verify your browser supports the audio format',
          ],
        }

      case 'GenerateAudioDialog':
        return {
          message: 'Failed to initialize audio generation',
          instructions: [
            'Check your TTS engine settings',
            'Verify speaker is selected',
            'Check backend connection',
          ],
        }

      case 'ExportDialog':
        return {
          message: 'Export dialog error',
          instructions: [
            'Check if all segments have audio',
            'Verify export settings',
            'Try exporting a smaller chapter',
          ],
        }

      default:
        return {
          message: 'An unexpected error occurred',
          instructions: [
            'Try refreshing the page',
            'Check your backend connection',
            'Contact support if the issue persists',
          ],
        }
    }
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback, critical, context } = this.props

    if (!hasError) {
      return children
    }

    if (fallback) {
      return fallback
    }

    const { message, instructions } = this.getErrorDetails()
    const isCritical = critical ?? true

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: isCritical ? '100vh' : '400px',
          padding: 3,
          backgroundColor: isCritical ? 'background.default' : 'transparent',
        }}
      >
        <Paper
          elevation={isCritical ? 3 : 1}
          sx={{
            maxWidth: 600,
            width: '100%',
            padding: 4,
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <ErrorOutline
              sx={{
                fontSize: isCritical ? 80 : 60,
                color: 'error.main',
                mb: 2,
              }}
            />
            <Typography variant={isCritical ? 'h4' : 'h5'} gutterBottom>
              {message}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {context ? `Component: ${context}` : 'An error occurred in the application'}
            </Typography>
          </Box>

          {import.meta.env.DEV && error && (
            <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
              <AlertTitle>Error Details (Development)</AlertTitle>
              <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>
                {error.name}: {error.message}
              </Typography>
            </Alert>
          )}

          <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
            <AlertTitle>What you can try:</AlertTitle>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              {instructions.map((instruction, index) => (
                <li key={index}>
                  <Typography variant="body2">{instruction}</Typography>
                </li>
              ))}
            </ul>
          </Alert>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<Refresh />}
              onClick={this.handleRetry}
            >
              Retry
            </Button>
            {isCritical && (
              <Button
                variant="outlined"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            )}
          </Box>

          {import.meta.env.DEV && error?.stack && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom>
                Stack Trace (Development):
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  padding: 2,
                  backgroundColor: 'grey.900',
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    color: 'grey.300',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}
                >
                  {error.stack}
                </Typography>
              </Paper>
            </Box>
          )}
        </Paper>
      </Box>
    )
  }
}

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  options?: Omit<Props, 'children'>
) {
  return (props: P) => (
    <ErrorBoundary {...options}>
      <Component {...props} />
    </ErrorBoundary>
  )
}
