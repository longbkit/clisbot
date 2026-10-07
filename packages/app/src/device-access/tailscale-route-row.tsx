import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  TAILSCALE_DOWNLOAD_URL,
  type TailscaleRowAction,
  type TailscaleRowModel,
} from "./host-tailscale";

export interface TailscaleRouteRowProps {
  model: TailscaleRowModel;
  /** Shown under the title when the state has no hint of its own. */
  description: string;
  actionUrl?: string;
  error?: string | null;
  onSetUp(): void;
  onRetry(): void;
}

/** The Tailscale line in "Ways to connect", shared by Host pairing and Hub connection. */
export function TailscaleRouteRow(props: TailscaleRouteRowProps) {
  const { t } = useTranslation();
  const { model } = props;
  return (
    <View style={settingsStyles.row} testID="tailscale-route-row">
      <View style={settingsStyles.rowContent}>
        <View style={styles.titleLine}>
          <Text style={settingsStyles.rowTitle}>{t("pairing.tailscale.title")}</Text>
          <Text style={styles.recommended}>{t("pairing.tailscale.recommended")}</Text>
        </View>
        <Text style={settingsStyles.rowHint}>{model.hint ?? props.description}</Text>
        {props.error ? <Text style={settingsStyles.rowError}>{props.error}</Text> : null}
      </View>
      <View style={styles.trailing}>
        <StatusBadge label={t(`pairing.tailscale.states.${model.status}`)} variant={model.tone} />
        {model.actions.map((action) => (
          <TailscaleActionButton key={action} action={action} {...props} />
        ))}
      </View>
    </View>
  );
}

function TailscaleActionButton(props: TailscaleRouteRowProps & { action: TailscaleRowAction }) {
  const { t } = useTranslation();
  const onPress = {
    setUp: props.onSetUp,
    retry: props.onRetry,
    getTailscale: () => void openExternalUrl(TAILSCALE_DOWNLOAD_URL),
    enableOnTailnet: () => {
      if (props.actionUrl) void openExternalUrl(props.actionUrl);
    },
  }[props.action];
  return (
    <Button variant="outline" size="sm" onPress={onPress}>
      {t(`pairing.tailscale.actions.${props.action}`)}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  recommended: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  trailing: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
}));
