/**
 * Translate structured error messages from backend
 *
 * Backend sends errors in format: [ERROR_CODE]param1:value1;param2:value2
 * This function parses the code and parameters, then translates using i18n
 *
 * Example:
 *   Input:  "[IMPORT_NO_CHAPTERS]projectHeading:#;chapterHeading:##"
 *   Output: "Keine Kapitel gefunden. Es wird mindestens eine ##-Überschrift..."
 *
 * This is the standard way to handle backend error messages that need translation.
 */

import { TFunction } from 'i18next'

interface ParsedError {
  code: string
  params: Record<string, string>
}

interface ErrorCodeMapping {
  key: string
  paramMap: Record<string, string>
}

/**
 * Parse error message with format [CODE]param1:value1;param2:value2
 */
function parseErrorMessage(message: string): ParsedError | null {
  const match = message.match(/^\[([A-Z_]+)\](.*)$/)

  if (!match) {
    return null
  }

  const code = match[1]
  const paramsString = match[2]
  const params: Record<string, string> = {}

  if (paramsString) {
    const paramPairs = paramsString.split(';')
    for (const pair of paramPairs) {
      const [key, value] = pair.split(':')
      if (key && value) {
        params[key.trim()] = value.trim()
      }
    }
  }

  return { code, params }
}

/**
 * Translate backend error message using i18n
 *
 * @param errorMessage - Error message from backend (may contain error code)
 * @param t - i18n translation function
 * @returns Translated error message
 */
export function translateBackendError(errorMessage: string, t: TFunction): string {
  const parsed = parseErrorMessage(errorMessage)

  if (!parsed) {
    // No error code found - return original message
    return errorMessage
  }

  // Map error codes to i18n keys
  const errorCodeMap: Record<string, string> = {
    // Import errors
    IMPORT_NO_PROJECT_TITLE: 'import.errors.noProjectTitle',
    IMPORT_NO_CHAPTERS: 'import.errors.noChapters',
    IMPORT_CHAPTER_TOO_LONG: 'import.errors.chapterTooLong',
    IMPORT_FILE_EMPTY: 'import.errors.fileEmpty',
    IMPORT_PROJECT_NOT_FOUND: 'import.errors.projectNotFound',
    IMPORT_SEGMENTATION_FAILED: 'import.errors.segmentationFailed',
    IMPORT_INTERNAL_ERROR: 'errors.import.internalError',
    IMPORT_INVALID_MAPPING_JSON: 'errors.import.invalidMappingJson',
    IMPORT_INVALID_CHAPTERS_JSON: 'errors.import.invalidChaptersJson',
    IMPORT_INVALID_RENAMED_JSON: 'errors.import.invalidRenamedJson',
    IMPORT_INVALID_MODE: 'errors.import.invalidMode',
    IMPORT_MISSING_TARGET_ID: 'errors.import.missingTargetId',
    IMPORT_UNKNOWN_ENGINE: 'errors.import.unknownEngine',
    IMPORT_PREVIEW_FAILED: 'import.errors.previewFailed',
    IMPORT_FAILED: 'import.errors.failed',

    // Speaker errors
    SPEAKER_NOT_FOUND: 'speakers.errors.notFound',
    SPEAKER_INVALID_GENDER: 'speakers.errors.invalidGender',
    SPEAKER_INVALID_FILE_TYPE: 'speakers.errors.invalidFileType',
    SPEAKER_SAMPLE_NOT_FOUND: 'speakers.errors.sampleNotFound',
    SPEAKER_SAMPLE_FILE_NOT_FOUND: 'speakers.errors.sampleFileNotFound',
    SPEAKER_LIST_FAILED: 'speakers.errors.listFailed',
    SPEAKER_CREATE_FAILED: 'speakers.errors.createFailed',
    SPEAKER_GET_FAILED: 'speakers.errors.getFailed',
    SPEAKER_UPDATE_FAILED: 'speakers.errors.updateFailed',
    SPEAKER_SET_DEFAULT_FAILED: 'speakers.errors.setDefaultFailed',
    SPEAKER_GET_DEFAULT_FAILED: 'speakers.errors.getDefaultFailed',
    SPEAKER_DELETE_FAILED: 'speakers.errors.deleteFailed',
    SPEAKER_SAMPLE_ADD_FAILED: 'speakers.errors.sampleAddFailed',
    SPEAKER_SAMPLE_GET_FAILED: 'speakers.errors.sampleGetFailed',
    SPEAKER_SAMPLE_DELETE_FAILED: 'speakers.errors.sampleDeleteFailed',

    // Segment errors
    SEGMENT_NOT_FOUND: 'segments.errors.notFound',
    TARGET_CHAPTER_NOT_FOUND: 'segments.errors.targetChapterNotFound',
    SEGMENT_CHAPTER_MISMATCH: 'segments.errors.chapterMismatch',
    SEGMENT_CREATE_FAILED: 'segments.errors.createFailed',
    SEGMENT_GET_FAILED: 'segments.errors.getFailed',
    SEGMENT_UPDATE_FAILED: 'segments.errors.updateFailed',
    SEGMENT_DELETE_FAILED: 'segments.errors.deleteFailed',
    SEGMENT_REORDER_FAILED: 'segments.errors.reorderFailed',
    SEGMENT_MOVE_FAILED: 'segments.errors.moveFailed',
    SEGMENT_FREEZE_FAILED: 'segments.errors.freezeFailed',

    // Chapter errors
    CHAPTER_NOT_FOUND: 'chapters.errors.notFound',
    TARGET_PROJECT_NOT_FOUND: 'chapters.errors.targetProjectNotFound',
    CHAPTER_UNKNOWN_ENGINE: 'chapters.errors.unknownEngine',
    CHAPTER_ENGINE_CONSTRAINTS_FAILED: 'chapters.errors.constraintsFailed',
    CHAPTER_PROJECT_MISMATCH: 'chapters.errors.projectMismatch',
    CHAPTER_CREATE_FAILED: 'chapters.errors.createFailed',
    CHAPTER_GET_FAILED: 'chapters.errors.getFailed',
    CHAPTER_UPDATE_FAILED: 'chapters.errors.updateFailed',
    CHAPTER_DELETE_FAILED: 'chapters.errors.deleteFailed',
    CHAPTER_REORDER_FAILED: 'chapters.errors.reorderFailed',
    CHAPTER_MOVE_FAILED: 'chapters.errors.moveFailed',

    // Project errors
    PROJECT_NOT_FOUND: 'projects.errors.notFound',
    PROJECT_LIST_FAILED: 'projects.errors.listFailed',
    PROJECT_GET_FAILED: 'projects.errors.getFailed',
    PROJECT_CREATE_FAILED: 'projects.errors.createFailed',
    PROJECT_UPDATE_FAILED: 'projects.errors.updateFailed',
    PROJECT_DELETE_FAILED: 'projects.errors.deleteFailed',
    PROJECT_REORDER_FAILED: 'projects.errors.reorderFailed',

    // Text processing errors
    TEXT_SEGMENTATION_FAILED: 'text.errors.segmentationFailed',
    TEXT_SEGMENTER_LOAD_FAILED: 'text.errors.segmenterLoadFailed',
    TEXT_INVALID_METHOD: 'text.errors.invalidMethod',
    TEXT_NO_ENGINE_AVAILABLE: 'text.errors.noEngineAvailable',
    TEXT_ENGINE_NOT_FOUND: 'text.errors.engineNotFound',

    // Health errors
    HEALTH_CHECK_FAILED: 'health.errors.checkFailed',

    // Export errors
    EXPORT_CHAPTER_NOT_FOUND: 'export.errors.chapterNotFound',
    EXPORT_PROJECT_NOT_FOUND: 'export.errors.projectNotFound',
    EXPORT_NO_SEGMENTS: 'export.errors.noSegments',
    EXPORT_JOB_NOT_FOUND: 'export.errors.jobNotFound',
    EXPORT_FILE_NOT_FOUND: 'export.errors.fileNotFound',
    EXPORT_FILE_DELETED: 'export.errors.fileDeleted',
    EXPORT_AUDIO_FILE_NOT_FOUND: 'export.errors.audioFileNotFound',
    EXPORT_INVALID_PATH: 'export.errors.invalidPath',
    EXPORT_NOT_A_FILE: 'export.errors.notAFile',
    EXPORT_NO_SEGMENTS_FOUND: 'export.errors.noSegmentsFound',
    EXPORT_INCOMPLETE_SEGMENTS: 'export.errors.incompleteSegments',
    EXPORT_NOT_READY: 'export.errors.notReady',
    EXPORT_START_FAILED: 'export.errors.startFailed',
    EXPORT_PROGRESS_QUERY_FAILED: 'export.errors.progressQueryFailed',
    EXPORT_CANCEL_FAILED: 'export.errors.cancelFailed',
    EXPORT_DOWNLOAD_FAILED: 'export.errors.downloadFailed',
    EXPORT_DELETE_FAILED: 'export.errors.deleteFailed',
    AUDIO_MERGE_FAILED: 'export.errors.mergeFailed',
    AUDIO_DURATION_FAILED: 'export.errors.durationFailed',

    // STT errors
    STT_SEGMENT_NOT_FOUND: 'stt.errors.segmentNotFound',
    STT_CHAPTER_NOT_FOUND: 'stt.errors.chapterNotFound',
    STT_JOB_NOT_FOUND: 'stt.errors.jobNotFound',
    STT_JOB_DELETE_FAILED: 'stt.errors.jobDeleteFailed',
    STT_NO_ENGINE_AVAILABLE: 'stt.errors.noEngineAvailable',

    // TTS Job errors
    TTS_SEGMENT_NOT_FOUND: 'tts.errors.segmentNotFound',
    TTS_JOB_NOT_FOUND: 'tts.errors.jobNotFound',
    TTS_JOB_OPERATION_FAILED: 'tts.errors.jobOperationFailed',
    TTS_SEGMENT_FROZEN: 'tts.errors.segmentFrozen',
    TTS_MISSING_PARAMETERS: 'tts.errors.missingParameters',
    TTS_JOB_LIST_FAILED: 'tts.errors.jobListFailed',
    TTS_JOB_ACTIVE_LIST_FAILED: 'tts.errors.activeJobListFailed',
    TTS_JOB_GET_FAILED: 'tts.errors.jobGetFailed',
    TTS_JOB_CLEANUP_FAILED: 'tts.errors.jobCleanupFailed',
    TTS_JOB_DELETE_FAILED: 'tts.errors.jobDeleteFailed',
    TTS_JOB_CANCEL_FAILED: 'tts.errors.jobCancelFailed',
    TTS_JOB_RESUME_FAILED: 'tts.errors.jobResumeFailed',
    TTS_GENERATION_FAILED: 'tts.errors.generationFailed',
    TTS_GPU_OOM: 'tts.errors.gpuOom',

    // Quality Job errors
    QUALITY_JOB_LIST_FAILED: 'errors.quality.jobListFailed',
    QUALITY_JOB_ACTIVE_LIST_FAILED: 'errors.quality.activeJobListFailed',
    QUALITY_JOB_GET_FAILED: 'errors.quality.jobGetFailed',
    QUALITY_JOB_NOT_FOUND: 'errors.quality.jobNotFound',
    QUALITY_JOB_INVALID_STATE: 'errors.quality.jobInvalidState',
    QUALITY_JOB_CANCEL_FAILED: 'errors.quality.jobCancelFailed',
    QUALITY_JOB_CLEANUP_FAILED: 'errors.quality.jobCleanupFailed',
    QUALITY_JOB_RESUME_FAILED: 'errors.quality.jobResumeFailed',
    QUALITY_JOB_DELETE_FAILED: 'errors.quality.jobDeleteFailed',
    QUALITY_JOB_CREATE_FAILED: 'errors.quality.jobCreateFailed',
    QUALITY_NO_AUDIO: 'errors.quality.noAudio',
    QUALITY_SEGMENT_FROZEN: 'errors.quality.segmentFrozen',
    QUALITY_NO_ENGINES: 'errors.quality.noEngines',
    QUALITY_NO_SEGMENTS: 'errors.quality.noSegments',
    QUALITY_JOB_IN_PROGRESS: 'errors.quality.jobInProgress',

    // Pronunciation errors
    PRONUNCIATION_RULE_NOT_FOUND: 'pronunciation.errors.ruleNotFound',
    PRONUNCIATION_DELETE_FAILED: 'pronunciation.errors.deleteFailed',
    PRONUNCIATION_SEGMENT_NOT_FOUND: 'pronunciation.errors.segmentNotFound',
    PRONUNCIATION_MISSING_PARAMS: 'pronunciation.errors.missingParams',
    PRONUNCIATION_RULE_CREATE_FAILED: 'pronunciation.errors.createFailed',
    PRONUNCIATION_RULES_GET_FAILED: 'pronunciation.errors.getFailed',
    PRONUNCIATION_RULE_UPDATE_FAILED: 'pronunciation.errors.updateFailed',
    PRONUNCIATION_RULE_DELETE_FAILED: 'pronunciation.errors.ruleDeleteFailed',
    PRONUNCIATION_TEST_FAILED: 'pronunciation.errors.testFailed',
    PRONUNCIATION_CONFLICTS_FAILED: 'pronunciation.errors.conflictsFailed',
    PRONUNCIATION_BULK_OPERATION_FAILED: 'pronunciation.errors.bulkOperationFailed',
    PRONUNCIATION_RULES_EXPORT_FAILED: 'pronunciation.errors.exportFailed',
    PRONUNCIATION_RULES_IMPORT_FAILED: 'pronunciation.errors.importFailed',
    PRONUNCIATION_TEST_AUDIO_FAILED: 'pronunciation.errors.testAudioFailed',

    // Settings errors
    SETTINGS_KEY_NOT_FOUND: 'settings.errors.keyNotFound',
    SETTINGS_ENGINE_NOT_FOUND: 'settings.errors.engineNotFound',
    SETTINGS_UPDATE_FAILED: 'settings.errors.updateFailed',
    SETTINGS_GET_FAILED: 'settings.errors.getFailed',
    SETTINGS_RESET_FAILED: 'settings.errors.resetFailed',
    SETTINGS_GET_SEGMENT_LIMITS_FAILED: 'settings.errors.segmentLimitsFailed',
    SETTINGS_INVALID_ENGINE_TYPE: 'settings.errors.invalidEngineType',
    SETTINGS_GET_SCHEMA_FAILED: 'settings.errors.schemaFailed',

    // Engine errors
    ENGINE_ENABLE_FAILED: 'errors.engine.enableFailed',
    ENGINE_DISABLE_FAILED: 'errors.engine.disableFailed',
    ENGINE_START_DISABLED: 'errors.engine.startDisabled',
    ENGINE_NOT_FOUND: 'errors.engine.notFound',
    ENGINE_NO_MODEL: 'errors.engine.noModel',
    ENGINE_START_FAILED: 'errors.engine.startFailed',
    ENGINE_STOP_FAILED: 'errors.engine.stopFailed',
    ENGINE_INVALID_TYPE: 'errors.engine.invalidType',
    ENGINE_STATUS_FAILED: 'errors.engine.statusFailed',
    ENGINE_SET_DEFAULT_FAILED: 'errors.engine.setDefaultFailed',
    ENGINE_CLEAR_DEFAULT_FAILED: 'errors.engine.clearDefaultFailed',
    ENGINE_KEEP_RUNNING_FAILED: 'errors.engine.keepRunningFailed',

    // Job errors (generic job management)
    JOB_NOT_CANCELLED: 'errors.job.notCancelled',
    JOB_NOT_FOUND: 'errors.job.notFound',
    JOB_CANNOT_CANCEL: 'errors.job.cannotCancel',
    JOB_NOT_RUNNING: 'errors.job.notRunning',
    JOB_DELETE_FAILED: 'errors.job.deleteFailed',
  }

  const i18nKey = errorCodeMap[parsed.code]

  if (!i18nKey) {
    // Unknown error code - return original message
    return errorMessage
  }

  // Translate with parameters
  return t(i18nKey, parsed.params)
}
