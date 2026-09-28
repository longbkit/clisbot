import { useCallback, useMemo } from "react";
import { canonicalPin, normalizePins, type PinChat } from "./pin-identity";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { useResourcePrincipalScope } from "../data/resource-principal-scope";
const PinSchema = z.object({
  kind: z.enum(["bot", "chat", "project", "session"]),
  serverId: z.string(),
  id: z.string(),
});
export type ResourcePin = z.infer<typeof PinSchema>;
export function pinKey(pin: ResourcePin) {
  return `${pin.kind}:${pin.serverId}:${pin.id}`;
}
export function togglePin(pins: ResourcePin[], pin: ResourcePin, chats: readonly PinChat[] = []) {
  const normalized = normalizePins(pins, chats);
  const target = canonicalPin(pin, chats);
  return normalized.some((item) => pinKey(item) === pinKey(target))
    ? normalized.filter((item) => pinKey(item) !== pinKey(target))
    : [...normalized, target];
}
export function createResourcePinsStore(storage: StateStorage = AsyncStorage) {
  let hydrated = false;
  let readFailed = false;
  const pending: { scope: string; pin: ResourcePin; chats: readonly PinChat[] }[] = [];
  const store = create<{
    scopes: Record<string, ResourcePin[]>;
    toggle: (scope: string, pin: ResourcePin, chats?: readonly PinChat[]) => void;
  }>()(
    persist(
      (set) => ({
        scopes: {},
        toggle: (scope, pin, chats = []) => {
          // Do not persist an empty-derived scope before native storage has returned.
          if (!hydrated) {
            pending.push({ scope, pin, chats });
            if (readFailed) {
              readFailed = false;
              void store.persist.rehydrate();
            }
            return;
          }
          set((state) => ({
            scopes: { ...state.scopes, [scope]: togglePin(state.scopes[scope] ?? [], pin, chats) },
          }));
        },
      }),
      {
        name: "fusion-sidebar-pins",
        storage: createValidatedPersistStorage(
          storage,
          z.object({ scopes: z.record(z.string(), z.array(PinSchema)) }),
        ),
        partialize: (state) => ({ scopes: state.scopes }),
        onRehydrateStorage: () => {
          hydrated = false;
          readFailed = false;
          return (state, error) => {
            if (error) {
              // Preserve unread storage and pending intent; a later interaction retries once.
              readFailed = true;
              return;
            }
            if (!state) return;
            hydrated = true;
            for (const intent of pending.splice(0)) {
              state.toggle(intent.scope, intent.pin, intent.chats);
            }
          };
        },
      },
    ),
  );
  return store;
}
export const useResourcePinsStore = createResourcePinsStore();
const EMPTY: ResourcePin[] = [];
const EMPTY_CHATS: readonly PinChat[] = [];
export function useResourcePins(chats: readonly PinChat[] = EMPTY_CHATS) {
  const scope = useResourcePrincipalScope();
  const stored = useResourcePinsStore((state) => state.scopes[scope] ?? EMPTY);
  const update = useResourcePinsStore((state) => state.toggle);
  const pins = useMemo(() => normalizePins(stored, chats), [stored, chats]);
  const toggle = useCallback(
    (pin: ResourcePin) => update(scope, pin, chats),
    [scope, update, chats],
  );
  const isPinned = useCallback(
    (pin: ResourcePin) => {
      const key = pinKey(canonicalPin(pin, chats));
      return pins.some((item) => pinKey(item) === key);
    },
    [pins, chats],
  );
  return { pins, toggle, isPinned };
}
