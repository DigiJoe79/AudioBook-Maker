/**
 * Type Guards
 *
 * Runtime type validation functions for safe type checking.
 */

/**
 * Check if error is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Convert unknown error to string safely
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
