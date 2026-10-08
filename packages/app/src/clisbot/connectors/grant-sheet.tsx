import { ChevronRight } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  connectorAccessOf,
  type ConnectorAccess,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { RadioList, type RadioOption } from "../hub/settings/channel-route-audience-controls";
import type { ConnectorLookup } from "./connector-lookup";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";
import type { GrantTarget } from "./grant-rows";
import {
  accountSelectionLabel,
  revokeApp,
  revokeMcpServer,
  setAppAccess,
  toolSelectionLabel,
} from "./model";
import type { GrantEdit } from "./use-grant-editor";

/**
 * One Connector of a Project, opened from its row (docs/design.md §12, the Providers pattern):
 * access as a radio list because each choice has consequences to read (§4), the limits as rows
 * that open their pickers, and Remove behind a confirm (§3). Each change saves at once.
 */

const ThemedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function accessOptions(t: TFunction): readonly RadioOption<ConnectorAccess>[] {
  return [
    {
      value: "read",
      label: t("connectors.screen.common.readOnly"),
      description: t("connectors.screen.grantSheet.readHint"),
    },
    {
      value: "write",
      label: t("connectors.screen.common.readWrite"),
      description: t("connectors.screen.grantSheet.writeHint"),
    },
  ];
}

export type GrantPicker = "tools" | "accounts";

export function GrantSheet({
  target,
  grant,
  lookup,
  apply,
  onPick,
  onManage,
  onClose,
}: {
  target: GrantTarget;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  apply(edit: GrantEdit): void;
  onPick(picker: GrantPicker): void;
  onManage(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const name = target.kind === "app" ? lookup.name(target.slug) : target.name;
  const remove = useRemove(target, name, apply, onClose);
  const pickTools = useCallback(() => onPick("tools"), [onPick]);
  const header = useMemo(
    () => ({
      title: name,
      subtitle: target.kind === "app" ? undefined : t("connectors.screen.common.mcpServer"),
      leading:
        target.kind === "app" ? (
          <ConnectorLogo slug={target.slug} name={name} logo={lookup.logo(target.slug)} />
        ) : (
          <ConnectorLogo slug={serverLogoKey(target.name)} name={name} />
        ),
    }),
    [lookup, name, t, target],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="outline" size="sm" onPress={remove} testID="connector-grant-remove">
          {t("connectors.screen.grantSheet.removeFromProject")}
        </Button>
        <Button variant="default" onPress={onClose}>
          {t("connectors.screen.common.done")}
        </Button>
      </View>
    ),
    [onClose, remove, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={480}
      testID="connector-grant-sheet"
    >
      {target.kind === "app" ? (
        <AppSettings
          slug={target.slug}
          grant={grant}
          lookup={lookup}
          apply={apply}
          onPick={onPick}
          onManage={onManage}
        />
      ) : (
        <View style={settingsStyles.card}>
          <LimitRow
            label={t("connectors.screen.common.tools")}
            value={toolSelectionLabel(grant?.mcpServers?.[target.name]?.tools ?? "all")}
            onPress={pickTools}
          />
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function AppSettings({
  slug,
  grant,
  lookup,
  apply,
  onPick,
  onManage,
}: {
  slug: string;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  apply(edit: GrantEdit): void;
  onPick(picker: GrantPicker): void;
  onManage(): void;
}) {
  const { t } = useTranslation();
  const app = grant?.apps?.[slug];
  const setAccess = useCallback(
    (access: ConnectorAccess) => apply((current) => setAppAccess(current, slug, access)),
    [apply, slug],
  );
  const pickTools = useCallback(() => onPick("tools"), [onPick]);
  const pickAccounts = useCallback(() => onPick("accounts"), [onPick]);
  if (!app) return null;
  return (
    <View style={styles.body}>
      {lookup.connected(slug) ? null : (
        <Alert
          variant="warning"
          title={t("connectors.screen.grantSheet.notConnectedTitle", { app: lookup.name(slug) })}
          description={t("connectors.screen.grantSheet.notConnectedHint")}
        >
          <Button variant="outline" size="sm" onPress={onManage}>
            {t("connectors.screen.grantSheet.openConnectors")}
          </Button>
        </Alert>
      )}
      <RadioList
        label={t("connectors.screen.grantSheet.access")}
        options={accessOptions(t)}
        selected={connectorAccessOf(app.access)}
        onChange={setAccess}
        disabled={false}
      />
      <View style={settingsStyles.card}>
        {lookup.noAuth(slug) ? null : (
          <LimitRow
            label={t("connectors.screen.common.accounts")}
            value={accountSelectionLabel(app.accounts, lookup.accounts(slug))}
            onPress={pickAccounts}
          />
        )}
        <LimitRow
          label={t("connectors.screen.common.tools")}
          value={toolSelectionLabel(app.tools)}
          bordered={!lookup.noAuth(slug)}
          onPress={pickTools}
        />
      </View>
    </View>
  );
}

/** A limit as a row: its label, its value, and a chevron to the picker (§12). */
function LimitRow({
  label,
  value,
  bordered = false,
  onPress,
}: {
  label: string;
  value: string;
  bordered?: boolean;
  onPress(): void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("connectors.screen.grantSheet.limitLabel", { label, value })}
      onPress={onPress}
      style={bordered ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}
    >
      <Text style={[settingsStyles.rowTitle, settingsStyles.rowContent]}>{label}</Text>
      <View style={styles.value}>
        <Text style={styles.valueText}>{value}</Text>
        <ThemedChevron size={ICON_SIZE.sm} />
      </View>
    </Pressable>
  );
}

function useRemove(
  target: GrantTarget,
  name: string,
  apply: (edit: GrantEdit) => void,
  onClose: () => void,
) {
  const { t } = useTranslation();
  return useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("connectors.screen.common.removeTitle", { name }),
      message: t("connectors.screen.grantSheet.removeMessage"),
      confirmLabel: t("connectors.screen.common.remove"),
      destructive: true,
    });
    if (!confirmed) return;
    onClose();
    apply((grant) =>
      target.kind === "app" ? revokeApp(grant, target.slug) : revokeMcpServer(grant, target.name),
    );
  }, [apply, name, onClose, t, target]);
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[4] },
  value: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  valueText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
    width: "100%",
  },
}));
