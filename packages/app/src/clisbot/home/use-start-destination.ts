import { useState, useEffect } from "react";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { botsSessionScope } from "@/clisbot/bots/data/session-scope";
import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";
import {
  getHostProjectId,
  hostProjectFromRoute,
  type HostProjectListItem,
} from "@/projects/host-projects";
import { HOME_V2_ENABLED } from "./feature";
import type { StartKind } from "./start-kinds";
import { isQuickChatPath, useQuickChatRoot } from "@/clisbot/quick-chats/quick-chat-projects";
export type { StartKind } from "./start-kinds";
interface Input {
  selectedServerId: string;
  pickedProject: HostProjectListItem | null;
  pickedDirectory: string | null;
  pickedOptionId: string;
  pickedLabel: string;
}
export function useStartDestination(input: Input) {
  const { selectedServerId } = input;
  const [startTarget, setStartTarget] = useState<{
    host: string;
    kind: StartKind;
    botId?: string;
  } | null>(null);
  const [quickProject, setQuickProject] = useState<{
    host: string;
    projectId: string;
    cwd: string;
  } | null>(null);
  const active = startTarget?.host === selectedServerId ? startTarget : null;
  const botFeature = useHostFeature(selectedServerId, "bots");
  const quickStartsFeature = useHostFeature(selectedServerId, "quickStarts");
  const principal = useResourcePrincipalScope();
  const client = useHostRuntimeClient(selectedServerId);
  const connected = useHostRuntimeIsConnected(selectedServerId);
  const admission = botsSessionScope(getHostRuntimeStore().getSnapshot(selectedServerId));
  const botQuery = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 10_000,
    queryKey: ["home-bots", selectedServerId, principal, admission],
    enabled: HOME_V2_ENABLED && botFeature && connected,
    queryFn: async () => {
      if (!client) throw new Error("Host offline");
      const result = await client.listBots();
      if (result.error) throw new Error(result.error);
      return result.bots.filter((bot) => !bot.archivedAt);
    },
  });
  const { refetch } = botQuery;
  useEffect(() => {
    if (!HOME_V2_ENABLED || !botFeature || !client || !connected) return;
    const feed = client.observeEvents(["bot.updated"]);
    const refresh = () => {
      void refetch();
    };
    feed.subscribe({ snapshot: refresh, update: refresh });
    return () => {
      void feed.release().catch(() => undefined);
    };
  }, [botFeature, client, connected, refetch]);
  const bots = botQuery.data;
  const quickChatRoot = useQuickChatRoot(selectedServerId);
  const picked = classifyPicked(input, bots, quickChatRoot);
  // Without an explicit choice, the last-used destination decides the mode: a Bot's home
  // project reopens that Bot, the Quick chat folder reopens Quick chat.
  const startKind: StartKind = HOME_V2_ENABLED ? (active?.kind ?? picked.kind) : "project";
  const botId = active ? active.botId : picked.bot?.id;
  const selectedBot = startKind === "bot" ? bots?.find((bot) => bot.id === botId) : undefined;
  let quick: { projectId: string; cwd: string } | null = null;
  if (quickProject?.host === selectedServerId) quick = quickProject;
  else if (startKind === "quickChat") quick = picked.quick;
  const resolved = resolveDestination(input, startKind, selectedBot, quick, picked.kind);
  return {
    ...resolved,
    startKind,
    /** True while the mode comes from the remembered project rather than a choice made here. */
    inferredStart: HOME_V2_ENABLED && !active,
    selectedBot,
    setStartTarget,
    setQuickProject,
    botQuery,
    quickStartsFeature,
  };
}
/** Which start mode the picker's remembered project belongs to. */
function classifyPicked(
  input: Input,
  bots: { id: string; projectId: string }[] | undefined,
  quickChatRoot: string | null,
): {
  kind: StartKind;
  bot?: { id: string };
  quick: { projectId: string; cwd: string } | null;
} {
  const projectId = input.pickedProject
    ? getHostProjectId(input.pickedProject, input.selectedServerId)
    : null;
  const bot = projectId ? bots?.find((entry) => entry.projectId === projectId) : undefined;
  if (bot) return { kind: "bot", bot, quick: null };
  if (projectId && input.pickedDirectory && isQuickChatPath(input.pickedDirectory, quickChatRoot))
    return { kind: "quickChat", quick: { projectId, cwd: input.pickedDirectory } };
  return { kind: "project", quick: null };
}
function resolveDestination(
  input: Input,
  kind: StartKind,
  bot: { id: string; projectId: string; cwd: string; name: string } | undefined,
  quick: { projectId: string; cwd: string } | null,
  pickedKind: StartKind,
) {
  // "In a project" never runs in a Bot's home or the Quick chat folder; it asks for a project.
  if (kind === "project" && pickedKind !== "project")
    return {
      selectedProject: null,
      selectedSourceDirectory: null,
      selectedProjectOptionId: "",
      projectTriggerLabel: "Choose project",
    };
  if (kind === "project")
    return {
      selectedProject: input.pickedProject,
      selectedSourceDirectory: input.pickedDirectory,
      selectedProjectOptionId: input.pickedOptionId,
      projectTriggerLabel: input.pickedLabel,
    };
  const target = kind === "bot" ? bot : quick;
  const label = kind === "bot" ? (bot?.name ?? "Choose bot") : "Quick chat · no project";
  return {
    selectedProject: target
      ? hostProjectFromRoute({
          serverId: input.selectedServerId,
          projectId: target.projectId,
          sourceDirectory: target.cwd,
          displayName: label,
        })
      : null,
    selectedSourceDirectory: target?.cwd ?? null,
    selectedProjectOptionId: kind === "bot" ? `bot:${bot?.id ?? ""}` : "quickChat",
    projectTriggerLabel: label,
  };
}
