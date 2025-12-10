import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pronunciationApi } from '@services/api'
import { queryKeys } from '@services/queryKeys'
import type {
  PronunciationRule,
  PronunciationRuleCreate,
  PronunciationRuleUpdate,
  PronunciationBulkOperation
} from '@types'
import {
  transformPronunciationRule,
  type ApiPronunciationRule,
} from '@types'

// Query hooks
export const usePronunciationRules = (filters?: {
  engine?: string
  language?: string
  projectId?: string
  scope?: string
}) => {
  return useQuery({
    queryKey: queryKeys.pronunciation.list(filters || {}),
    queryFn: async () => {
      const response = await pronunciationApi.getRules(filters)
      return {
        ...response,
        rules: response.rules.map(transformPronunciationRule)
      }
    },
    staleTime: 30000 // 30 seconds
  })
}

export const usePronunciationRulesForContext = (
  engineName: string,
  language: string,
  projectId?: string
) => {
  return useQuery({
    queryKey: queryKeys.pronunciation.context(engineName, language, projectId),
    queryFn: async () => {
      const response = await pronunciationApi.getRulesForContext(engineName, language, projectId)
      return {
        ...response,
        rules: response.rules.map(transformPronunciationRule)
      }
    },
    enabled: !!engineName && !!language,
    staleTime: 30000
  })
}

export const usePronunciationConflicts = (
  engineName: string,
  language: string
) => {
  return useQuery({
    queryKey: queryKeys.pronunciation.conflicts(engineName, language),
    queryFn: () => pronunciationApi.getConflicts(engineName, language),
    enabled: !!engineName && !!language,
    staleTime: 60000 // 1 minute
  })
}

// Mutation hooks
export const useCreatePronunciationRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (rule: PronunciationRuleCreate) => {
      const apiRule = await pronunciationApi.createRule(rule)
      return transformPronunciationRule(apiRule)
    },
    onSuccess: (newRule) => {
      // Invalidate all pronunciation queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.all
      })

      // Show success message (if using toast)
      // toast.success('Pronunciation rule created')
    }
  })
}

export const useUpdatePronunciationRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      ruleId,
      update
    }: {
      ruleId: string
      update: PronunciationRuleUpdate
    }) => {
      const apiRule = await pronunciationApi.updateRule(ruleId, update)
      return transformPronunciationRule(apiRule)
    },
    onSuccess: (updatedRule) => {
      // Update the specific rule in cache
      queryClient.setQueryData(
        queryKeys.pronunciation.detail(updatedRule.id),
        updatedRule
      )

      // Invalidate lists
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.lists()
      })
    }
  })
}

export const useDeletePronunciationRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ruleId: string) => pronunciationApi.deleteRule(ruleId),
    onSuccess: (_, ruleId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: queryKeys.pronunciation.detail(ruleId)
      })

      // Invalidate lists
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.lists()
      })
    }
  })
}

export const useBulkPronunciationOperation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (operation: PronunciationBulkOperation) =>
      pronunciationApi.bulkOperation(operation),
    onSuccess: () => {
      // Invalidate all pronunciation queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.all
      })
    }
  })
}

export const useTogglePronunciationRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) => {
      const apiRule = await pronunciationApi.toggleRule(ruleId, isActive)
      return transformPronunciationRule(apiRule)
    },
    onSuccess: (updatedRule) => {
      // Optimistic update
      queryClient.setQueryData(
        queryKeys.pronunciation.detail(updatedRule.id),
        updatedRule
      )

      // Invalidate lists
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.lists()
      })
    }
  })
}

export const useImportPronunciationRules = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      rules,
      mode
    }: {
      rules: PronunciationRule[]
      mode: 'merge' | 'replace'
    }) => pronunciationApi.importRules(rules, mode),
    onSuccess: () => {
      // Invalidate all pronunciation queries to refetch updated data
      queryClient.invalidateQueries({
        queryKey: queryKeys.pronunciation.all
      })
    }
  })
}
