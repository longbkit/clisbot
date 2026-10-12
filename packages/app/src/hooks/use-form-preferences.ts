import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FORM_PREFERENCES,
  mergeProviderPreferences,
  type FormPreferences,
  type ProviderPreferences,
} from "@/create-agent-preferences/preferences";
import {
  getCreateAgentPreferencesService,
  type FormPreferenceUpdate,
} from "@/create-agent-preferences/service";

const FORM_PREFERENCES_QUERY_KEY = ["form-preferences"];

export type { FormPreferences, ProviderPreferences };

export { mergeProviderPreferences };

export interface UseFormPreferencesReturn {
  preferences: FormPreferences;
  isLoading: boolean;
  updatePreferences: (updates: FormPreferenceUpdate) => Promise<FormPreferences>;
}

export function useFormPreferences(serverId?: string | null): UseFormPreferencesReturn {
  const queryClient = useQueryClient();
  const service = getCreateAgentPreferencesService(serverId);
  const queryKey = useMemo(
    () => (serverId ? [...FORM_PREFERENCES_QUERY_KEY, serverId] : FORM_PREFERENCES_QUERY_KEY),
    [serverId],
  );
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => service.load(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const preferences = data ?? DEFAULT_FORM_PREFERENCES;

  const updatePreferences = useCallback(
    async (updates: FormPreferenceUpdate) => {
      const next = await service.update(updates);
      queryClient.setQueryData<FormPreferences>(queryKey, next);
      return next;
    },
    [queryClient, queryKey, service],
  );

  return {
    preferences,
    isLoading: isPending,
    updatePreferences,
  };
}
