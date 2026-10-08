import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        label={t("hub.channels.idLink.where")}
        value={connectionId}
        selectedDisplay={selectedOptionDisplay(options, connectionId)}
        options={options}
        onChange={setConnectionId}
        placeholder={t("hub.channels.idLink.wherePlaceholder")}
        emptyText={t("hub.channels.idLink.whereEmpty")}
        searchable={options.length > 6}
        title={t("hub.channels.idLink.where")}
        disabled={pending}
      />
      <Field label={t("hub.channels.idLink.user")} hint={t("hub.channels.idLink.userHint")}>
        <FormTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={setUser}
          placeholder={t("hub.channels.idLink.userPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <Field label={t("hub.channels.idLink.name")} hint={t("hub.channels.idLink.nameHint")}>
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
        title={t("hub.channels.idLink.overrideTitle")}
        description={t("hub.channels.idLink.overrideBody")}
      />
      <Button
        disabled={pending || connectionId === null || user.trim().length === 0}
        onPress={submit}
      >
        {t("hub.channels.idLink.submit")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
}));
