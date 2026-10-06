import { type Dispatch, type SetStateAction } from "react";
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
  return (
    <RouteFormSection title="Connection">
      {fixedAccount ? (
        <View style={styles.channelTitle}>
          <ChannelIcon channel={stringField(account, "channel") ?? undefined} size={14} />
          <Text style={settingsStyles.rowTitle}>{channelAccountLabel(account, channelName)}</Text>
        </View>
      ) : (
        <View style={styles.accountRow}>
          <View style={styles.accountSelect}>
            <SelectField
              label="Connection"
              field={false}
              value={destinationValue}
              selectedDisplay={destinationDisplay}
              options={destinationOptions}
              onChange={changeDestination}
              placeholder="Choose a Connection"
              emptyText="Nothing is connected yet."
              searchable={destinationOptions.length > 6}
              title="Connection"
              disabled={pending}
            />
          </View>
          {connectChannelAccount === undefined ? null : (
            <View style={styles.accountConnect}>
              <Text style={styles.accountOr}>Or</Text>
              <Button
                size="sm"
                variant={destinationOptions.length === 0 ? "secondary" : "outline"}
                disabled={pending}
                onPress={connectChannelAccount}
              >
                Connect a new one
              </Button>
            </View>
          )}
        </View>
      )}
      {namesAccount ? (
        // A Connection's first Route also names the bot in Clisbot; the name
        // defaults from the Connection and is what the list shows.
        <Field
          label="Name"
          error={duplicateAccount ? "Another Connection on this channel uses this name." : null}
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
  return (
    <FoldedRouteFormSection
      title="Route limits"
      info={LIMITS_INFO}
      summary={parsed.valid ? channelLimitsSummary(parsed.value, names, "No limits") : parsed.error}
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
        <Text style={settingsStyles.rowHint}>{LEGACY_ROUTE_LIMITS_NOTE}</Text>
      ) : null}
    </FoldedRouteFormSection>
  );
}

const LIMITS_INFO =
  "Totals for every Rule of this Route together, across every conversation it matches. Over a limit, messages and runs wait their turn. Limits for the people who come in are on each Rule; the bot's own, including Bot messages per minute, are on the Connection, under Limits.";
const LEGACY_ROUTE_LIMITS_NOTE =
  "Limits under the totals were set on the Route by an earlier version and still apply to everyone on it. Per-person limits now belong on each Rule, and Bot messages per minute on the Connection.";

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
