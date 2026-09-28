import { useCallback, useMemo, type ReactNode } from "react";
import { View, Text } from "react-native";
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
  title,
  project,
  singlePanel,
  selector,
  headerActions,
  openExplorer,
  group,
  memberCount,
  tabCount,
}: {
  serverId: string;
  title: string;
  project: Project;
  singlePanel: boolean;
  selector: ReactNode;
  headerActions: ReactNode;
  openExplorer: () => void;
  group: boolean;
  memberCount: number;
  tabCount: number;
}) {
  const hosts = useHosts();
  const hostName = hosts.find((host) => host.serverId === serverId)?.label ?? "Host";
  const right = useMemo(
    () => (
      <View style={styles.actions}>
        {!singlePanel ? selector : null}
        {!singlePanel && project.cwd && project.isGit ? (
          <WorkspaceActions serverId={serverId} cwd={project.cwd} />
        ) : null}
        {headerActions}
        <ChatHeaderAction
          label={project.source ? "Files and changes" : "Project access is required to view files"}
          icon={PanelRight}
          disabled={!project.source}
          onPress={openExplorer}
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
    ],
  );
  const left = (
    <>
      <SidebarMenuToggle />
      <ConversationHeading
        title={title}
        group={group}
        memberCount={memberCount}
        hostName={hostName}
        tabCount={tabCount}
      />
    </>
  );
  return <ScreenHeader left={left} right={right} />;
}

export function ConversationBotSelector({ project }: { project: Project }) {
  const choose = useCallback(() => project.setChooser(true), [project]);
  return (
    <ComboboxTrigger
      ref={project.chooserAnchorRef}
      accessibilityRole="button"
      accessibilityLabel="Choose bot project"
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
      searchPlaceholder="Search bots…"
      emptyText="No bots found"
      title="Bot project"
      desktopPlacement="bottom-start"
      desktopMinWidth={280}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  botSelector: {
    minHeight: { xs: 48, md: 32 },
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
  },
  botName: { fontSize: 12, color: theme.colors.foregroundMuted, maxWidth: 120 },
}));
