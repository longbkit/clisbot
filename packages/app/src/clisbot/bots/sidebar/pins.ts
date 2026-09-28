import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
export function togglePin(pins: ResourcePin[], pin: ResourcePin) {
  return pins.some((item) => pinKey(item) === pinKey(pin))
    ? pins.filter((item) => pinKey(item) !== pinKey(pin))
    : [...pins, pin];
}
export const useResourcePinsStore = create<{
  scopes: Record<string, ResourcePin[]>;
  toggle: (scope: string, pin: ResourcePin) => void;
}>()(
  persist(
    (set) => ({
      scopes: {},
      toggle: (scope, pin) =>
        set((state) => ({
          scopes: { ...state.scopes, [scope]: togglePin(state.scopes[scope] ?? [], pin) },
        })),
    }),
    {
      name: "fusion-sidebar-pins",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ scopes: z.record(z.string(), z.array(PinSchema)) }),
      ),
      partialize: (state) => ({ scopes: state.scopes }),
    },
  ),
);
const EMPTY: ResourcePin[] = [];
export function useResourcePins() {
  const scope = useResourcePrincipalScope();
  const pins = useResourcePinsStore((state) => state.scopes[scope] ?? EMPTY);
  const toggle = useResourcePinsStore((state) => state.toggle);
  return { pins, toggle: (pin: ResourcePin) => toggle(scope, pin) };
}
