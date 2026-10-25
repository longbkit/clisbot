import { useEffect, useRef } from "react";
import type { StartKind } from "@/clisbot/home/start-kinds";
import { NAVIGATION_V2_ENABLED } from "./feature";
import type { HomeMode } from "./home-feed";
import { useNavigationStore } from "./store";

export interface ModeTargets {
  /** The Bot last chosen while Home was in Chat mode. */
  bot?: string;
  /** What Work mode last started in. */
  work?: "project" | "quickChat";
}

export type ModeTargetChange =
  | { kind: "bot"; botId?: string }
  | { kind: "project"; botId?: undefined }
  | { kind: "quickChat"; botId?: undefined }
  | null;

/**
 * Where the composer should point after Home switches mode (brief C13): Chat mode starts with a
 * Bot, Work mode with a project or Quick chat, each mode returning to its own last choice. Hybrid
 * keeps whatever is selected. The draft is one per screen, so it is never touched.
 */
export function modeTargetChange(
  mode: HomeMode,
  current: StartKind,
  remembered: ModeTargets,
): ModeTargetChange {
  if (mode === "chat" && current !== "bot") return { kind: "bot", botId: remembered.bot };
  if (mode === "work" && current === "bot") return { kind: remembered.work ?? "project" };
  return null;
}

/** Which starts Home's switcher offers in a mode (Atlas F5): the mode and the switcher agree. */
export function modeStartKinds(mode: HomeMode): {
  quickChat: boolean;
  project: boolean;
  bot: boolean;
} {
  if (mode === "chat") return { quickChat: false, project: false, bot: true };
  if (mode === "work") return { quickChat: true, project: true, bot: false };
  return { quickChat: true, project: true, bot: true };
}

/**
 * The start switcher's props on Home in Navigation V2: the mode's starts, and icon-only unselected
 * segments on a phone. New workspace and the Home V2 Home offer every start as before.
 */
export function useHomeStartSwitcher(input: {
  home: boolean;
  compact: boolean;
  quickChat: boolean;
}) {
  const mode = useNavigationStore((state) => state.homeMode);
  const v2 = NAVIGATION_V2_ENABLED && input.home;
  const kinds = modeStartKinds(v2 ? mode : "hybrid");
  return {
    quickChat: input.quickChat && kinds.quickChat,
    project: kinds.project,
    bot: kinds.bot,
    compactSegments: v2 && input.compact,
  };
}

/** Home's composer follows the mode switch; New workspace and the Home V2 Home do not. */
export function useHomeModeStartTarget(input: {
  home: boolean;
  focused: boolean;
  serverId: string;
  startKind: StartKind;
  selectedBot: { id: string } | undefined;
  setStartTarget: (target: { host: string; kind: StartKind; botId?: string }) => void;
  prepareQuickChat: () => unknown;
}) {
  const { home, focused, serverId, startKind, setStartTarget, prepareQuickChat } = input;
  const botId = input.selectedBot?.id;
  const mode = useNavigationStore((state) => state.homeMode);
  const remembered = useRef<ModeTargets>({});
  const previousMode = useRef(mode);
  useEffect(() => {
    if (startKind === "bot") remembered.current.bot = botId ?? remembered.current.bot;
    else remembered.current.work = startKind;
  }, [botId, startKind]);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    if (!NAVIGATION_V2_ENABLED || !home || !focused) return;
    const change = modeTargetChange(mode, startKind, remembered.current);
    if (change?.kind === "quickChat") void prepareQuickChat();
    else if (change) setStartTarget({ host: serverId, kind: change.kind, botId: change.botId });
    // Only a mode switch moves the target; later picks within the mode are the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}
