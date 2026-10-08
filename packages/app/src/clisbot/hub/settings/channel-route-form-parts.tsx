import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { FoldedRouteFormSection, RouteFormSection } from "./channel-route-form-sections";
import { ChannelIcon } from "@/clisbot/channels/channel-icon";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { type ChannelLimitName } from "../channel-configuration";
import { ChannelLimitsFields } from "./channel-limits-fields";
import {
  NO_DEFAULTS,
  ROUTE_TOTAL_LIMIT_NAMES,
  channelLimitsSummary,
  parseChannelLimitsDraft,
  type ChannelLimitsDraft,
} from "./channel-limits-draft";
import { type RecordValue } from "./channel-settings-types";
import { channelAccountLabel, stringField } from "./channel-settings-records";

/**
 * The Connection the Route goes on: shown when the form opened on it, picked
 * otherwise, with the way to connect a new one beside the picker.
 */
export function RouteConnectionSection({
  fixedAccount,
  account,
  channelName,
  destinationValue,
  destinationDisplay,
  destinationOptions,
  changeDestination,
  connectChannelAccount,
  namesAccount,
  connectionId,
  accountId,
  setAccountId,
  duplicateAccount,
  pending,
}: {
  fixedAccount: boolean;
  /** The Connection's account when it is shown, not picked. */
  account: RecordValue | undefined;
  channelName: (channel: string) => string;
  destinationValue: string | null;
  destinationDisplay: { label: string; description?: string } | null;
  destinationOptions: SelectFieldOption<string>[];
  changeDestination(value: string | null): void;
  connectChannelAccount: (() => void) | undefined;
  /** A Connection's first Route also names its account. */
  namesAccount: boolean;
  connectionId: string | null;
  accountId: string;
  setAccountId(value: string): void;
  duplicateAccount: boolean;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <RouteFormSection title={t("hub.routes.connection.title")}>
      {fixedAccount ? (
        <View style={styles.channelTitle}>
          <ChannelIcon channel={stringField(account, "channel") ?? undefined} size={14} />
          <Text style={settingsStyles.rowTitle}>{channelAccountLabel(account, channelName)}</Text>
        </View>
      ) : (
        <View style={styles.accountRow}>
          <View style={styles.accountSelect}>
            <SelectField
              label={t("hub.routes.connection.title")}
              field={false}
              value={destinationValue}
              selectedDisplay={destinationDisplay}
              options={destinationOptions}
              onChange={changeDestination}
              placeholder={t("hub.routes.connection.choose")}
              emptyText={t("hub.routes.connection.empty")}
              searchable={destinationOptions.length > 6}
              title={t("hub.routes.connection.title")}
              disabled={pending}
            />
          </View>
          {connectChannelAccount === undefined ? null : (
            <View style={styles.accountConnect}>
              <Text style={styles.accountOr}>{t("hub.routes.connection.or")}</Text>
              <Button
                size="sm"
                variant={destinationOptions.length === 0 ? "secondary" : "outline"}
                disabled={pending}
                onPress={connectChannelAccount}
              >
                {t("hub.routes.connection.connectNew")}
              </Button>
            </View>
          )}
        </View>
      )}
      {namesAccount ? (
        // A Connection's first Route also names the bot in Clisbot; the name
        // defaults from the Connection and is what the list shows.
        <Field
          label={t("hub.routes.connection.name")}
          error={duplicateAccount ? t("hub.routes.connection.duplicateName") : null}
        >
          <FormTextInput
            key={connectionId ?? ""}
            initialValue={accountId}
            onChangeText={setAccountId}
            placeholder="customer-support"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
      ) : null}
    </RouteFormSection>
  );
}

/** The Route's totals, folded until set, and any older per-person limit still on it. */
export function RouteLimitsSection({
  draft,
  setDraft,
  parsed,
  names,
  inUse,
  pending,
}: {
  draft: ChannelLimitsDraft;
  setDraft: Dispatch<SetStateAction<ChannelLimitsDraft>>;
  parsed: ReturnType<typeof parseChannelLimitsDraft>;
  names: readonly ChannelLimitName[];
  inUse: boolean;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const noLimits = t("hub.routes.common.noLimits");
  return (
    <FoldedRouteFormSection
      title={t("hub.routes.routeLimits.title")}
      info={t("hub.routes.routeLimits.info")}
      summary={parsed.valid ? channelLimitsSummary(parsed.value, names, noLimits) : parsed.error}
      inUse={inUse}
    >
      <ChannelLimitsFields
        names={names}
        note={false}
        draft={draft}
        setDraft={setDraft}
        defaults={NO_DEFAULTS}
        error={parsed.valid ? null : parsed.error}
        disabled={pending}
      />
      {names.length > ROUTE_TOTAL_LIMIT_NAMES.length ? (
        <Text style={settingsStyles.rowHint}>{t("hub.routes.routeLimits.legacyNote")}</Text>
      ) : null}
    </FoldedRouteFormSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  accountRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  accountSelect: {
    flexBasis: 240,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  accountConnect: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: theme.spacing[3],
  },
  accountOr: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  channelTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
