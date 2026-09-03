import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHubAccount } from "../account-provider";
import {
  HubChannelIdentitiesSchema,
  HubChannelIdentityChallengeSchema,
  HubChannelIdentitySchema,
  HubConnectionsSchema,
  HubMembersSchema,
} from "../contracts";

export function ChannelIdentitySelfLinkSettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const membershipId = hub.state?.status === "active" ? hub.state.membership.id : null;
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{
    connectionId: string;
    command: string;
    expiresAt: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const identities = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "channel-identities", "self"],
    queryFn: () => hub.api().get("channel-identities", HubChannelIdentitiesSchema),
    enabled: organizationId.length > 0 && membershipId !== null,
    retry: false,
    refetchInterval: challenge === null ? false : 3_000,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "connections", "self"],
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0 && membershipId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const channelConnections = useMemo(
    () =>
      (connections.data?.connections ?? [])
        .filter(({ provider }) => ["slack", "telegram"].includes(provider))
        .filter(({ canLinkIdentity }) => canLinkIdentity === true),
    [connections.data?.connections],
  );
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      channelConnections.map((connection) => ({
        id: connection.id,
        value: connection.id,
        label: `${providerLabel(connection.provider)} · ${connection.name}`,
        description: connection.externalName ?? undefined,
      })),
    [channelConnections],
  );
  const ownIdentities = useMemo(
    () => (identities.data?.identities ?? []).filter(({ memberId }) => memberId === membershipId),
    [identities.data?.identities, membershipId],
  );

  useEffect(() => {
    if (
      challenge !== null &&
      ownIdentities.some(
        ({ connectionId: linkedConnectionId }) => linkedConnectionId === challenge.connectionId,
      )
    ) {
      setChallenge(null);
    }
  }, [challenge, ownIdentities]);

  const createChallenge = useCallback(async () => {
    if (connectionId === null) return;
    setPending(true);
    setMutationError(null);
    try {
      const value = await hub
        .api()
        .post("channel-identities/challenges", { connectionId }, HubChannelIdentityChallengeSchema);
      setChallenge({ connectionId, ...value });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, [connectionId, hub]);

  const unlink = useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: "Unlink your Channel identity?",
        message: "Messages from this provider identity will stop resolving to your Hub account.",
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
  const setSelectedConnection = useCallback((value: string) => {
    setConnectionId(value);
    setChallenge(null);
  }, []);
  const handleCreateChallenge = useCallback(() => {
    void createChallenge();
  }, [createChallenge]);
  const copyChallenge = useCallback(() => {
    if (challenge !== null) void copyToClipboard(challenge.command);
  }, [challenge]);

  if (membershipId === null) return null;

  return (
    <SettingsSection title="Your Channel identities">
      <Alert
        variant="info"
        title="Link the account you use in Slack or Telegram"
        description="A one-use command proves that the signed-in Hub Member controls the provider identity. The code expires after 10 minutes and cannot grant new access."
      />
      <QueryFeedback queries={[identities, connections]} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      <View style={settingsStyles.card}>
        {ownIdentities.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>No provider identities are linked.</Text>
          </View>
        ) : (
          ownIdentities.map((identity, index) => {
            const connection = channelConnections.find(({ id }) => id === identity.connectionId);
            return (
              <View
                key={identity.id}
                style={[
                  settingsStyles.row,
                  styles.row,
                  index > 0 ? settingsStyles.rowBorder : null,
                ]}
              >
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {identity.displayName ?? identity.externalSubjectId}
                  </Text>
                  <Text style={settingsStyles.rowHint}>
                    {connection
                      ? `${providerLabel(connection.provider)} · ${connection.name}`
                      : "Connection unavailable"}
                  </Text>
                </View>
                <IdentityUnlinkButton identityId={identity.id} pending={pending} unlink={unlink} />
              </View>
            );
          })
        )}
      </View>
      <View style={[settingsStyles.card, styles.form]}>
        <SelectField
          label="Connection"
          value={connectionId}
          selectedDisplay={selectedOptionDisplay(connectionOptions, connectionId)}
          options={connectionOptions}
          onChange={setSelectedConnection}
          placeholder="Choose a Channel account"
          emptyText="No Channel account is available to your Hub Member."
          searchable={connectionOptions.length > 6}
          title="Connection"
          disabled={pending}
        />
        <Button disabled={pending || connectionId === null} onPress={handleCreateChallenge}>
          {pending ? "Creating code…" : "Create link code"}
        </Button>
        {challenge !== null ? (
          <>
            <Alert
              variant="success"
              title={challenge.command}
              description={`Send this exact command to the Channel account before ${new Date(challenge.expiresAt).toLocaleTimeString()}. Do not share it. This page updates automatically after the message is accepted.`}
            />
            <Button variant="outline" disabled={pending} onPress={copyChallenge}>
              Copy link command
            </Button>
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

export function ChannelIdentitySettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const canOverrideIdentity = hub.state?.status === "active" && hub.state.isInstanceOperator;
  const identities = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "channel-identities"],
    queryFn: () => hub.api().get("channel-identities", HubChannelIdentitiesSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const members = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "members"],
    queryFn: () => hub.api().get("members", HubMembersSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "connections"],
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
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
      (connections.data?.connections ?? []).filter(({ provider }) =>
        ["slack", "telegram"].includes(provider),
      ),
    [connections.data?.connections],
  );
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      channelConnections.map((connection) => ({
        id: connection.id,
        value: connection.id,
        label: `${providerLabel(connection.provider)} · ${connection.name}`,
        description: connection.externalName ?? undefined,
      })),
    [channelConnections],
  );
  const memberById = useMemo(
    () => new Map((members.data?.members ?? []).map((member) => [member.id, member])),
    [members.data?.members],
  );
  const connectionById = useMemo(
    () =>
      new Map(
        (connections.data?.connections ?? []).map((connection) => [connection.id, connection]),
      ),
    [connections.data?.connections],
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
    <SettingsSection title="Channel identities">
      <Alert
        variant="info"
        title="One Member can use several provider identities"
        description="Each identity is scoped to its Connection, so the same provider user ID in two workspaces or accounts stays distinct."
      />
      <QueryFeedback queries={[identities, ...(canManage ? [members, connections] : [])]} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      <ChannelIdentityRows
        identities={identities.data?.identities ?? []}
        members={memberById}
        connections={connectionById}
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

function ChannelIdentityRows({
  identities,
  members,
  connections,
  canManage,
  pending,
  remove,
}: {
  identities: Array<{
    id: string;
    memberId: string;
    connectionId: string;
    displayName?: string | null;
    externalSubjectId: string;
  }>;
  members: Map<string, { name: string }>;
  connections: Map<string, { provider: string; name: string }>;
  canManage: boolean;
  pending: boolean;
  remove(id: string): Promise<void>;
}) {
  if (identities.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>No Channel identities are linked.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {identities.map((identity, index) => {
        const member = members.get(identity.memberId);
        const connection = connections.get(identity.connectionId);
        const connectionLabel = connection
          ? `${providerLabel(connection.provider)} · ${connection.name}`
          : "Connection unavailable";
        return (
          <View
            key={identity.id}
            style={[settingsStyles.row, styles.row, index > 0 ? settingsStyles.rowBorder : null]}
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {`${member?.name ?? identity.displayName ?? "Member"} · ${identity.displayName ?? identity.externalSubjectId}`}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {`${connectionLabel} · ${identity.externalSubjectId}`}
              </Text>
            </View>
            {canManage ? (
              <IdentityUnlinkButton identityId={identity.id} pending={pending} unlink={remove} />
            ) : null}
          </View>
        );
      })}
    </View>
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
        emptyText="Add a Slack or Telegram Connection first."
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

function IdentityUnlinkButton({
  identityId,
  pending,
  unlink,
}: {
  identityId: string;
  pending: boolean;
  unlink(id: string): Promise<void>;
}) {
  const handlePress = useCallback(() => {
    void unlink(identityId);
  }, [identityId, unlink]);
  return (
    <Button size="xs" variant="ghost" disabled={pending} onPress={handlePress}>
      Unlink
    </Button>
  );
}

function selectedOptionDisplay(
  options: SelectFieldOption<string>[],
  value: string | null,
): { label: string; description?: string } | null {
  const option = options.find((candidate) => candidate.value === value);
  return option === undefined
    ? null
    : {
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      };
}

function providerLabel(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function QueryFeedback({
  queries,
}: {
  queries: Array<{ isPending: boolean; error: Error | null }>;
}) {
  if (queries.some((query) => query.isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
}));
