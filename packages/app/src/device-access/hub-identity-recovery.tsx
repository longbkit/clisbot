import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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
        title="Hub identity changed"
        description="The Hub at this address no longer matches the saved Hub identity. Check it with the Hub operator before reconnecting."
      >
        <Button variant="outline" onPress={onReview}>
          Review connection
        </Button>
      </Alert>
      <SettingsSection title="Hub identity">
        <View style={settingsStyles.card}>
          <IdentityRow title="Saved identity" identity={change.value.saved} />
          <IdentityRow title="Identity at this address" identity={change.value.observed} bordered />
        </View>
      </SettingsSection>
      <HubContextNote>
        Saved credentials remain withheld from the changed identity. Ask the operator to restore the
        correct Hub key or provide a verified connection link. Reviewing the connection keeps the
        saved identity unchanged.
      </HubContextNote>
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
  return (
    <View style={[styles.row, bordered && settingsStyles.rowBorder]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.values}>
        <Text selectable>Hub {identity.hubId}</Text>
        <Text selectable style={styles.hint}>
          Key fingerprint {digest(identity.publicKey).slice(0, 16)}
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
