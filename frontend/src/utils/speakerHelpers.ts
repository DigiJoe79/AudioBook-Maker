/**
 * Speaker Helper Functions
 *
 * Utilities for speaker validation and status checking
 */

import type { Speaker } from '@types';

/**
 * Check if a speaker is active (has samples)
 *
 * @param speakerName - Name of the speaker to check
 * @param speakers - List of all speakers
 * @returns true if speaker exists and is active, false otherwise
 */
export function isActiveSpeaker(
  speakerName: string | null | undefined,
  speakers: Speaker[]
): boolean {
  if (!speakerName) return false;

  const speaker = speakers.find(s => s.name === speakerName);
  return speaker?.isActive ?? false;
}
