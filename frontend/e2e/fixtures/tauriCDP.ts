/**
 * Tauri CDP (Chrome DevTools Protocol) Integration
 *
 * Enables Playwright to connect to the real Tauri app via WebView2's CDP.
 * Windows only - WebView2 supports --remote-debugging-port.
 *
 * Usage:
 *   npm run test:e2e:tauri
 *
 * How it works:
 * 1. Launches Tauri dev with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var
 * 2. Waits for CDP port to become available
 * 3. Playwright connects via chromium.connectOverCDP()
 */

import { spawn, ChildProcess } from 'child_process'
import { createConnection } from 'net'

export const CDP_PORT = 9222
export const CDP_URL = `http://localhost:${CDP_PORT}`

/**
 * Wait for a TCP port to become available
 */
export async function waitForPort(
  port: number,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port} after ${timeoutMs}ms`))
        return
      }

      const socket = createConnection({ port, host: 'localhost' }, () => {
        socket.destroy()
        resolve()
      })

      socket.on('error', () => {
        socket.destroy()
        setTimeout(tryConnect, 500)
      })
    }

    tryConnect()
  })
}

/**
 * Launch Tauri app with CDP enabled
 *
 * Sets WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS to enable remote debugging.
 * Returns the child process for cleanup.
 */
export async function launchTauriWithCDP(
  options: {
    timeout?: number
    cwd?: string
  } = {}
): Promise<ChildProcess> {
  const { timeout = 60000, cwd = process.cwd() } = options

  console.log('[Tauri CDP] Launching Tauri with CDP on port', CDP_PORT)

  const tauriProcess = spawn('npm', ['run', 'dev:tauri'], {
    cwd,
    shell: true,
    stdio: 'pipe',
    env: {
      ...process.env,
      // Enable CDP in WebView2
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
  })

  // Log Tauri output for debugging
  tauriProcess.stdout?.on('data', (data) => {
    const line = data.toString().trim()
    if (line) console.log('[Tauri]', line)
  })

  tauriProcess.stderr?.on('data', (data) => {
    const line = data.toString().trim()
    if (line) console.error('[Tauri Error]', line)
  })

  tauriProcess.on('error', (err) => {
    console.error('[Tauri CDP] Process error:', err)
  })

  tauriProcess.on('exit', (code) => {
    console.log('[Tauri CDP] Process exited with code:', code)
  })

  // Wait for CDP port to be ready
  console.log('[Tauri CDP] Waiting for CDP port...')
  await waitForPort(CDP_PORT, timeout)
  console.log('[Tauri CDP] CDP port ready!')

  // Give the app a moment to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 2000))

  return tauriProcess
}

/**
 * Kill a Tauri process and its children
 */
export async function killTauriProcess(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return

  console.log('[Tauri CDP] Killing Tauri process...')

  return new Promise((resolve) => {
    // On Windows, we need to kill the process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
        shell: true,
      }).on('close', () => resolve())
    } else {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
        resolve()
      }, 3000)
    }
  })
}
