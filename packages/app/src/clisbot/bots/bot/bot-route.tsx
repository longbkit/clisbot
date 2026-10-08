import { botsSessionScope } from "../data/session-scope";
import { BotCreateForm } from "../create/bot-create-sheet";
import { botView } from "../data/contracts";
import { useState, useEffect, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BotPayload } from "@clisbot/protocol/bots/types";
import { WithConnectorsTab } from "@/clisbot/connectors/connectors-tab";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SettingsCard, SettingsSection, SettingsAction } from "@/components/settings";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import { MenuHeader } from "@/components/headers/menu-header";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useHostBotsFeature, useBotsFeatureHosts } from "../feature";
import { refreshBotsAndChats } from "../data/runtime";

export default function BotRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <Gate />
    </HostRouteBootstrapBoundary>
  );
}
type HostRuntimeClient = ReturnType<typeof useHostRuntimeClient>;

function Gate() {
  const { serverId = "", botId = "" } = useLocalSearchParams<{
    serverId: string;
    botId: string;
  }>();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const enabled = useHostBotsFeature(serverId);
  const status = useHostRuntimeConnectionStatus(serverId);
  const { t } = useTranslation();
  if (!enabled)
    return (
      <Text>
        {status === "online"
          ? t("bots.workspace.botSettings.featureOff")
          : t("bots.workspace.botSettings.connecting")}
      </Text>
    );
  return (
    <BotSettings
      key={`${serverId}:${botId}:${botsSessionScope(snapshot)}`}
      serverId={serverId}
      botId={botId}
    />
  );
}
function BotSettings({ serverId, botId }: { serverId: string; botId: string }) {
  const client = useHostRuntimeClient(serverId);
  const hosts = useBotsFeatureHosts();
  const { t } = useTranslation();
  const hostLabel =
    hosts.find((host) => host.serverId === serverId)?.label ??
    t("bots.workspace.botSettings.currentHost");
  const { bot, error, setError } = useBotRecord(client, botId);
  const actions = useBotSettingsActions({ client, serverId, botId, bot, setError });
  return (
    <View style={styles.screen}>
      <MenuHeader title={t("bots.workspace.shared.botSettings")} />
      <ScrollView>
        <View style={styles.content}>
          {error ? (
            <Text style={styles.text} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {bot && bot.canConfigure !== true ? (
            <Text style={styles.text}>{t("bots.workspace.botSettings.noPermission")}</Text>
          ) : null}
          {bot?.canConfigure === true ? (
            <WithConnectorsTab
              serverId={serverId}
              projectId={bot.projectId}
              subject="bot"
              provider={bot.launch.provider}
            >
              <BotCreateForm
                defaultServerId={serverId}
                name={bot.name}
                bot={botView(bot)}
                hosts={[{ serverId, label: hostLabel }]}
                onCreated={actions.onSaved}
                onCancel={actions.cancel}
              />
              <BotManagementSections actions={actions} />
            </WithConnectorsTab>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function useBotRecord(client: HostRuntimeClient, botId: string) {
  const [bot, setBot] = useState<BotPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    let active = true;
    if (client)
      void client
        .listBots()
        .then((r) => {
          if (!active) return undefined;
          const row = r.bots.find((b) => b.id === botId);
          setBot(row ?? null);
          if (!row) setError(r.error ?? t("bots.workspace.botSettings.unavailable"));
          return undefined;
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [botId, client, t]);
  return { bot, error, setError };
}

type BotSettingsActions = ReturnType<typeof useBotSettingsActions>;

function useBotSettingsActions({
  client,
  serverId,
  botId,
  bot,
  setError,
}: {
  client: HostRuntimeClient;
  serverId: string;
  botId: string;
  bot: BotPayload | null;
  setError: (value: string | null) => void;
}) {
  const router = useRouter();
  const { busy, archiveAction } = useArchiveBot({ client, botId, bot, setError });
  const projectAction = useCallback(() => {
    if (bot)
      router.push(
        `/settings/hosts/${encodeURIComponent(
          serverId,
        )}/projects/${encodeURIComponent(bot.projectId)}`,
      );
  }, [bot, router, serverId]);
  const accessAction = useCallback(() => router.push("/settings/hub/access"), [router]);
  const onSaved = useCallback(() => {
    refreshBotsAndChats();
    router.back();
  }, [router]);
  const cancel = useCallback(() => router.back(), [router]);
  return { busy, archiveAction, projectAction, accessAction, onSaved, cancel };
}

function useArchiveBot({
  client,
  botId,
  bot,
  setError,
}: {
  client: HostRuntimeClient;
  botId: string;
  bot: BotPayload | null;
  setError: (value: string | null) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const archive = useCallback(async () => {
    if (!client || bot?.canConfigure !== true) return;
    if (
      !(await confirmDialog({
        title: t("bots.workspace.botSettings.archiveTitle"),
        message: t("bots.workspace.botSettings.archiveMessage"),
        confirmLabel: t("bots.workspace.shared.archiveBot"),
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.archiveBot({ botId });
      if (r.error) throw new Error(r.error);
      refreshBotsAndChats();
      router.back();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [client, botId, router, bot?.canConfigure, setError, t]);
  const archiveAction = useCallback(() => {
    void archive();
  }, [archive]);
  return { busy, archiveAction };
}

function BotManagementSections({ actions }: { actions: BotSettingsActions }) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("bots.workspace.botSettings.projectAndAccess")}>
        <SettingsCard>
          <SettingsAction
            label={t("bots.workspace.botSettings.projectSettings")}
            hint={t("bots.workspace.botSettings.projectSettingsHint")}
            actionLabel={t("bots.workspace.botSettings.open")}
            onPress={actions.projectAction}
          />
          <SettingsAction
            label={t("bots.workspace.botSettings.teamAccess")}
            hint={t("bots.workspace.botSettings.teamAccessHint")}
            actionLabel={t("bots.workspace.botSettings.manage")}
            onPress={actions.accessAction}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("bots.workspace.botSettings.archive")} flush>
        <SettingsCard>
          <SettingsAction
            label={t("bots.workspace.shared.archiveBot")}
            hint={t("bots.workspace.botSettings.archiveHint")}
            actionLabel={t("bots.workspace.botSettings.archiveAction")}
            disabled={actions.busy}
            onPress={actions.archiveAction}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  text: { color: theme.colors.foreground },
  input: {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    borderRadius: 8,
    padding: theme.spacing[3],
  },
}));
