import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import { HubDeviceOfferSchema, type HubDeviceOffer } from "@clisbot/protocol/device-pairing-offer";
import { z } from "zod";
import { i18n } from "@/i18n/i18next";
import { isHubSwitchLocked } from "./hub-edit-lock";

const ProfileSchema = HubDeviceOfferSchema.omit({
  pairing: true,
  ownerSetupToken: true,
}).extend({
  label: z.string().min(1).max(80),
  entry: z.enum(["account", "pairing", "owner-setup"]).optional(),
  setupStatus: z.enum(["ready", "owner-required", "blocked"]).optional(),
});
export type HubProfile = z.infer<typeof ProfileSchema>;
const RegistrySchema = z.object({
  profiles: z.array(ProfileSchema).max(32),
  activeId: z.string().nullable(),
});
const STORAGE_KEY = "clisbot:device-hub-profiles:v1";
let snapshot: { profiles: HubProfile[]; activeId: string | null } = {
  profiles: [],
  activeId: null,
};
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();
let mutations = Promise.resolve();

export function loadHubProfiles(): Promise<void> {
  loaded ??= hydrateProfiles().catch((error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

export function useHubProfiles() {
  useEffect(() => {
    void loadHubProfiles().catch(() => undefined);
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function currentHubProfile(): HubProfile | null {
  return snapshot.profiles.find((profile) => profile.hubId === snapshot.activeId) ?? null;
}

export async function assertHubIdentity(offer: HubDeviceOffer): Promise<void> {
  await loadHubProfiles();
  if (isHubSwitchLocked() && snapshot.activeId !== offer.hubId)
    throw new Error(i18n.t("hub.connection.errors.saveOrCancel"));
  const existing = snapshot.profiles.find((profile) => profile.hubId === offer.hubId);
  if (existing && existing.publicKey !== offer.publicKey)
    throw new Error(i18n.t("hub.connection.errors.keyChangedPairing"));
}

function defaultHubLabel(offer: HubDeviceOffer): string {
  if (offer.origin) {
    const hostname = new URL(offer.origin).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return hostname.slice(0, 80);
  }
  const identity = offer.hubId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
  return `Hub · ${identity || "connection"}`;
}

export async function saveHubProfile(
  offer: HubDeviceOffer,
  label = defaultHubLabel(offer),
): Promise<void> {
  await mutate(() => {
    if (isHubSwitchLocked() && snapshot.activeId !== offer.hubId)
      throw new Error(i18n.t("hub.connection.errors.saveOrCancel"));
    const existing = snapshot.profiles.find((profile) => profile.hubId === offer.hubId);
    if (existing && existing.publicKey !== offer.publicKey)
      throw new Error(i18n.t("hub.connection.errors.keyChangedPairing"));
    const { pairing: _pairing, ownerSetupToken: _setup, ...connection } = offer;
    const profile = ProfileSchema.parse({
      ...existing,
      ...connection,
      label: existing?.label ?? label,
    });
    validateHubRoutes(profile);
    return {
      profiles: [...snapshot.profiles.filter((value) => value.hubId !== profile.hubId), profile],
      activeId: profile.hubId,
    };
  });
}

export function selectHubProfile(id: string): Promise<void> {
  return mutate(() => {
    if (isHubSwitchLocked() && snapshot.activeId !== id)
      throw new Error(i18n.t("hub.connection.errors.saveOrCancel"));
    if (!snapshot.profiles.some((profile) => profile.hubId === id))
      throw new Error(i18n.t("hub.connection.errors.unknownHub"));
    return { ...snapshot, activeId: id };
  });
}

/** Save public discovery separately from pairing. A profile grants no access. */
export function saveDiscoveredHub(profile: HubProfile): Promise<void> {
  return mutate(() => {
    if (isHubSwitchLocked() && snapshot.activeId !== profile.hubId)
      throw new Error(i18n.t("hub.connection.errors.saveOrCancel"));
    const existing = snapshot.profiles.find((value) => value.hubId === profile.hubId);
    if (existing && existing.publicKey !== profile.publicKey)
      throw new Error(i18n.t("hub.connection.errors.keyChangedConnect"));
    const next = ProfileSchema.parse({
      ...existing,
      ...profile,
      label: existing?.label ?? profile.label,
    });
    validateHubRoutes(next);
    return {
      profiles: [...snapshot.profiles.filter((value) => value.hubId !== next.hubId), next],
      activeId: next.hubId,
    };
  });
}

export function updateHubProfile(
  id: string,
  update: {
    label?: string;
    origin?: string | null;
    relay?: HubDeviceOffer["relay"] | null;
    entry?: HubProfile["entry"];
    setupStatus?: HubProfile["setupStatus"];
  },
): Promise<void> {
  return mutate(() => ({
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.hubId !== id) return profile;
      const next = ProfileSchema.parse({
        ...profile,
        ...update,
        origin: update.origin === null ? undefined : (update.origin ?? profile.origin),
        relay: update.relay === null ? undefined : (update.relay ?? profile.relay),
      });
      validateHubRoutes(next);
      return next;
    }),
  }));
}

function mutate(action: () => typeof snapshot): Promise<void> {
  const operation = applyMutation(mutations, action);
  mutations = operation;
  return operation;
}

export function validateHubRoutes(offer: HubDeviceOffer): void {
  if (!offer.origin && !offer.relay) throw new Error(i18n.t("hub.connection.errors.noRoute"));
  if (offer.relay)
    parseHubRelayUrl(`${offer.relay.useTls === false ? "ws" : "wss"}://${offer.relay.endpoint}`);
  if (!offer.origin) return;
  const url = new URL(offer.origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(i18n.t("hub.connection.errors.originRule"));
}

export function parseHubRelayUrl(input: string): HubDeviceOffer["relay"] | null {
  if (!input.trim()) return null;
  const url = new URL(input.trim());
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(i18n.t("hub.connection.errors.relayRule"));
  return { endpoint: url.host, useTls: url.protocol === "wss:" };
}

async function hydrateProfiles(): Promise<void> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (value) snapshot = RegistrySchema.parse(JSON.parse(value));
  for (const listener of listeners) listener();
}

async function applyMutation(
  previous: Promise<void>,
  action: () => typeof snapshot,
): Promise<void> {
  await previous.catch(() => undefined);
  await loadHubProfiles();
  const next = RegistrySchema.parse(action());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  snapshot = next;
  for (const listener of listeners) listener();
}
