
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private isDevelopment: boolean

  constructor() {
    this.isDevelopment = import.meta.env.DEV
  }

  private getTimestamp(): string {
    const now = new Date()
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${milliseconds}`
  }

  private formatMessage(level: LogLevel, ...args: any[]): any[] {
    const timestamp = this.getTimestamp()
    const levelUpper = level.toUpperCase().padEnd(5, ' ')
    return [`[${timestamp}] ${levelUpper}`, ...args]
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.isDevelopment) {
      return true
    }
    return level === 'warn' || level === 'error'
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(...this.formatMessage('debug', ...args))
    }
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(...this.formatMessage('info', ...args))
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('warn', ...args))
    }
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage('error', ...args))
    }
  }

  sanitize(data: any): any {
    if (typeof data === 'string') {
      return data.replace(/([?&]token=)[^&]+/gi, '$1***')
                 .replace(/(Bearer\s+)[^\s]+/gi, '$1***')
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item))
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {}
      for (const key in data) {
        if (['token', 'password', 'secret', 'apiKey'].includes(key)) {
          sanitized[key] = '***'
        } else {
          sanitized[key] = this.sanitize(data[key])
        }
      }
      return sanitized
    }

    return data
  }
}

export const logger = new Logger()
