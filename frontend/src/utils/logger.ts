/**
 * Environment-aware logging utility for Audiobook Maker
 *
 * Features:
 * - Environment-based log level filtering
 * - Timestamps for all log entries
 * - Context prefixes for better traceability
 * - Production mode: Only error() and warn() active
 * - Development mode: All log levels active
 *
 * Usage:
 * import { logger } from '@/utils/logger'
 * logger.debug('[Component]', 'Debug message', data)
 * logger.info('[Service]', 'Info message')
 * logger.warn('[API]', 'Warning message')
 * logger.error('[Error]', 'Error message', error)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private isDevelopment: boolean

  constructor() {
    // Check if we're in development mode
    this.isDevelopment = import.meta.env.DEV
  }

  /**
   * Get timestamp in HH:MM:SS.mmm format
   */
  private getTimestamp(): string {
    const now = new Date()
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${milliseconds}`
  }

  /**
   * Format log message with timestamp
   */
  private formatMessage(level: LogLevel, ...args: unknown[]): unknown[] {
    const timestamp = this.getTimestamp()
    const levelUpper = level.toUpperCase().padEnd(5, ' ')
    return [`[${timestamp}] ${levelUpper}`, ...args]
  }

  /**
   * Check if log level should be logged based on environment
   */
  private shouldLog(level: LogLevel): boolean {
    if (this.isDevelopment) {
      return true // All levels in development
    }
    // Only warn and error in production
    return level === 'warn' || level === 'error'
  }

  /**
   * Debug level logging (development only)
   * Use for detailed debugging information
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(...this.formatMessage('debug', ...args))
    }
  }

  /**
   * Info level logging (development only)
   * Use for general informational messages
   */
  info(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(...this.formatMessage('info', ...args))
    }
  }

  /**
   * Warning level logging (all environments)
   * Use for potentially problematic situations
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('warn', ...args))
    }
  }

  /**
   * Error level logging (all environments)
   * Use for error conditions
   */
  error(...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage('error', ...args))
    }
  }

  /**
   * Grouped console log with styled badge (development only)
   * Use for detailed logs with metadata
   *
   * @param badge - Badge text (e.g., 'App Init', 'Theme')
   * @param message - Main message
   * @param details - Additional details to log in the group
   * @param badgeColor - Badge background color (default: #4CAF50 green)
   *
   * @example
   * logger.group('🎨 Theme', 'Theme calculation', {
   *   themeSetting: 'system',
   *   prefersDarkMode: true,
   *   resultingMode: 'dark'
   * })
   */
  group(
    badge: string,
    message: string,
    details?: Record<string, any>,
    badgeColor: string = '#4CAF50'
  ): void {
    if (!this.isDevelopment) {
      return // Only log groups in development
    }

    try {
      const timestamp = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      })

      // Safe: Desktop app, dev-only logging, controlled internal values
      console.groupCollapsed(
        `%c${badge}%c ${message} %c${timestamp}`, // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
        `background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;`,
        'color: #2196F3; font-weight: bold;',
        'color: #999; font-size: 0.9em;'
      )

      if (details) {
        for (const [key, value] of Object.entries(details)) {
          // Safe: Desktop app, dev-only logging, key is from Object.entries() iteration
          console.log(`${key}:`, value) // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
        }
      }

      console.groupEnd()
    } catch (error) {
      // Fallback to simple log if grouping fails (Safe: Desktop app, dev-only logging, controlled values)
      console.log(`[${badge}] ${message}`, details) // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    }
  }

  /**
   * Sanitize sensitive data from objects before logging
   * Removes tokens, passwords, sensitive URLs
   */
  sanitize(data: unknown): unknown {
    if (typeof data === 'string') {
      // Remove tokens from URLs
      return data.replace(/([?&]token=)[^&]+/gi, '$1***')
                 .replace(/(Bearer\s+)[^\s]+/gi, '$1***')
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item))
    }

    if (data && typeof data === 'object') {
      const sanitized: Record<string, unknown> = {}
      for (const key in data) {
        // Skip sensitive fields
        if (['token', 'password', 'secret', 'apiKey'].includes(key)) {
          sanitized[key] = '***'
        } else {
          sanitized[key] = this.sanitize((data as Record<string, unknown>)[key])
        }
      }
      return sanitized
    }

    return data
  }
}

// Export singleton instance
export const logger = new Logger()
