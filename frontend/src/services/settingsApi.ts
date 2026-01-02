/**
 * Settings API Client
 *
 * API calls for settings and speaker management.
 */

import { useAppStore } from '@store/appStore';
import type { GlobalSettings } from '@store/appStore';
import type { Speaker, EngineParameterSchema } from '@types';

function getApiBaseUrl(): string {
  const url = useAppStore.getState().connection.url;
  if (!url) throw new Error('Backend not connected');
  return url;
}

// Settings API
export async function fetchSettings(): Promise<GlobalSettings> {
  const response = await fetch(`${getApiBaseUrl()}/api/settings/`);
  if (!response.ok) throw new Error('Failed to fetch settings');
  return response.json();
}

export async function updateSettings(
  category: string,
  value: GlobalSettings[keyof GlobalSettings]
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/settings/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  if (!response.ok) throw new Error('Failed to update settings');
}

export async function resetSettings(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/settings/reset`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error('Failed to reset settings');
}

// Note: engine may be a variant_id (e.g., 'xtts:local') - must be URL-encoded
export async function fetchSegmentLimits(engine: string): Promise<{
  userPreference: number;
  engineMaximum: number;
  effectiveLimit: number;
}> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/settings/segment-limits/${encodeURIComponent(engine)}`
  );
  if (!response.ok) throw new Error('Failed to fetch segment limits');
  return response.json();
}

// Note: engine may be a variant_id (e.g., 'xtts:local') - must be URL-encoded
export async function fetchEngineSchema(
  engine: string,
  engineType?: string
): Promise<Record<string, EngineParameterSchema>> {
  // Use new generic endpoint if engineType provided, fallback to legacy TTS endpoint
  const url = engineType
    ? `${getApiBaseUrl()}/api/settings/engine-schema/${engineType}/${encodeURIComponent(engine)}`
    : `${getApiBaseUrl()}/api/settings/engine-schema/${encodeURIComponent(engine)}`
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch engine schema');
  const data = await response.json();
  return data.parameters; // Extract 'parameters' field from EngineSchemaResponse
}

// Speaker API
export async function fetchSpeakers(): Promise<Speaker[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/speakers/`);
  if (!response.ok) throw new Error('Failed to fetch speakers');
  return response.json();
}

export async function createSpeaker(data: {
  name: string;
  description?: string;
  gender?: 'male' | 'female' | 'neutral';
  languages: string[];
  tags: string[];
}): Promise<Speaker> {
  const response = await fetch(`${getApiBaseUrl()}/api/speakers/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error('Failed to create speaker');
  return response.json();
}

export async function updateSpeaker(
  speakerId: string,
  data: Partial<Speaker>
): Promise<Speaker> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/speakers/${speakerId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  );
  if (!response.ok) throw new Error('Failed to update speaker');
  return response.json();
}

export async function deleteSpeaker(speakerId: string): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/speakers/${speakerId}`,
    {
      method: 'DELETE'
    }
  );
  if (!response.ok) throw new Error('Failed to delete speaker');
}

export async function uploadSpeakerSample(
  speakerId: string,
  file: File,
  transcript?: string
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  if (transcript) formData.append('transcript', transcript);

  const response = await fetch(
    `${getApiBaseUrl()}/api/speakers/${speakerId}/samples`,
    {
      method: 'POST',
      body: formData
    }
  );
  if (!response.ok) throw new Error('Failed to upload sample');
}

export async function deleteSpeakerSample(
  speakerId: string,
  sampleId: string
): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/speakers/${speakerId}/samples/${sampleId}`,
    {
      method: 'DELETE'
    }
  );
  if (!response.ok) throw new Error('Failed to delete sample');
}

export async function setDefaultSpeaker(speakerId: string): Promise<Speaker> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/speakers/${speakerId}/set-default`,
    {
      method: 'POST'
    }
  );
  if (!response.ok) throw new Error('Failed to set default speaker');
  return response.json();
}

export async function getDefaultSpeaker(): Promise<Speaker | null> {
  const response = await fetch(`${getApiBaseUrl()}/api/speakers/default/get`);
  if (!response.ok) throw new Error('Failed to get default speaker');
  return response.json();
}
