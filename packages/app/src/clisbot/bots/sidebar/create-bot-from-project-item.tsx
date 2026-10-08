import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { botsRuntime } from "../data/runtime";
import { useBotsQuery } from "../data/use-bots";
import { useCreationRequest } from "./creation-request";

const ThemedBot = withUnistyles(Bot);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const BOT_ICON = <ThemedBot size={14} uniProps={mutedMapping} />;

/**
 * "Create bot from project" in a Project's or a workspace's menu: opens New bot with this
 * Project filled in, so the bot works in it and shares it instead of getting a new Project
 * (docs/features/bots-and-chats/README.md, "A bot from a Project"). Hidden on a Host that
 * cannot preview the template; turned off, with the bot named in its tooltip, on a Project that
 * already has a bot, since making another would only return it.
 */
export function CreateBotFromProjectMenuItem({
  serverId,
  projectId,
  workspaceId,
  surface = "dropdown",
  testID,
}: {
  serverId: string | null | undefined;
  projectId?: string | null;
  workspaceId?: string | null;
  surface?: "context" | "dropdown";
  testID: string;
}) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "botTemplatePreview");
  const workspace = useWorkspace(serverId ?? null, workspaceId ?? null);
  const resolvedProjectId = projectId ?? workspace?.projectId ?? null;
  const record = useSessionStore((state) =>
    serverId && resolvedProjectId
      ? state.sessions[serverId]?.projects?.get(resolvedProjectId)
      : undefined,
  );
  // A workspace carries its Project's name and root, for when the Project list has not arrived.
  const project = useMemo(() => {
    if (record) {
      return {
        projectId: record.projectId,
        name: record.projectCustomName ?? record.projectDisplayName,
        path: record.projectRootPath,
      };
    }
    if (!workspace || workspace.projectId !== resolvedProjectId) return null;
    return {
      projectId: workspace.projectId,
      name: workspace.projectCustomName ?? workspace.projectDisplayName,
      path: workspace.projectRootPath,
    };
  }, [record, resolvedProjectId, workspace]);
  const existingBot = useProjectBotName(supported ? serverId : null, resolvedProjectId);
  const ask = useCreationRequest((state) => state.ask);
  const handlers = useCreationRequest((state) => state.handlers);
  const open = useCallback(() => {
    if (!serverId || !project) return;
    ask("bot", {
      project: { serverId, ...project },
    });
  }, [ask, project, serverId]);
  if (!supported || !project || handlers === 0) return null;
  const label = t("bots.workspace.sidebar.createBotFromProject");
  const disabled = existingBot !== null;
  const tooltip = disabled
    ? t("bots.workspace.sidebar.createBotFromProjectExists", { name: existingBot })
    : undefined;
  if (surface === "context") {
    return (
      <ContextMenuItem
        testID={testID}
        leading={BOT_ICON}
        disabled={disabled}
        tooltip={tooltip}
        onSelect={open}
      >
        {label}
      </ContextMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      testID={testID}
      leading={BOT_ICON}
      disabled={disabled}
      tooltip={tooltip}
      onSelect={open}
    >
      {label}
    </DropdownMenuItem>
  );
}

/** The name of the bot that already lives in this Project, or null. */
function useProjectBotName(
  serverId: string | null | undefined,
  projectId: string | null,
): string | null {
  const hosts = useMemo(() => (serverId ? [{ serverId, serverName: serverId }] : []), [serverId]);
  const query = useBotsQuery({ hosts, runtime: botsRuntime });
  if (!projectId || query.loadState.status !== "loaded") return null;
  return query.loadState.data.find((bot) => bot.projectId === projectId)?.name ?? null;
}
