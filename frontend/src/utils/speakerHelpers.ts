/**
 * Speaker Helper Functions
 *
 * Utilities for speaker validation and status checking
 */

import type { Speaker } from '../types';

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

/**
 * Get speaker by name
 *
 * @param speakerName - Name of the speaker
 * @param speakers - List of all speakers
 * @returns Speaker object or undefined
 */
export function getSpeakerByName(
  speakerName: string | null | undefined,
  speakers: Speaker[]
): Speaker | undefined {
  if (!speakerName) return undefined;
  return speakers.find(s => s.name === speakerName);
}

/**
 * Get only active speakers from a list
 *
 * @param speakers - List of all speakers
 * @returns List of active speakers only
 */
export function getActiveSpeakers(speakers: Speaker[]): Speaker[] {
  return speakers.filter(s => s.isActive);
}
