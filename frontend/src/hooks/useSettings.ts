
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore, GlobalSettings } from '../store/appStore';
import {
  fetchSettings,
  updateSettings as updateSettingsApi,
  resetSettings as resetSettingsApi,
  fetchEngineSchema,
  fetchSegmentLimits
} from '../services/settingsApi';

type SettingsCategory = 'tts' | 'audio' | 'text';
type SettingsValue<K extends SettingsCategory> = GlobalSettings[K];

const SETTINGS_KEY = ['settings'];
const ENGINE_SCHEMA_KEY = (engine: string) => ['engine-schema', engine];

export function useSettings() {
  const loadSettings = useAppStore((state) => state.loadSettings);

  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const settings = await fetchSettings();
      loadSettings(settings);
      return settings;
    }
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const updateSettings = useAppStore((state) => state.updateSettings);

  return useMutation<
    void,
    Error,
    { category: SettingsCategory; value: SettingsValue<SettingsCategory> }
  >({
    mutationFn: async ({ category, value }) => {
      await updateSettingsApi(category, value);
    },
    onSuccess: (_, variables) => {
      updateSettings(variables.category as keyof GlobalSettings, variables.value);
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    }
  });
}

export function useResetSettings() {
  const queryClient = useQueryClient();
  const resetSettings = useAppStore((state) => state.resetSettings);

  return useMutation({
    mutationFn: resetSettingsApi,
    onSuccess: () => {
      resetSettings();
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    }
  });
}

export function useEngineSchema(engine: string | null) {
  return useQuery({
    queryKey: ENGINE_SCHEMA_KEY(engine || ''),
    queryFn: () => fetchEngineSchema(engine!),
    enabled: !!engine
  });
}

export function useSegmentLimits(engine: string | null) {
  return useQuery({
    queryKey: ['segment-limits', engine],
    queryFn: () => fetchSegmentLimits(engine!),
    enabled: !!engine,
    staleTime: 5 * 60 * 1000,
  });
}
