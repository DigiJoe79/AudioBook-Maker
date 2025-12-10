/**
 * React Query Hooks for Markdown Import
 *
 * These hooks handle markdown import preview with proper error handling
 * and integration with the project queries.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { projectApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type { MappingRules, ImportPreviewResponse, ImportExecuteResponse } from '@types'

function isEpubFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
  return ext === '.epub'
}

/**
 * Preview Markdown import
 *
 * Analyzes markdown file and returns structured preview of projects,
 * chapters, and segments before committing to the import.
 *
 * @example
 * ```tsx
 * const previewImport = usePreviewImport()
 *
 * const handleFileSelect = async (file: File) => {
 *   const preview = await previewImport.mutateAsync({
 *     file,
 *     mappingRules: {
 *       projectHeading: '#',
 *       chapterHeading: '###',
 *       dividerPattern: '***'
 *     },
 *     language: 'en'
 *   })
 *
 *   // Show preview dialog with warnings and chapter list
 *   if (!preview.isValid) {
 *     console.warn('Import has critical warnings:', preview.globalWarnings)
 *   }
 * }
 * ```
 */
export function usePreviewImport(): UseMutationResult<
  ImportPreviewResponse,
  Error,
  {
    file: File
    mappingRules?: MappingRules
    language?: string
  }
> {
  return useMutation({
    mutationFn: async ({ file, mappingRules, language = 'en' }) => {
      if (isEpubFile(file)) {
        return await projectApi.previewEpubImport(file, mappingRules, language)
      }
      return await projectApi.previewMarkdownImport(file, mappingRules, language)
    },
    // No cache invalidation needed - this is a read-only preview operation
  })
}

/**
 * Execute Markdown import
 *
 * Creates a new project or merges chapters into an existing project.
 * Invalidates project queries on success to trigger UI refresh.
 *
 * @example
 * ```tsx
 * const executeImport = useExecuteImport()
 *
 * const handleImport = async () => {
 *   const result = await executeImport.mutateAsync({
 *     file: selectedFile,
 *     mappingRules,
 *     language: 'en',
 *     mode: 'new',
 *     mergeTargetId: null,
 *     selectedChapters: ['ch-1', 'ch-2'],
 *     renamedChapters: { 'ch-1': 'New Title' },
 *     ttsSettings: {
 *       ttsEngine: 'xtts',
 *       ttsModelName: 'v2.0.2',
 *       language: 'en',
 *       ttsSpeakerName: 'default'
 *     }
 *   })
 *
 *   // Navigate to imported project
 *   navigateTo('main')
 * }
 * ```
 */
export function useExecuteImport(): UseMutationResult<
  ImportExecuteResponse,
  Error,
  {
    file: File
    mappingRules: MappingRules
    language: string
    mode: 'new' | 'merge'
    mergeTargetId: string | null
    selectedChapters: string[]
    renamedChapters: Record<string, string>
    ttsSettings: {
      ttsEngine: string
      ttsModelName: string
      language: string
      ttsSpeakerName?: string
    }
  }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      file,
      mappingRules,
      language,
      mode,
      mergeTargetId,
      selectedChapters,
      renamedChapters,
      ttsSettings,
    }) => {
      return await projectApi.executeMarkdownImport(
        file,
        mappingRules,
        language,
        mode,
        mergeTargetId,
        selectedChapters,
        renamedChapters,
        ttsSettings
      )
    },
    onSuccess: (data) => {
      // Invalidate projects list query to show new/updated project
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })

      // Invalidate the specific project query to refresh its data
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(data.project.id) })
    },
  })
}
