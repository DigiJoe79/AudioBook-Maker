/**
 * API Type Transforms
 *
 * This file provides:
 * 1. Type aliases that reference OpenAPI-generated types (single source of truth)
 * 2. Transform functions to convert API responses (ISO strings) to domain types (Date objects)
 *
 * Usage:
 *   import { ApiSegment, transformSegment } from '@types/transforms'
 *   const segment = transformSegment(apiResponse)
 */

import type { components } from './api.generated'
import type {
  Segment,
  Chapter,
  Project,
  Speaker,
  SpeakerSample,
  TTSJob,
  PronunciationRule,
} from './index'
import type { QualityJob } from './quality'
import type {
  EngineStatusInfo,
  EngineType,
  EngineStatus,
  AllEnginesStatus,
  DockerImageInfo,
  DockerImageVariant,
  DockerCatalogResponse,
  DockerInstallResponse,
} from './engines'

// ============================================================================
// Type Aliases (from OpenAPI-generated types)
// ============================================================================

/** API response for a segment */
export type ApiSegment = components['schemas']['SegmentResponse']

/** API response for a chapter (without segments) */
export type ApiChapter = components['schemas']['ChapterResponse']

/** API response for a chapter with segments */
export type ApiChapterWithSegments = components['schemas']['ChapterWithSegmentsResponse']

/** API response for a project (without chapters) */
export type ApiProject = components['schemas']['ProjectResponse']

/** API response for a project with chapters and segments */
export type ApiProjectWithChapters = components['schemas']['ProjectWithChaptersResponse']

/** API response for a speaker */
export type ApiSpeaker = components['schemas']['SpeakerResponse']

/** API response for a speaker sample */
export type ApiSpeakerSample = components['schemas']['SpeakerSampleResponse']

/** API response for a TTS job */
export type ApiTTSJob = components['schemas']['TTSJobResponse']

/** API response for TTS jobs list */
export type ApiTTSJobsListResponse = components['schemas']['TTSJobsListResponse']

/** API response for a quality job */
export type ApiQualityJob = components['schemas']['QualityJobResponse']

/** API response for quality jobs list */
export type ApiQualityJobsListResponse = components['schemas']['QualityJobsListResponse']

/** API response for a pronunciation rule */
export type ApiPronunciationRule = components['schemas']['PronunciationRuleResponse']

/** API response for engine status info */
export type ApiEngineStatusInfo = components['schemas']['EngineStatusInfo']

/** API response for all engines status */
export type ApiAllEnginesStatus = components['schemas']['AllEnginesStatusResponse']

/** API response for Docker image info */
export type ApiDockerImageInfo = components['schemas']['DockerImageInfo']

/** API response for Docker image variant */
export type ApiDockerImageVariant = components['schemas']['DockerImageVariant']

/** API response for Docker catalog */
export type ApiDockerCatalogResponse = components['schemas']['DockerCatalogResponse']

/** API response for Docker install/uninstall */
export type ApiDockerInstallResponse = components['schemas']['DockerInstallResponse']

// ============================================================================
// Transform Functions (ISO strings → Date objects)
// ============================================================================

/**
 * Transform API segment response to domain Segment
 * Converts ISO timestamps to Date objects, null to undefined where needed
 */
export function transformSegment(api: ApiSegment): Segment {
  return {
    ...api,
    segmentType: api.segmentType as 'standard' | 'divider',
    status: api.status as Segment['status'],
    audioPath: api.audioPath ?? undefined,
    ttsSpeakerName: api.ttsSpeakerName ?? null,
    isFrozen: api.isFrozen ?? false,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  }
}

/**
 * Transform API chapter response to domain Chapter (without segments)
 */
export function transformChapter(api: ApiChapter): Omit<Chapter, 'segments'> {
  return {
    ...api,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  }
}

/**
 * Transform API chapter with segments to domain Chapter
 * Recursively transforms all nested segments
 */
export function transformChapterWithSegments(api: ApiChapterWithSegments): Chapter {
  return {
    ...transformChapter(api),
    segments: (api.segments ?? []).map(transformSegment),
  }
}

/**
 * Transform API project response to domain Project (without chapters)
 */
export function transformProject(api: ApiProject): Omit<Project, 'chapters'> {
  return {
    ...api,
    description: api.description ?? undefined,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  }
}

/**
 * Transform API project with chapters to domain Project
 * Recursively transforms all nested chapters and segments
 */
export function transformProjectWithChapters(api: ApiProjectWithChapters): Project {
  return {
    ...transformProject(api),
    chapters: (api.chapters ?? []).map(transformChapterWithSegments),
  }
}

/**
 * Transform API speaker sample to domain SpeakerSample
 * Converts null to undefined for optional fields
 */
export function transformSpeakerSample(api: ApiSpeakerSample): SpeakerSample {
  return {
    ...api,
    duration: api.duration ?? undefined,
    sampleRate: api.sampleRate ?? undefined,
    transcript: api.transcript ?? undefined,
    createdAt: new Date(api.createdAt),
  }
}

/**
 * Transform API speaker response to domain Speaker
 * Recursively transforms all nested samples, converts null to undefined
 */
export function transformSpeaker(api: ApiSpeaker): Speaker {
  return {
    ...api,
    description: api.description ?? undefined,
    gender: (api.gender ?? undefined) as Speaker['gender'],
    languages: api.languages ?? [],
    tags: api.tags ?? [],
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    samples: (api.samples ?? []).map(transformSpeakerSample),
  }
}

/**
 * Transform API TTS job response to domain TTSJob
 * Handles optional dates (startedAt, completedAt can be null)
 */
export function transformTTSJob(api: ApiTTSJob): TTSJob {
  return {
    ...api,
    chapterId: api.chapterId ?? null,
    // API returns array of segment objects, domain expects JSON string or undefined
    segmentIds: api.segmentIds ? JSON.stringify(api.segmentIds) : undefined,
    status: api.status as TTSJob['status'],
    createdAt: new Date(api.createdAt),
    startedAt: api.startedAt ? new Date(api.startedAt) : null,
    completedAt: api.completedAt ? new Date(api.completedAt) : null,
    updatedAt: new Date(api.updatedAt),
  }
}

/**
 * Transform API quality job response to domain QualityJob
 * Handles optional dates as undefined (not null) to match domain type
 */
export function transformQualityJob(api: ApiQualityJob): QualityJob {
  return {
    ...api,
    type: api.jobType as QualityJob['type'],
    status: api.status as QualityJob['status'],
    sttEngine: api.sttEngine ?? undefined,
    sttModelName: api.sttModelName ?? undefined,
    audioEngine: api.audioEngine ?? undefined,
    currentSegmentId: api.currentSegmentId ?? undefined,
    chapterId: api.chapterId ?? undefined,
    segmentId: api.segmentId ?? undefined,
    // Transform segment status objects (API has looser types)
    segmentIds: api.segmentIds?.map((s) => ({
      id: s.id,
      jobStatus: s.jobStatus as 'pending' | 'analyzed',
    })),
    triggerSource: api.triggerSource ?? undefined,
    errorMessage: api.errorMessage ?? undefined,
    chapterTitle: api.chapterTitle ?? undefined,
    projectTitle: api.projectTitle ?? undefined,
    createdAt: new Date(api.createdAt),
    startedAt: api.startedAt ? new Date(api.startedAt) : undefined,
    completedAt: api.completedAt ? new Date(api.completedAt) : undefined,
  }
}

/**
 * Transform API pronunciation rule response to domain PronunciationRule
 */
export function transformPronunciationRule(api: ApiPronunciationRule): PronunciationRule {
  return {
    ...api,
    scope: api.scope as PronunciationRule['scope'],
    projectId: api.projectId ?? undefined,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  }
}

// ============================================================================
// Engine Transform Functions (string → Union Types)
// ============================================================================

/**
 * Transform API engine status to domain EngineStatusInfo
 * Narrows loose string types to strict union types
 */
export function transformEngineStatusInfo(api: ApiEngineStatusInfo): EngineStatusInfo {
  return {
    ...api,
    engineType: api.engineType as EngineType,
    status: api.status as EngineStatus,
    device: api.device as 'cpu' | 'cuda',
    port: api.port ?? undefined,
    errorMessage: api.errorMessage ?? undefined,
    idleTimeoutSeconds: api.idleTimeoutSeconds ?? undefined,
    secondsUntilAutoStop: api.secondsUntilAutoStop ?? undefined,
    supportedLanguages: api.supportedLanguages ?? [],
    allSupportedLanguages: api.allSupportedLanguages ?? undefined,
    gpuMemoryUsedMb: api.gpuMemoryUsedMb ?? undefined,
    gpuMemoryTotalMb: api.gpuMemoryTotalMb ?? undefined,
    availableModels: api.availableModels ?? [],
    loadedModel: api.loadedModel ?? undefined,
    defaultModelName: api.defaultModelName ?? undefined,
    defaultLanguage: api.defaultLanguage ?? undefined,
    baseEngineName: api.baseEngineName ?? undefined,
    runnerId: api.runnerId ?? undefined,
    runnerType: api.runnerType as EngineStatusInfo['runnerType'],
    runnerHost: api.runnerHost ?? undefined,
    source: api.source as EngineStatusInfo['source'],
    dockerImage: api.dockerImage ?? undefined,
    dockerTag: api.dockerTag ?? undefined,
    isInstalled: api.isInstalled ?? undefined,
    parameters: api.parameters ?? undefined,
  }
}

/**
 * Transform API all engines status to domain AllEnginesStatus
 * Recursively transforms all nested engine status objects
 */
export function transformAllEnginesStatus(api: ApiAllEnginesStatus): AllEnginesStatus {
  return {
    success: api.success,
    tts: (api.tts ?? []).map(transformEngineStatusInfo),
    text: (api.text ?? []).map(transformEngineStatusInfo),
    stt: (api.stt ?? []).map(transformEngineStatusInfo),
    audio: (api.audio ?? []).map(transformEngineStatusInfo),
    hasTtsEngine: api.hasTtsEngine,
    hasTextEngine: api.hasTextEngine,
    hasSttEngine: api.hasSttEngine,
    hasAudioEngine: api.variantGroups !== undefined, // Derive from presence
    variantGroups: api.variantGroups
      ? Object.fromEntries(
          Object.entries(api.variantGroups).map(([key, engines]) => [
            key,
            engines.map(transformEngineStatusInfo),
          ])
        )
      : undefined,
  }
}

/**
 * Transform API Docker image variant to domain DockerImageVariant
 */
export function transformDockerImageVariant(api: ApiDockerImageVariant): DockerImageVariant {
  return {
    tag: api.tag,
    requiresGpu: api.requiresGpu,
  }
}

/**
 * Transform API Docker image info to domain DockerImageInfo
 * Narrows engineType string to EngineType union
 */
export function transformDockerImageInfo(api: ApiDockerImageInfo): DockerImageInfo {
  return {
    ...api,
    engineType: api.engineType as EngineType,
    tags: api.tags ?? [],
    supportedLanguages: api.supportedLanguages ?? [],
    models: api.models ?? [],
    variants: (api.variants ?? []).map(transformDockerImageVariant),
  }
}

/**
 * Transform API Docker catalog response to domain DockerCatalogResponse
 */
export function transformDockerCatalogResponse(api: ApiDockerCatalogResponse): DockerCatalogResponse {
  return {
    success: api.success,
    images: (api.images ?? []).map(transformDockerImageInfo),
  }
}

/**
 * Transform API Docker install response to domain DockerInstallResponse
 */
export function transformDockerInstallResponse(api: ApiDockerInstallResponse): DockerInstallResponse {
  return {
    success: api.success,
    variantId: api.variantId,
    message: api.message,
    isInstalled: api.isInstalled,
  }
}
