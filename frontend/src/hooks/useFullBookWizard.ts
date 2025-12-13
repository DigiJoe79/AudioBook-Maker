import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { projectApi, ttsApi } from '../services/api'
import type { ImportExecuteResponse, MappingRules } from '../types'
import { DEFAULT_MAPPING_RULES } from '../types'
import { useAppStore } from '../store/appStore'
import { useUISettingsStore } from '../store/uiSettingsStore'
import { useTextEngineLanguages } from './useTextEngineLanguages'
import { useDefaultSpeaker } from './useSpeakersQuery'
import { useSnackbar } from './useSnackbar'
import { logger } from '../utils/logger'
import { translateBackendError } from '../utils/translateBackendError'

export type FullBookWizardStatus =
  | 'idle'
  | 'importing'
  | 'tts'
  | 'done'
  | 'error'

export interface FullBookWizardState {
  status: FullBookWizardStatus
  message: string
  isRunning: boolean
  lastProjectId: string | null
  lastProjectTitle: string | null
  lastChapterCount: number
}

/**
 * Small helper to detect EPUB files, mirroring useImportQuery logic.
 */
function isEpubFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.epub')
}

/**
 * One-click "Book → Audiobook" wizard:
 *
 * 1. Imports the book (Markdown or EPUB) as a new project.
 * 2. Applies DEFAULT_MAPPING_RULES for chapter detection.
 * 3. Uses the current default TTS engine / model / language / speaker.
 * 4. Starts TTS generation for every chapter in the new project.
 *
 * Export still uses the existing export workflow (Export view).
 */
export function useFullBookWizard() {
  const { t } = useTranslation()
  const { showSnackbar } = useSnackbar()


  const [state, setState] = useState<FullBookWizardState>({
    status: 'idle',
    message: '',
    isRunning: false,
    lastProjectId: null,
    lastProjectTitle: null,
    lastChapterCount: 0,
  })

  // Global TTS defaults from app store
  const getDefaultTtsEngine = useAppStore(
    (s) => s.getDefaultTtsEngine,
  )
  const getDefaultTtsModel = useAppStore(
    (s) => s.getDefaultTtsModel,
  )
  const getDefaultLanguage = useAppStore(
    (s) => s.getDefaultLanguage,
  )

  // UI / text language for import
  const uiLanguage = useUISettingsStore((s) => s.settings.uiLanguage)
  const { languages: textLanguages } = useTextEngineLanguages()

  // Default speaker
  const { data: defaultSpeaker } = useDefaultSpeaker()

  const resetState = useCallback(() => {
    setState({
      status: 'idle',
      message: '',
      isRunning: false,
      lastProjectId: null,
      lastProjectTitle: null,
      lastChapterCount: 0,
    })
  }, [])

  const runWizard = useCallback(
    async (file: File): Promise<ImportExecuteResponse> => {
      if (!file) {
        const msg = t('import.actions.noFileSelected', 'No file selected')
        showSnackbar(msg, { severity: 'error' })
        throw new Error(msg)
      }

      resetState()

      setState((prev) => ({
        ...prev,
        status: 'importing',
        isRunning: true,
        message:
          t('wizard.importingBook', 'Importing book and creating project...'),
      }))

      try {
        // 1) Import: mapping rules and language
        const mappingRules: MappingRules = DEFAULT_MAPPING_RULES

        let textLanguage = uiLanguage || 'en'
        if (textLanguages && textLanguages.length > 0) {
          if (uiLanguage && textLanguages.includes(uiLanguage)) {
            textLanguage = uiLanguage
          } else {
            textLanguage = textLanguages[0]
          }
        }

        // 2) TTS defaults (engine / model / language / speaker)
        const defaultEngine = getDefaultTtsEngine()
        const ttsEngine = defaultEngine || ''
        const ttsModelName =
          (ttsEngine && getDefaultTtsModel(ttsEngine)) || ''
        const ttsLanguage =
          (ttsEngine && getDefaultLanguage(ttsEngine)) ||
          textLanguage ||
          'en'
        const ttsSpeakerName = defaultSpeaker?.name ?? ''

        const mode: 'new' = 'new'
        const mergeTargetId: string | null = null
        const selectedChapters: string[] = []
        const renamedChapters: Record<string, string> = {}

        // 3) Execute import directly (no preview step, "new" mode imports all chapters)
        const importPromise = isEpubFile(file)
          ? projectApi.executeEpubImport(
              file,
              mappingRules,
              textLanguage,
              mode,
              mergeTargetId,
              selectedChapters,
              renamedChapters,
              {
                ttsEngine,
                ttsModelName,
                ttsLanguage,
                ttsSpeakerName,
              },
            )
          : projectApi.executeMarkdownImport(
              file,
              mappingRules,
              textLanguage,
              mode,
              mergeTargetId,
              selectedChapters,
              renamedChapters,
              {
                ttsEngine,
                ttsModelName,
                ttsLanguage,
                ttsSpeakerName,
              },
            )

        const importResult = (await importPromise) as ImportExecuteResponse

        const project = importResult.project
        const chapters = project.chapters || []
        const chapterCount = chapters.length

        setState((prev) => ({
          ...prev,
          lastProjectId: importResult.projectId,
          lastProjectTitle: project.title,
          lastChapterCount: chapterCount,
        }))

        if (chapterCount === 0) {
          const msg =
            t(
              'wizard.importedNoChapters',
              'Import completed but no chapters were created.',
            ) ||
            'Import completed but no chapters were created.'
          setState((prev) => ({
            ...prev,
            status: 'done',
            isRunning: false,
            message: msg,
          }))
          showSnackbar(msg, { severity: 'warning' })
          return importResult
        }

        // 4) Kick off TTS for every chapter
        setState((prev) => ({
          ...prev,
          status: 'tts',
          message:
            t(
              'wizard.generatingTts',
              'Starting text-to-speech jobs for all chapters...',
            ) ||
            'Starting text-to-speech jobs for all chapters...',
        }))

        for (let index = 0; index < chapters.length; index += 1) {
          const chapter = chapters[index]
          const displayIndex = index + 1

          const stepMsg =
            t('wizard.generatingChapter', {
              index: displayIndex,
              total: chapterCount,
              title: chapter.title,
            }) ||
            `Generating audio for chapter ${displayIndex}/${chapterCount}: ${chapter.title}`

          setState((prev) => ({
            ...prev,
            status: 'tts',
            message: stepMsg,
          }))

          try {
            await ttsApi.generateChapter({
              chapterId: chapter.id,
              forceRegenerate: false,
              overrideSegmentSettings: false,
            })
          } catch (err) {
            logger.error('Failed to start TTS for chapter', {
              error: err,
              chapterId: chapter.id,
            })

            // Non-fatal: keep going for other chapters, but show a warning
            const warnMsg =
              t('wizard.chapterTtsFailed', {
                defaultValue:
                  'Failed to start TTS for chapter "{{title}}". See logs for details.',
                title: chapter.title,
              }) ||
              `Failed to start TTS for chapter "${chapter.title}". See logs for details.`
            showSnackbar(warnMsg, { severity: 'warning' })
          }
        }

        const finalMsg =
          t(
            'wizard.completed',
            'Book imported and TTS jobs started for all chapters. You can monitor progress in the Jobs view and export audio when ready.',
          ) ||
          'Book imported and TTS jobs started for all chapters. You can monitor progress in the Jobs view and export audio when ready.'

        setState((prev) => ({
          ...prev,
          status: 'done',
          isRunning: false,
          message: finalMsg,
        }))

        showSnackbar(finalMsg, { severity: 'success' })

        return importResult
      } catch (error: any) {
        logger.error('Full-book wizard failed', { error })

        let friendlyMessage =
          t(
            'wizard.unknownError',
            'An error occurred while running the Book → Audiobook wizard.',
          ) ||
          'An error occurred while running the Book → Audiobook wizard.'

        if (error?.response?.data?.detail) {
          try {
            friendlyMessage = translateBackendError(
              error.response.data.detail,
              t,
            )
          } catch {
            // Fall back to generic message
          }
        } else if (error instanceof Error && error.message) {
          friendlyMessage = error.message
        }

        setState((prev) => ({
          ...prev,
          status: 'error',
          isRunning: false,
          message: friendlyMessage,
        }))

        showSnackbar(friendlyMessage, { severity: 'error' })
        throw error
      }
  }, [
    t,
    showSnackbar,
    uiLanguage,
    textLanguages,
    defaultSpeaker,
    getDefaultTtsEngine,
    getDefaultTtsModel,
    getDefaultLanguage,
    resetState,
  ],
)
  return {
    ...state,
    runWizard,
    resetWizard: resetState,
  }
}
