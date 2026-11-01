import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Starred models, kept on this device for every Host. A key is the picker row's
 * `provider:modelId`. Unrelated to the legacy `favoriteModels` form preference, which
 * migrated into Agent profiles and stays readable only for that migration.
 */
const STORAGE_KEY = "composer-model-favorites";

interface ModelFavoritesState {
  keys: string[];
  toggle: (key: string) => void;
}

const PersistedSchema = z.strictObject({ keys: z.array(z.string()) });

export function toggleFavoriteKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key];
}

export function favoriteModelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export function isFavoriteModel(keys: readonly string[], provider: string, modelId: string) {
  return keys.includes(favoriteModelKey(provider, modelId));
}

export const useModelFavoritesStore = create<ModelFavoritesState>()(
  persist(
    (set) => ({
      keys: [],
      toggle: (key) => set((state) => ({ keys: toggleFavoriteKey(state.keys, key) })),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ keys: state.keys }),
    },
  ),
);
