/**
 * Settings Hooks
 *
 * React Query hooks for settings management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore, GlobalSettings } from '@store/appStore';
import {
  fetchSettings,
  updateSettings as updateSettingsApi,
  resetSettings as resetSettingsApi,
  fetchEngineSchema,
  fetchSegmentLimits
} from '@services/settingsApi';
import { queryKeys } from '@services/queryKeys';

// Valid settings categories (excluding removed tts/stt - now in engines.is_default)
type SettingsCategory = 'audio' | 'text' | 'quality' | 'languages' | 'engines';
type SettingsValue<K extends SettingsCategory> = GlobalSettings[K];

// Fetch all settings
export function useSettings() {
  const loadSettings = useAppStore((state) => state.loadSettings);

  return useQuery({
    queryKey: queryKeys.settings.all(),
    queryFn: async () => {
      const settings = await fetchSettings();
      loadSettings(settings);
      return settings;
    }
  });
}

// Update settings mutation
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const loadSettings = useAppStore((state) => state.loadSettings);

  return useMutation<
    void,
    Error,
    { category: SettingsCategory; value: SettingsValue<SettingsCategory> },
    { previousSettings: GlobalSettings | undefined }
  >({
    mutationFn: async ({ category, value }) => {
      await updateSettingsApi(category, value);
    },
    // Optimistic update: Update cache immediately before API call
    onMutate: async ({ category, value }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.settings.all() });

      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData<GlobalSettings>(queryKeys.settings.all());

      // Optimistically update the cache
      if (previousSettings) {
        const newSettings = {
          ...previousSettings,
          [category]: value
        };

        queryClient.setQueryData<GlobalSettings>(queryKeys.settings.all(), newSettings);

        // Also update the store immediately
        loadSettings(newSettings);
      }

      // Return context with previous value for rollback
      return { previousSettings };
    },
    // Rollback on error
    onError: (err, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData<GlobalSettings>(queryKeys.settings.all(), context.previousSettings);
        loadSettings(context.previousSettings);
      }
    },
    // Note: onSettled removed to avoid refetch race conditions
    // Caller should invalidate once after all mutations are complete
  });
}

// Reset settings mutation
export function useResetSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetSettingsApi,
    onSuccess: () => {
      // Invalidate query to refetch from backend
      // The query's queryFn will automatically call loadSettings() to update the store
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() });
    }
  });
}

// Fetch engine parameter schema
export function useEngineSchema(engine: string | null, engineType: string = 'tts') {
  return useQuery({
    queryKey: queryKeys.settings.engineSchema(engine || ''),
    queryFn: () => fetchEngineSchema(engine!, engineType),
    enabled: !!engine
  });
}

// Fetch segment limits for an engine
export function useSegmentLimits(engine: string | null) {
  return useQuery({
    queryKey: queryKeys.settings.segmentLimits(engine || ''),
    queryFn: () => fetchSegmentLimits(engine!),
    enabled: !!engine,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
