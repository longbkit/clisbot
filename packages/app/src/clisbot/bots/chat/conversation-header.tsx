import { useCallback, useMemo, type ReactNode } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PanelRight } from "lucide-react-native";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { useHosts } from "@/runtime/host-runtime";
import { ConversationHeading } from "./conversation-heading";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { WorkspaceActions } from "@/git/workspace-actions";
import { ChatHeaderAction } from "./header-action";
import type { useConversationProject } from "./use-conversation-project";
import type { ChatBotIdentity } from "./chat-rows";
type Project = ReturnType<typeof useConversationProject>;
export function ConversationHeader({
  serverId,
  avatar,
  title,
  project,
  singlePanel,
  selector,
  headerActions,
  headingActions,
  openExplorer,
  group,
  memberCount,
  tabCount,
}: {
  serverId: string;
  avatar: ReactNode;
  title: string;
  project: Project;
  singlePanel: boolean;
  selector: ReactNode;
  headerActions: ReactNode;
  headingActions?: ReactNode;
  openExplorer: () => void;
  group: boolean;
  memberCount: number;
  tabCount: number;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const hostName =
    hosts.find((host) => host.serverId === serverId)?.label ?? t("bots.chat.header.hostFallback");
  const right = useMemo(
    () => (
      <View style={styles.actions}>
        {!singlePanel ? selector : null}
        {!singlePanel && project.cwd && project.isGit ? (
          <WorkspaceActions serverId={serverId} cwd={project.cwd} />
        ) : null}
        {headerActions}
        <ChatHeaderAction
          label={
            project.source ? t("bots.chat.header.files") : t("bots.chat.header.filesNeedAccess")
          }
          icon={PanelRight}
          disabled={!project.source}
          onPress={openExplorer}
          trailingEdge
        />
      </View>
    ),
    [
      singlePanel,
      selector,
      project.cwd,
      project.isGit,
      project.source,
      serverId,
      headerActions,
      openExplorer,
      t,
    ],
  );
  const left = (
    <>
      <SidebarMenuToggle />
      <ConversationHeading
        avatar={avatar}
        title={title}
        group={group}
        memberCount={memberCount}
        hostName={hostName}
        tabCount={tabCount}
      />
      {headingActions ? <View style={styles.headingActions}>{headingActions}</View> : null}
    </>
  );
  return <ScreenHeader left={left} right={right} />;
}

export function ConversationBotSelector({ project }: { project: Project }) {
  const { t } = useTranslation();
  const choose = useCallback(() => project.setChooser(true), [project]);
  return (
    <ComboboxTrigger
      ref={project.chooserAnchorRef}
      accessibilityRole="button"
      accessibilityLabel={t("bots.chat.common.chooseBotProject")}
      onPress={choose}
      style={styles.botSelector}
    >
      <Text numberOfLines={1} style={styles.botName}>
        {project.selectedBot?.name}
      </Text>
    </ComboboxTrigger>
  );
}
export function ConversationBotChooser({
  project,
  bots,
}: {
  project: Project;
  bots: readonly ChatBotIdentity[];
}) {
  const { t } = useTranslation();
  const options = useMemo(() => bots.map((bot) => ({ id: bot.botId, label: bot.name })), [bots]);
  return (
    <Combobox
      options={options}
      value={project.selectedBot?.botId ?? ""}
      onSelect={project.setSelectedBotId}
      open={project.chooser}
      onOpenChange={project.setChooser}
      anchorRef={project.chooserAnchorRef}
      searchable
      searchPlaceholder={t("bots.chat.header.searchBots")}
      emptyText={t("bots.chat.header.noBots")}
      title={t("bots.chat.header.botProject")}
      desktopPlacement="bottom-start"
      desktopMinWidth={280}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  botSelector: {
    minHeight: { xs: 48, md: 32 },
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
  },
  botName: { fontSize: 12, color: theme.colors.foregroundMuted, maxWidth: 120 },
}));
