import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Bot, FolderOpen, Server, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCallback, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AddHostModal } from "@/components/add-host-modal";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { canManageHostProjects } from "@/add-project-flow/permissions";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { buildHostRootRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import { BotCreateForm } from "../bots/create/bot-create-sheet";
import { useBotCreationHosts } from "../bots/feature";
import { useBotSidebarActions } from "../bots/sidebar/use-sidebar-actions";
import { buildHubSettingsRoute } from "./navigation";

const EMPTY_CHATS: [] = [];
const SNAP_POINTS = ["95%"];
const CONTENT_STYLE = { padding: 0 };

/** Enrollment is complete. Project creation is one optional next step. */
export function ConnectedHostActions({
  serverId,
  connected,
}: {
  serverId: string;
  connected: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const openAddProject = useOpenAddProject();
  const creationHosts = useBotCreationHosts();
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo);
  const [botOpen, setBotOpen] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const { openBot, error } = useBotSidebarActions(EMPTY_CHATS);
  const canCreateBot = connected && creationHosts.some((host) => host.serverId === serverId);
  const canAddProject =
    connected &&
    serverInfo?.features?.projectAdd === true &&
    serverInfo.features.stableProjectIdentity === true &&
    canManageHostProjects(serverInfo.permissions);
  const createBot = useCallback(() => setBotOpen(true), []);
  const closeBot = useCallback(() => setBotOpen(false), []);
  const onCreated = useCallback(
    (hostId: string, botId: string) => {
      setBotOpen(false);
      void openBot(hostId, botId);
    },
    [openBot],
  );
  const addProject = useCallback(() => openAddProject(serverId), [openAddProject, serverId]);
  const addHost = useCallback(() => setAddingHost((value) => !value), []);
  const openManaged = useCallback(() => router.push(buildHubSettingsRoute("hosts")), [router]);
  const openDirect = useCallback(() => setDirectOpen(true), []);
  const closeDirect = useCallback(() => setDirectOpen(false), []);
  const directSaved = useCallback(
    ({ serverId: hostId }: { serverId: string }) => {
      setDirectOpen(false);
      router.push(buildHostRootRoute(hostId));
    },
    [router],
  );
  const home = useCallback(() => router.push(buildOpenProjectRoute()), [router]);
  const botHeader = useMemo(() => ({ title: t("hub.account.nextSteps.newBot") }), [t]);
  return (
    <>
      <SettingsSection title={t("hub.account.nextSteps.title")}>
        <Text style={settingsStyles.rowHint}>{t("hub.account.nextSteps.hint")}</Text>
        <NextStepsCard
          onCreateBot={canCreateBot ? createBot : null}
          onAddProject={canAddProject ? addProject : null}
          onAddHost={addHost}
        />
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        {addingHost ? <AddHostChoices onManaged={openManaged} onDirect={openDirect} /> : null}
        <Button onPress={home}>{t("hub.account.nextSteps.continueHome")}</Button>
      </SettingsSection>
      <AdaptiveModalSheet
        visible={botOpen && canCreateBot}
        header={botHeader}
        scrollable={false}
        snapPoints={SNAP_POINTS}
        contentStyle={CONTENT_STYLE}
        onClose={closeBot}
      >
        {botOpen && canCreateBot ? (
          <BotCreateForm
            name=""
            defaultServerId={serverId}
            hosts={creationHosts}
            onCancel={closeBot}
            onCreated={onCreated}
          />
        ) : null}
      </AdaptiveModalSheet>
      <AddHostModal
        visible={directOpen}
        onClose={closeDirect}
        onCancel={closeDirect}
        onSaved={directSaved}
      />
    </>
  );
}

/** The next steps this Host offers; a step whose handler is `null` is not available here. */
function NextStepsCard({
  onCreateBot,
  onAddProject,
  onAddHost,
}: {
  onCreateBot: (() => void) | null;
  onAddProject: (() => void) | null;
  onAddHost(): void;
}) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.card}>
      {onCreateBot ? (
        <NextStepRow
          icon={Bot}
          title={t("hub.account.nextSteps.createBot")}
          description={t("hub.account.nextSteps.createBotDescription")}
          onPress={onCreateBot}
        />
      ) : null}
      {onAddProject ? (
        <NextStepRow
          icon={FolderOpen}
          title={t("hub.account.nextSteps.addProject")}
          description={t("hub.account.nextSteps.addProjectDescription")}
          onPress={onAddProject}
        />
      ) : null}
      <NextStepRow
        icon={Server}
        title={t("hub.account.nextSteps.addHost")}
        description={t("hub.account.nextSteps.addHostDescription")}
        onPress={onAddHost}
        last
      />
    </View>
  );
}

function AddHostChoices({ onManaged, onDirect }: { onManaged(): void; onDirect(): void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.hostChoices}>
      <Button variant="outline" onPress={onManaged}>
        {t("hub.account.nextSteps.managedHost")}
      </Button>
      <Button variant="outline" onPress={onDirect}>
        {t("hub.account.nextSteps.directHost")}
      </Button>
    </View>
  );
}

function StepIcon({
  icon: Icon,
  color,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  color?: string;
}) {
  return <Icon size={20} color={color} />;
}
const ThemedStepIcon = withUnistyles(StepIcon);
const ThemedChevronRight = withUnistyles(ChevronRight);

function NextStepRow({
  icon: Icon,
  title,
  description,
  onPress,
  last = false,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
  onPress(): void;
  last?: boolean;
}) {
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      !last && styles.separator,
      (hovered || pressed) && styles.highlighted,
    ],
    [last],
  );
  return (
    <Pressable
      onPress={onPress}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <ThemedStepIcon icon={Icon} uniProps={mutedIconColorMapping} />
      <View style={styles.rowText}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{description}</Text>
      </View>
      <ThemedChevronRight size={16} uniProps={mutedIconColorMapping} />
    </Pressable>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  rowText: { flex: 1, gap: theme.spacing[1] },
  separator: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  highlighted: { backgroundColor: theme.colors.interactionHighlight },
  hostChoices: { gap: theme.spacing[2] },
}));
