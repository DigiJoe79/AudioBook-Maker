
import type { Speaker } from '../types';

export function isActiveSpeaker(
  speakerName: string | null | undefined,
  speakers: Speaker[]
): boolean {
  if (!speakerName) return false;

  const speaker = speakers.find(s => s.name === speakerName);
  return speaker?.isActive ?? false;
}

export function getSpeakerByName(
  speakerName: string | null | undefined,
  speakers: Speaker[]
): Speaker | undefined {
  if (!speakerName) return undefined;
  return speakers.find(s => s.name === speakerName);
}

export function getActiveSpeakers(speakers: Speaker[]): Speaker[] {
  return speakers.filter(s => s.isActive);
}
