/**
 * useDebouncedCallback Hook
 *
 * Creates a debounced version of a callback function.
 * The callback will only be executed after the specified delay has passed
 * since the last invocation.
 */

import { useCallback, useRef } from 'react'

/**
 * Create a debounced callback
 *
 * @param callback - The function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced version of the callback
 *
 * @example
 * ```tsx
 * import { logger } from '@/utils/logger'
 *
 * const saveData = useDebouncedCallback(() => {
 *   logger.debug('Saving data...')
 * }, 1000)
 *
 * // Will only execute once after 1 second of inactivity
 * saveData()
 * saveData()
 * saveData()
 * ```
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<number | undefined>(undefined)

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = window.setTimeout(() => {
        callback(...args)
      }, delay)
    },
    [callback, delay]
  ) as T
}
