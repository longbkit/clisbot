import { botsSessionScope } from "../data/session-scope";
import { BotCreateForm } from "../create/bot-create-sheet";
import { botView } from "../data/contracts";
import { useState, useEffect, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BotPayload } from "@getpaseo/protocol/bots/types";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { Button } from "@/components/ui/button";
import { MenuHeader } from "@/components/headers/menu-header";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useHostBotsFeature } from "../feature";
import { refreshBotsAndChats } from "../data/runtime";

export default function BotRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <Gate />
    </HostRouteBootstrapBoundary>
  );
}
function Gate() {
  const { serverId = "", botId = "" } = useLocalSearchParams<{ serverId: string; botId: string }>();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const enabled = useHostBotsFeature(serverId);
  const status = useHostRuntimeConnectionStatus(serverId);
  if (!enabled)
    return (
      <Text>
        {status === "online"
          ? "Bots and Chats is not enabled on this Host."
          : "Connecting to Host…"}
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
  const router = useRouter();
  const [bot, setBot] = useState<BotPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (client)
      void client
        .listBots()
        .then((r) => {
          if (!active) return undefined;
          const row = r.bots.find((b) => b.id === botId);
          setBot(row ?? null);
          if (!row) setError(r.error ?? "Bot is no longer available");
          return undefined;
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [botId, client]);
  const archive = useCallback(async () => {
    if (!client || bot?.canConfigure !== true) return;
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
  }, [client, botId, router, bot?.canConfigure]);
  const archiveAction = useCallback(() => {
    void archive();
  }, [archive]);
  const projectAction = useCallback(() => {
    if (bot)
      router.push(
        `/settings/hosts/${encodeURIComponent(serverId)}/projects/${encodeURIComponent(bot.projectId)}`,
      );
  }, [bot, router, serverId]);
  const accessAction = useCallback(() => router.push("/settings/hub/access"), [router]);
  const onSaved = useCallback(() => {
    refreshBotsAndChats();
    router.back();
  }, [router]);
  const cancel = useCallback(() => router.back(), [router]);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <MenuHeader title={bot?.name ?? "Bot settings"} />
      {error ? (
        <Text style={styles.text} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {bot && bot.canConfigure !== true ? (
        <Text style={styles.text}>You do not have permission to configure this bot.</Text>
      ) : null}
      {bot?.canConfigure === true ? (
        <>
          <BotCreateForm
            name={bot.name}
            bot={botView(bot)}
            hosts={[{ serverId, label: serverId }]}
            onCreated={onSaved}
            onCancel={cancel}
          />
          <Text style={styles.text}>
            {bot.kind === "team" ? "Team memory" : "Personal memory"} · {bot.launch.provider}
          </Text>
          <Text style={styles.text}>
            Share this bot using its Project in Access settings. Chat history stays private to each
            person.
          </Text>
          <Button variant="outline" onPress={projectAction}>
            Project settings
          </Button>
          <Button variant="outline" onPress={accessAction}>
            Team access
          </Button>
          <Text style={styles.text}>Archiving keeps this bot’s workspace and memory.</Text>
          <Button variant="destructive" disabled={busy} onPress={archiveAction}>
            Archive bot
          </Button>
        </>
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[4], gap: theme.spacing[3] },
  text: { color: theme.colors.foreground },
  input: {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    borderRadius: 8,
    padding: theme.spacing[3],
  },
}));
