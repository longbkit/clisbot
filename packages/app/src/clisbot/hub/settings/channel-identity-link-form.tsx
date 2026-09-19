import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import type { ChannelCatalogEntry } from "../channel-catalog";
import { channelConnectionDetail, channelConnectionLabel } from "../channel-identity-directory";
import { selectedOptionDisplay } from "./channel-identity-form-parts";
import type { HubConnection } from "./team/types";

export interface ChannelIdentityLinkBody {
  memberId: string;
  connectionId: string;
  externalSubjectId: string;
  displayName: string | null;
}

/**
 * An instance operator links a chat account to a Member by its raw provider id, after verifying
 * the person out of band. Members link their own accounts from Account → Chat accounts.
 */
export function ChannelIdentityLinkForm({
  memberId,
  connections,
  catalog,
  pending,
  link,
}: {
  memberId: string;
  connections: readonly HubConnection[];
  catalog: readonly ChannelCatalogEntry[];
  pending: boolean;
  link(body: ChannelIdentityLinkBody): Promise<boolean>;
}) {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      connections
        .filter(({ identityRealm }) => typeof identityRealm === "string")
        .map((connection) => ({
          id: connection.id,
          value: connection.id,
          label: channelConnectionLabel(catalog, [connection]),
          description: channelConnectionDetail(connection),
        })),
    // The catalog arrives after the Connections do; without it here the labels would keep the
    // fallback name for the rest of the session.
    [catalog, connections],
  );
  const submit = useCallback(() => {
    if (connectionId === null) return;
    void (async () => {
      const done = await link({
        memberId,
        connectionId,
        externalSubjectId: user.trim(),
        displayName: displayName.trim() || null,
      });
      if (!done) return;
      setUser("");
      setDisplayName("");
      setResetKey((key) => key + 1);
    })();
  }, [connectionId, displayName, link, memberId, user]);
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <SelectField
        label="Where they chat"
        value={connectionId}
        selectedDisplay={selectedOptionDisplay(options, connectionId)}
        options={options}
        onChange={setConnectionId}
        placeholder="Choose a bot or workspace"
        emptyText="Add a chat bot Connection first."
        searchable={options.length > 6}
        title="Where they chat"
        disabled={pending}
      />
      <Field
        label="User"
        hint="The person's id on that bot: Slack U0123, or a Telegram numeric user id."
      >
        <FormTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={setUser}
          placeholder="U0123 or 123456789"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <Field label="Display name" hint="Optional; only to make this link recognizable.">
        <FormTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={setDisplayName}
          placeholder="@long"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <Alert
        variant="warning"
        title="Instance operator override"
        description="Use this only after verifying the chat account out of band. The Hub records who linked it and when."
      />
      <Button
        disabled={pending || connectionId === null || user.trim().length === 0}
        onPress={submit}
      >
        Link chat account
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
}));
