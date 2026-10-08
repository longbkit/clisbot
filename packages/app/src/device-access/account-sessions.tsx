import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { HubText as Text } from "./hub-text";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { useHubProfiles } from "./hub-profiles";
import { PairedHubTransport } from "./hub-transport";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { HubLaptopIcon, hubMutedIconProps, HubStatusBadge, HubContextNote } from "./hub-ui";
import { createHubTransport } from "@/clisbot/hub/transport/create";
import type { HubProfile } from "./hub-profiles";

const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.union([z.string(), z.number()]),
  updatedAt: z.union([z.string(), z.number()]),
  lastActiveAt: z.string().optional(),
  expiresAt: z.union([z.string(), z.number()]),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  isCurrent: z.boolean(),
});
const SessionsSchema = z.object({
  sessions: z.array(SessionSchema),
  currentSessionId: z.string().nullable(),
});
export function AccountSessions() {
  const hub = useHubAccount();
  const registry = useHubProfiles();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const accountId = hub.state && "account" in hub.state ? hub.state.account.id : null;
  return (
    <AccountSessionsScope
      key={JSON.stringify([hub.origin, profile?.hubId, accountId])}
      hub={hub}
      profile={profile}
    />
  );
}

function AccountSessionsScope({
  hub,
  profile,
}: {
  hub: ReturnType<typeof useHubAccount>;
  profile: HubProfile | undefined;
}) {
  const { t } = useTranslation();
  const generation = useRef(0);
  const transport = useMemo(() => {
    if (profile) return new PairedHubTransport(profile);
    if (hub.origin) return createHubTransport({ origin: hub.origin });
    return null;
  }, [profile, hub.origin]);
  const [sessions, setSessions] = useState<z.infer<typeof SessionSchema>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refresh = useCallback(async () => {
    if (!transport) return;
    const requestedGeneration = generation.current;
    const response = await transport.request("/api/auth/clisbot/device/account/sessions");
    if (requestedGeneration !== generation.current) return;
    if (!response.ok) throw new Error(t("hub.connection.sessions.unavailable"));
    const next = SessionsSchema.parse(await response.json()).sessions;
    if (requestedGeneration === generation.current) setSessions(next);
  }, [transport, t]);
  useEffect(() => {
    const lifetime = generation;
    const requestedGeneration = generation.current;
    void refresh().catch((caught) => {
      if (requestedGeneration === generation.current) setError(caught.message);
    });
    return () => {
      lifetime.current++;
      if (transport instanceof PairedHubTransport) transport.close();
    };
  }, [refresh, transport]);
  const signOut = useCallback(
    async (session: z.infer<typeof SessionSchema>) => {
      const requestedGeneration = generation.current;
      const confirmed = await confirmDialog({
        title: signOutTitle(t, session),
        message: t("hub.connection.sessions.confirmMessage"),
        confirmLabel: t("hub.connection.sessions.signOut"),
        cancelLabel: t("hub.connection.common.cancel"),
        destructive: true,
      });
      if (!confirmed || !transport || requestedGeneration !== generation.current) return;
      setPending(true);
      setError(null);
      try {
        if (session.isCurrent) {
          await hub.signOut();
          return;
        }
        const response = await transport.request(
          `/api/auth/clisbot/device/account/sessions/${encodeURIComponent(session.id)}`,
          { method: "DELETE" },
        );
        if (requestedGeneration !== generation.current) return;
        if (!response.ok) throw new Error(t("hub.connection.sessions.failed"));
        await refresh();
      } catch (caught) {
        if (requestedGeneration === generation.current)
          setError(caught instanceof Error ? caught.message : t("hub.connection.sessions.failed"));
      } finally {
        if (requestedGeneration === generation.current) setPending(false);
      }
    },
    [transport, hub, refresh, t],
  );
  return (
    <SettingsSection title={t("hub.connection.sessions.title")}>
      <View style={settingsStyles.card}>
        {sessions.map((session, index) => (
          <AccountSessionRow
            key={session.id}
            session={session}
            pending={pending}
            signOut={signOut}
            bordered={index > 0}
          />
        ))}
      </View>
      <HubContextNote>{t("hub.connection.sessions.note")}</HubContextNote>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </SettingsSection>
  );
}

function signOutTitle(t: TFunction, session: z.infer<typeof SessionSchema>): string {
  if (session.isCurrent) return t("hub.connection.sessions.confirmThisDevice");
  return session.label == null
    ? t("hub.connection.sessions.confirmSession")
    : t("hub.connection.sessions.confirmOther", { label: session.label });
}

function AccountSessionRow({
  session,
  pending,
  signOut,
  bordered,
}: {
  session: z.infer<typeof SessionSchema>;
  pending: boolean;
  signOut(session: z.infer<typeof SessionSchema>): Promise<void>;
  bordered: boolean;
}) {
  const { t } = useTranslation();
  const end = useCallback(() => {
    void signOut(session);
  }, [session, signOut]);
  return (
    <View style={[styles.row, bordered && settingsStyles.rowBorder]}>
      <HubLaptopIcon size={18} uniProps={hubMutedIconProps} />
      <View style={styles.copy}>
        <View style={styles.heading}>
          <Text style={styles.title}>
            {session.label ?? t("hub.connection.sessions.device")}
            {session.isCurrent ? t("hub.connection.common.thisDeviceSuffix") : ""}
          </Text>
          {session.isCurrent ? (
            <HubStatusBadge label={t("hub.connection.sessions.current")} tone="success" />
          ) : null}
        </View>
        <Text style={styles.hint}>
          {t("hub.connection.sessions.signedIn", {
            date: new Date(session.createdAt).toLocaleString(),
          })}
        </Text>
        <Text style={styles.hint}>
          {t("hub.connection.common.lastActive", {
            date: new Date(session.lastActiveAt ?? session.updatedAt).toLocaleString(),
          })}
        </Text>
      </View>
      {!session.isCurrent ? (
        <Button size="sm" variant="outline" disabled={pending} onPress={end}>
          {t("hub.connection.sessions.signOut")}
        </Button>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  copy: { flex: 1, minWidth: 0 },
  heading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: { fontSize: theme.fontSize.base, lineHeight: 20 },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    marginTop: 4,
  },
}));
