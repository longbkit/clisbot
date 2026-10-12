import { useEffect, useRef } from "react";
import { useHasHydratedWorkspaces } from "@/stores/session-store-hooks";
import { HOME_V2_ENABLED } from "./feature";
import type { StartKind } from "./start-kinds";

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
