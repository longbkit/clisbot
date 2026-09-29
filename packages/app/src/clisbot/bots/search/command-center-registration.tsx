import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Hash, Plus } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useCommandCenterActions } from "@/command-center/provider";
import type { CommandCenterIconProps } from "@/command-center/contributions";
import { useToast } from "@/contexts/toast-context";
import { useBotCreationHosts, useBotsFeatureHosts } from "../feature";
import { botsRuntime } from "../data/runtime";
import { useBotsQuery } from "../data/use-bots";
import { useChatsQuery } from "../data/use-chats";
import { useBotSidebarActions } from "../sidebar/use-sidebar-actions";
import { useCreationRequest } from "../sidebar/creation-request";
import { buildBotSearchContributions } from "./command-center-contributions";

const muted = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedBot = withUnistyles(Bot, muted);
const ThemedHash = withUnistyles(Hash, muted);
const ThemedPlus = withUnistyles(Plus, muted);

function BotIcon({ size }: CommandCenterIconProps) {
  return <ThemedBot size={size} strokeWidth={2.2} />;
}
function GroupIcon({ size }: CommandCenterIconProps) {
  return <ThemedHash size={size} strokeWidth={2.2} />;
}
function CreateIcon({ size }: CommandCenterIconProps) {
  return <ThemedPlus size={size} strokeWidth={2.4} />;
}
const ICONS = { bot: BotIcon, group: GroupIcon, create: CreateIcon };

/**
 * Registers bots and group chats with the Command Center. Reads the same queries the sidebar
 * does (shared cache) without opening another event feed; renders nothing.
 */
export function BotsCommandCenterActions() {
  const featureHosts = useBotsFeatureHosts();
  const hosts = useMemo(
    () => featureHosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [featureHosts],
  );
  const bots = useBotsQuery({ hosts, runtime: botsRuntime });
  const chats = useChatsQuery({ hosts, runtime: botsRuntime });
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : EMPTY;
  const chatRows = chats.loadState.status === "loaded" ? chats.loadState.data : EMPTY;
  const creationHosts = useBotCreationHosts();
  const sidebarCanCreate = useCreationRequest((state) => state.handlers > 0);
  const canCreateBot = sidebarCanCreate && creationHosts.length > 0;
  const canCreateGroup = sidebarCanCreate && botRows.length > 0;
  const { openBot, navigate, error } = useBotSidebarActions(
    chatRows,
    undefined,
    chats.loadState.status === "loaded",
  );
  const ask = useCreationRequest((state) => state.ask);
  const { t } = useTranslation();
  const toast = useToast();
  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);
  const actions = useMemo(
    () =>
      buildBotSearchContributions({
        bots: botRows,
        chats: chatRows,
        multipleHosts: hosts.length > 1,
        canCreateBot,
        canCreateGroup,
        labels: { actions: t("shell.commandCenter.actions") },
        icons: ICONS,
        openBot: (serverId, botId) => void openBot(serverId, botId),
        openChat: navigate,
        createBot: () => ask("bot"),
        createGroup: () => ask("group"),
      }),
    [botRows, chatRows, hosts.length, canCreateBot, canCreateGroup, t, openBot, navigate, ask],
  );
  useCommandCenterActions({ sourceId: "clisbot-bots", enabled: hosts.length > 0, actions });
  return null;
}

const EMPTY: never[] = [];
