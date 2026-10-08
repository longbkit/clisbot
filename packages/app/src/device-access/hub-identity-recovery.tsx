import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { digest } from "@clisbot/device-access/proof";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { HubText as Text } from "./hub-text";
import type { HubProfile } from "./hub-profiles";
import { HubContextNote } from "./hub-ui";
import { inspectHubIdentity, type HubIdentityChange } from "./hub-identity-check";

/** Mount only on a failed pinned connection, never as an admission or automatic trust reset. */
export function HubIdentityRecovery({
  profile,
  onReview,
  fallback,
}: {
  profile: HubProfile;
  onReview(): void;
  fallback: ReactNode;
}) {
  const { t } = useTranslation();
  const [change, setChange] = useState<{
    profile: HubProfile;
    value: HubIdentityChange;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void inspectHubIdentity(profile).then((value) => {
      if (current) setChange(value ? { profile, value } : null);
      return undefined;
    });
    return () => {
      current = false;
    };
  }, [profile]);
  if (!change || change.profile !== profile) return fallback;
  return (
    <>
      <Alert
        variant="warning"
        title={t("hub.connection.identity.changedTitle")}
        description={t("hub.connection.identity.changedBody")}
      >
        <Button variant="outline" onPress={onReview}>
          {t("hub.connection.identity.review")}
        </Button>
      </Alert>
      <SettingsSection title={t("hub.connection.identity.section")}>
        <View style={settingsStyles.card}>
          <IdentityRow title={t("hub.connection.identity.saved")} identity={change.value.saved} />
          <IdentityRow
            title={t("hub.connection.identity.observed")}
            identity={change.value.observed}
            bordered
          />
        </View>
      </SettingsSection>
      <HubContextNote>{t("hub.connection.identity.note")}</HubContextNote>
    </>
  );
}

function IdentityRow({
  title,
  identity,
  bordered = false,
}: {
  title: string;
  identity: HubIdentityChange["saved"];
  bordered?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, bordered && settingsStyles.rowBorder]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.values}>
        <Text selectable>{t("hub.connection.identity.hub", { id: identity.hubId })}</Text>
        <Text selectable style={styles.hint}>
          {t("hub.connection.identity.fingerprint", {
            value: digest(identity.publicKey).slice(0, 16),
          })}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
  },
  title: {
    minWidth: 150,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  values: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
