import { useEffect, useRef } from "react";
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHasHydratedWorkspaces } from "@/stores/session-store-hooks";
import { HOME_V2_ENABLED } from "./feature";
import { applyLaunch, defaultStartLaunch, type StartComposer } from "./start-template";
import type { StartKind } from "./start-kinds";

/** Agents most people start with; any other ready agent follows in the Host's order. */
const PREFERRED = ["claude", "codex", "opencode", "copilot"];

/** The agent a first chat uses when nobody has chosen one yet. */
export function firstReadyProvider(entries: readonly ProviderSnapshotEntry[]): string | null {
  const ready = entries.filter((entry) => entry.enabled !== false && entry.status === "ready");
  const preferred = PREFERRED.find((id) => ready.some((entry) => entry.provider === id));
  return preferred ?? ready[0]?.provider ?? null;
}

/** The launch to fill in: the saved agent when this Host has it ready, else the first ready one. */
export function startingLaunch(
  preferences: FormPreferences,
  entries: readonly ProviderSnapshotEntry[],
  composer: StartComposer,
): BotLaunchDefaults | null {
  const ready = (id: string) =>
    entries.some(
      (entry) => entry.provider === id && entry.enabled !== false && entry.status === "ready",
    );
  if (preferences.provider && ready(preferences.provider))
    return defaultStartLaunch(preferences, composer);
  const provider = firstReadyProvider(entries);
  return provider ? { provider } : null;
}

/**
 * The shared composer picks no agent without a saved choice, and after a Host switch it can be
 * left with none. Home fills one in whenever the composer has no agent on the selected Host, so a
 * message can always be sent without a detour; it never replaces an agent already chosen.
 */
export function useFirstRunProvider(input: {
  focused: boolean;
  pending: boolean;
  serverId: string;
  composer: StartComposer | null;
  preferences: FormPreferences;
}) {
  const { focused, pending, serverId, composer, preferences } = input;
  const enabled = HOME_V2_ENABLED && focused && !pending;
  const { entries } = useProvidersSnapshot(serverId, { enabled: HOME_V2_ENABLED && focused });
  const selected = composer?.selectedProvider;
  // One attempt per Host and agent: an agent the composer cannot take must not loop.
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    // An agent applied while the composer still loads this Host's models is dropped.
    if (!enabled || !composer || !entries || selected || composer.isAllModelsLoading) return;
    const launch = startingLaunch(preferences, entries, composer);
    if (!launch) return;
    const key = `${serverId}:${launch.provider}`;
    if (attempted.current === key) return;
    attempted.current = key;
    applyLaunch(composer, launch);
  }, [enabled, serverId, composer, selected, preferences, entries, composer?.isAllModelsLoading]);
}

/**
 * With no ordinary project on the Host yet, Home opens on Quick chat so the first message can be
 * sent at once. Only after the Host's workspaces loaded, so a slow project list never flips it, and
 * only while the mode is the remembered one rather than a choice made on this screen.
 */
export function useQuickChatByDefault(input: {
  focused: boolean;
  inferred: boolean;
  supported: boolean;
  serverId: string;
  kind: StartKind;
  hasOrdinaryProject: boolean;
  prepare: () => Promise<void>;
}) {
  const defaulted = useRef<string | null>(null);
  // Projects come from the Host's workspaces; before they arrive the list is empty, not absent.
  const loaded = useHasHydratedWorkspaces(input.serverId);
  const { focused, inferred, supported, serverId, kind, hasOrdinaryProject, prepare } = input;
  const ready = HOME_V2_ENABLED && focused && inferred && supported && loaded;
  useEffect(() => {
    if (!ready || hasOrdinaryProject || kind !== "project") return;
    if (defaulted.current === serverId) return;
    defaulted.current = serverId;
    void prepare();
  }, [ready, hasOrdinaryProject, kind, serverId, prepare]);
}
