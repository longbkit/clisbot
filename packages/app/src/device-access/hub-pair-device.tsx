import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { hubPairingOfferUrl } from "@clisbot/protocol/device-pairing-offer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import type { HubProfile } from "./hub-profiles";
import { PairingLinkPanel } from "./pairing-link-panel";
import { approvedHubOffer } from "./pairing-offer";

/** A Hub-only invitation for another device, from the Hub's own screen. Host pairing can
 * carry the same grant; this is for a Hub reached without pairing its Host. */
export function HubPairDevicePanel({ profile, onClose }: { profile: HubProfile; onClose(): void }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const link = useFetchQuery({
    queryKey: ["hub-pairing-link", profile.hubId, attempt],
    queryFn: async () => {
      const { hubId, publicKey, origin, relay, pairing } = await approvedHubOffer(profile);
      if (!pairing) throw new Error(t("hub.connection.errors.noInvitation"));
      return hubPairingOfferUrl({ hubId, publicKey, origin, relay, pairing });
    },
    dataShape: "value",
    staleTimeMs: 4 * 60 * 1000,
    // Single use: reopening the panel must not show a link that may already be redeemed.
    gcTime: 0,
    retry: false,
  });
  const fresh = useCallback(() => setAttempt((value) => value + 1), []);
  return (
    <View style={[settingsStyles.card, styles.panel]}>
      {link.data ? (
        <PairingLinkPanel url={link.data} hint={t("hub.connection.pairDevice.hint")} />
      ) : null}
      {link.error ? (
        <Alert variant="error" description={link.error.message}>
          <Button variant="outline" size="sm" onPress={fresh}>
            {t("hub.connection.common.retry")}
          </Button>
        </Alert>
      ) : null}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={fresh} disabled={link.isFetching}>
          {t("hub.connection.pairDevice.newLink")}
        </Button>
        <Button variant="outline" size="sm" onPress={onClose}>
          {t("hub.connection.pairDevice.done")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
    marginBottom: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
