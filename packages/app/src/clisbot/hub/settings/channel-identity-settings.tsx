import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import { channelConnectionDetail, channelConnectionLabel } from "../channel-identity-directory";
import { useChannelCatalog } from "./channel-catalog-queries";
import { QueryFeedback, selectedOptionDisplay } from "./channel-identity-form-parts";
import { ChannelIdentityList } from "./channel-identity-list";
import { useHubResource } from "./hub-resource";
import {
  HubChannelIdentitiesSchema,
  HubChannelIdentitySchema,
  HubConnectionsSchema,
  HubMembersSchema,
} from "../contracts";

export { ChannelIdentitySelfLinkSettings } from "./channel-identity-self-link";

export function ChannelIdentitySettings() {
  const hub = useHubAccount();
  const catalog = useChannelCatalog();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const canOverrideIdentity = hub.signedIn?.isInstanceOperator === true;
  // Same queries as the Team settings screen, so the tab reuses what the screen already loaded.
  const identities = useHubResource("channel-identities", HubChannelIdentitiesSchema);
  const members = useHubResource("members", HubMembersSchema, canManage);
  const connections = useHubResource("connections", HubConnectionsSchema, canManage);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [externalSubjectId, setExternalSubjectId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const memberOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      (members.data?.members ?? []).map((member) => ({
        id: member.id,
        value: member.id,
        label: member.name,
        description: member.email,
      })),
    [members.data?.members],
  );
  const channelConnections = useMemo(
    () =>
      (connections.data?.connections ?? []).filter(
        ({ identityRealm }) => typeof identityRealm === "string",
      ),
    [connections.data?.connections],
  );
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      channelConnections.map((connection) => ({
        id: connection.id,
        value: connection.id,
        label: channelConnectionLabel(catalog.entries, [connection]),
        description: channelConnectionDetail(connection),
      })),
    // The catalog arrives after the Connections do; without it here the options
    // would keep the fallback label for the rest of the session.
    [channelConnections, catalog.entries],
  );

  const remove = useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: "Unlink Channel identity?",
        message: "Messages from this provider identity will no longer resolve to the Hub Member.",
        confirmLabel: "Unlink identity",
        destructive: true,
      });
      if (!confirmed) return;
      setPending(true);
      setMutationError(null);
      try {
        await hub.api().delete(`channel-identities/${encodeURIComponent(id)}`);
        await identities.refetch();
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [hub, identities],
  );

  const link = useCallback(async () => {
    if (memberId === null || connectionId === null || externalSubjectId.trim().length === 0) return;
    setPending(true);
    setMutationError(null);
    try {
      await hub.api().post(
        "channel-identities",
        {
          memberId,
          connectionId,
          externalSubjectId: externalSubjectId.trim(),
          displayName: displayName.trim() || null,
        },
        HubChannelIdentitySchema,
      );
      setExternalSubjectId("");
      setDisplayName("");
      await identities.refetch();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, [connectionId, displayName, externalSubjectId, hub, identities, memberId]);
  const handleLink = useCallback(() => {
    void link();
  }, [link]);

  return (
    <SettingsSection
      title="Channel identities"
      info="One Member can link several chat accounts. A link covers its identity realm: every Telegram, Discord, or Google Chat bot; one Slack workspace; or one Feishu or Zalo bot. The same user ID in another realm stays distinct."
    >
      <QueryFeedback queries={[identities, ...(canManage ? [members, connections] : [])]} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      <ChannelIdentityList
        identities={identities.data?.identities ?? []}
        members={canManage ? members.data?.members : undefined}
        connections={connections.data?.connections}
        canManage={canManage}
        pending={pending}
        remove={remove}
      />
      <IdentityOverridePanel
        canManage={canManage}
        canOverrideIdentity={canOverrideIdentity}
        memberId={memberId}
        memberOptions={memberOptions}
        setMemberId={setMemberId}
        connectionId={connectionId}
        connectionOptions={connectionOptions}
        setConnectionId={setConnectionId}
        identityCount={identities.data?.identities.length ?? 0}
        setExternalSubjectId={setExternalSubjectId}
        setDisplayName={setDisplayName}
        canLink={identityCanBeLinked(pending, memberId, connectionId, externalSubjectId)}
        pending={pending}
        link={handleLink}
      />
    </SettingsSection>
  );
}

function identityCanBeLinked(
  pending: boolean,
  memberId: string | null,
  connectionId: string | null,
  externalSubjectId: string,
): boolean {
  return (
    !pending && memberId !== null && connectionId !== null && externalSubjectId.trim().length > 0
  );
}

function IdentityOverridePanel({
  canManage,
  canOverrideIdentity,
  memberId,
  memberOptions,
  setMemberId,
  connectionId,
  connectionOptions,
  setConnectionId,
  identityCount,
  setExternalSubjectId,
  setDisplayName,
  canLink,
  pending,
  link,
}: {
  canManage: boolean;
  canOverrideIdentity: boolean;
  memberId: string | null;
  memberOptions: SelectFieldOption<string>[];
  setMemberId(value: string): void;
  connectionId: string | null;
  connectionOptions: SelectFieldOption<string>[];
  setConnectionId(value: string): void;
  identityCount: number;
  setExternalSubjectId(value: string): void;
  setDisplayName(value: string): void;
  canLink: boolean;
  pending: boolean;
  link(): void;
}) {
  if (!canManage) return null;
  if (!canOverrideIdentity) {
    return (
      <Alert
        variant="info"
        title="Provider verification required"
        description="Ask the Member to link their identity through the provider verification flow. Raw provider IDs cannot be assigned by an organization administrator."
      />
    );
  }
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <SelectField
        label="Hub Member"
        value={memberId}
        selectedDisplay={selectedOptionDisplay(memberOptions, memberId)}
        options={memberOptions}
        onChange={setMemberId}
        placeholder="Choose a Member"
        emptyText="Invite a Member first."
        searchable={memberOptions.length > 6}
        title="Hub Member"
        disabled={pending}
      />
      <SelectField
        label="Connection"
        value={connectionId}
        selectedDisplay={selectedOptionDisplay(connectionOptions, connectionId)}
        options={connectionOptions}
        onChange={setConnectionId}
        placeholder="Choose a provider Connection"
        emptyText="Add a chat bot Connection first."
        searchable={connectionOptions.length > 6}
        title="Connection"
        disabled={pending}
      />
      <Field
        label="Provider user ID"
        hint="Use the raw provider ID, for example Slack U0123 or a Telegram numeric user ID."
      >
        <FormTextInput
          initialValue=""
          resetKey={identityCount}
          onChangeText={setExternalSubjectId}
          placeholder="U0123"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <Field label="Display name" hint="Optional; used only to make this mapping recognizable.">
        <FormTextInput
          initialValue=""
          resetKey={identityCount}
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
        description="Use this only after verifying the provider identity out of band. The Hub records who linked it and when. Normal Member linking uses provider verification."
      />
      <Button disabled={!canLink} onPress={link}>
        Link identity
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
}));
