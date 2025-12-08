/**
 * Type Guards
 *
 * Runtime type validation functions for safe type checking.
 * Use these instead of unsafe type casts (as any, as unknown as Type).
 */

import type { Segment, Speaker, Chapter } from '@types';

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

/**
 * Check if value is a valid Segment
 */
export function isSegment(value: unknown): value is Segment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const segment = value as Record<string, unknown>;

  return (
    typeof segment.id === 'string' &&
    typeof segment.chapterId === 'string' &&
    typeof segment.text === 'string' &&
    typeof segment.orderIndex === 'number' &&
    typeof segment.engine === 'string' &&
    typeof segment.modelName === 'string' &&
    typeof segment.language === 'string' &&
    (segment.segmentType === 'standard' || segment.segmentType === 'divider') &&
    (segment.status === 'pending' ||
     segment.status === 'processing' ||
     segment.status === 'completed' ||
     segment.status === 'failed')
  );
}

/**
 * Check if value is a valid Speaker
 */
export function isSpeaker(value: unknown): value is Speaker {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const speaker = value as Record<string, unknown>;

  return (
    typeof speaker.id === 'string' &&
    typeof speaker.name === 'string' &&
    typeof speaker.isActive === 'boolean' &&
    typeof speaker.isDefault === 'boolean' &&
    Array.isArray(speaker.samples)
  );
}

/**
 * Check if value is a valid Chapter
 */
export function isChapter(value: unknown): value is Chapter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const chapter = value as Record<string, unknown>;

  return (
    typeof chapter.id === 'string' &&
    typeof chapter.projectId === 'string' &&
    typeof chapter.title === 'string' &&
    typeof chapter.orderIndex === 'number' &&
    Array.isArray(chapter.segments)
  );
}

/**
 * Check if value is a valid FileReader result
 */
export function isFileReaderResult(value: unknown): value is string | ArrayBuffer | null {
  return (
    value === null ||
    typeof value === 'string' ||
    value instanceof ArrayBuffer
  );
}

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Value must be defined');
  }
}

/**
 * Safe JSON parse with type validation
 */
export function safeJsonParse<T>(
  json: string,
  validator: (value: unknown) => value is T
): T | null {
  try {
    const parsed = JSON.parse(json);
    if (validator(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
