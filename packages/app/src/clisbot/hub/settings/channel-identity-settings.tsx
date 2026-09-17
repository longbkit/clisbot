import { useLocalSearchParams } from "expo-router";
import type { z } from "zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHubAccount } from "../account-provider";
import {
  channelConnectionDetail,
  channelConnectionLabel,
  channelIdentityLine,
  identityCoversConnection,
} from "../channel-identity-directory";
import type { ChannelCatalogEntry } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
import { ChannelIdentityList } from "./channel-identity-list";
import { useHubResource } from "./hub-resource";
import { hubResourceQueryKey } from "../query-keys";
import {
  HubChannelIdentitiesSchema,
  HubChannelIdentityChallengeSchema,
  HubChannelIdentitySchema,
  HubConnectionSchema,
  HubConnectionsSchema,
  HubMembersSchema,
} from "../contracts";

export function ChannelIdentitySelfLinkSettings() {
  const hub = useHubAccount();
  const params = useLocalSearchParams<{ channelConnectionId?: string }>();
  const initialConnectionId =
    typeof params.channelConnectionId === "string" && params.channelConnectionId.length > 0
      ? params.channelConnectionId
      : null;
  return (
    <ChannelIdentitySelfLinkForm
      key={JSON.stringify([
        hub.origin,
        hub.signedIn?.account.id,
        hub.signedIn?.organization.id,
        initialConnectionId,
      ])}
      initialConnectionId={initialConnectionId}
    />
  );
}

function ChannelIdentitySelfLinkForm({
  initialConnectionId,
}: {
  initialConnectionId: string | null;
}) {
  const hub = useHubAccount();
  const catalog = useChannelCatalog();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const queryScope = { origin: hub.origin, organizationId, accountId };
  const membershipId = hub.signedIn?.membership.id ?? null;
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId);
  const [challenge, setChallenge] = useState<{
    connectionId: string;
    command: string;
    expiresAt: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const identities = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "channel-identities"), "self"],
    queryFn: () => hub.api().get("channel-identities", HubChannelIdentitiesSchema),
    enabled: organizationId.length > 0 && membershipId !== null,
    retry: false,
    refetchInterval: challenge === null ? false : 3_000,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "connections"), "self"],
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0 && membershipId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const allConnections = connections.data?.connections;
  const ownIdentities = useMemo(
    () => (identities.data?.identities ?? []).filter(({ memberId }) => memberId === membershipId),
    [identities.data?.identities, membershipId],
  );
  const {
    channelConnections,
    isLinked,
    connectionOptions,
    selectedConnection,
    selectedConnectionId,
    requestedReady,
    requestedLinked,
    emptyText,
  } = useLinkableConnections({
    connections: allConnections,
    ownIdentities,
    identitiesLoaded: identities.data !== undefined,
    catalog: catalog.entries,
    connectionId,
    requestedConnectionId: initialConnectionId,
  });

  // The link landed: its workspace leaves the options, so drop the code and the choice.
  useEffect(() => {
    const challenged = channelConnections.find(({ id }) => id === challenge?.connectionId);
    if (challenged !== undefined && isLinked(challenged)) {
      setChallenge(null);
      setConnectionId(null);
    }
  }, [challenge, channelConnections, isLinked]);

  const createChallenge = useCallback(async () => {
    if (selectedConnection === undefined) return;
    setPending(true);
    setMutationError(null);
    try {
      const value = await hub
        .api()
        .post(
          "channel-identities/challenges",
          { connectionId: selectedConnection.id },
          HubChannelIdentityChallengeSchema,
        );
      setChallenge({ connectionId: selectedConnection.id, ...value });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, [selectedConnection, hub]);

  const unlink = useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: "Unlink your Channel identity?",
        message:
          "Messages from this provider identity will stop resolving to your Hub account on every bot of its workspace.",
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
    setMutationError(null);
  }, []);
  const handleCreateChallenge = useCallback(() => {
    void createChallenge();
  }, [createChallenge]);
  const refresh = useCallback(() => {
    void Promise.all([identities.refetch(), connections.refetch()]);
  }, [identities, connections]);

  if (membershipId === null) return null;

  return (
    <View>
      <SettingsSection title="Channel identity setup">
        <Alert
          variant="info"
          title="Link the account you use in Slack or Telegram"
          description="Choose the Connection used by your Channel account, create a one-use command, then send it from your own Slack or Telegram account. The command verifies your identity; your existing organization access stays unchanged."
        />
        <QueryFeedback queries={[identities, connections]} />
        <Button size="sm" variant="outline" disabled={pending} onPress={refresh}>
          Refresh identities
        </Button>
        <RequestedConnectionFeedback
          requested={initialConnectionId}
          ready={requestedReady}
          selected={selectedConnection !== undefined}
          alreadyLinked={requestedLinked}
        />
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      </SettingsSection>
      <SettingsSection title="Linked identities">
        {identities.data !== undefined ? (
          <View style={settingsStyles.card}>
            {ownIdentities.length === 0 ? (
              <View style={settingsStyles.row}>
                <Text style={settingsStyles.rowHint}>No provider identities are linked.</Text>
              </View>
            ) : (
              ownIdentities.map((identity, index) => (
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
                      {channelIdentityLine(catalog.entries, identity, allConnections ?? [])}
                    </Text>
                  </View>
                  <IdentityUnlinkButton
                    identityId={identity.id}
                    pending={pending}
                    unlink={unlink}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Link a new identity">
        <View style={[settingsStyles.card, styles.form]}>
          <SelectField
            label="Connection"
            value={selectedConnectionId}
            selectedDisplay={selectedOptionDisplay(connectionOptions, connectionId)}
            options={connectionOptions}
            onChange={setSelectedConnection}
            placeholder="Choose a Channel account"
            emptyText={emptyText}
            searchable={connectionOptions.length > 6}
            title="Connection"
            disabled={pending}
          />
          <Button
            disabled={pending || selectedConnection === undefined}
            onPress={handleCreateChallenge}
          >
            {pending ? "Creating code…" : "Create link code"}
          </Button>
          {challenge !== null ? (
            <ChannelIdentityChallenge
              key={challenge.command}
              challenge={challenge}
              provider={selectedConnection?.provider}
              pending={pending}
              reportError={setMutationError}
            />
          ) : null}
        </View>
      </SettingsSection>
    </View>
  );
}

/**
 * The Connections the Member may link through, less those whose realm (a Slack
 * workspace, or Telegram) is already linked: one link covers every bot of a realm.
 */
type HubConnection = z.infer<typeof HubConnectionSchema>;
type HubChannelIdentity = z.infer<typeof HubChannelIdentitySchema>;

function useLinkableConnections({
  connections,
  ownIdentities,
  identitiesLoaded,
  catalog,
  connectionId,
  requestedConnectionId,
}: {
  connections: readonly HubConnection[] | undefined;
  ownIdentities: readonly HubChannelIdentity[];
  identitiesLoaded: boolean;
  catalog: readonly ChannelCatalogEntry[];
  connectionId: string | null;
  requestedConnectionId: string | null;
}) {
  const channelConnections = useMemo(
    () =>
      (connections ?? [])
        .filter(({ provider }) => ["slack", "telegram"].includes(provider))
        .filter(({ canLinkIdentity }) => canLinkIdentity === true),
    [connections],
  );
  const isLinked = useCallback(
    (connection: HubConnection) =>
      ownIdentities.some((identity) => identityCoversConnection(identity, connection)),
    [ownIdentities],
  );
  const unlinkedConnections = useMemo(
    () => channelConnections.filter((connection) => !isLinked(connection)),
    [channelConnections, isLinked],
  );
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      unlinkedConnections.map((connection) => ({
        id: connection.id,
        value: connection.id,
        label: channelConnectionLabel(catalog, [connection]),
        description: channelConnectionDetail(connection),
      })),
    // The catalog arrives after the Connections do; without it here the options
    // would keep the fallback label for the rest of the session.
    [unlinkedConnections, catalog],
  );
  const requested = channelConnections.find(({ id }) => id === requestedConnectionId);
  const selectedConnection = unlinkedConnections.find(({ id }) => id === connectionId);
  return {
    channelConnections,
    isLinked,
    connectionOptions,
    selectedConnection,
    selectedConnectionId: selectedConnection?.id ?? null,
    requestedReady: connections !== undefined && identitiesLoaded,
    requestedLinked: requested !== undefined && isLinked(requested),
    emptyText:
      channelConnections.length > 0
        ? "Every Slack workspace and Telegram account available to you is already linked."
        : "No Channel account is available to your Hub Member.",
  };
}

function RequestedConnectionFeedback({
  requested,
  ready,
  selected,
  alreadyLinked,
}: {
  requested: string | null;
  ready: boolean;
  selected: boolean;
  alreadyLinked: boolean;
}) {
  if (requested === null || !ready || selected) return null;
  if (alreadyLinked) {
    return (
      <Alert
        variant="info"
        title="You are already linked here"
        description="Your identity is linked for this Connection's workspace, so every bot in it already recognizes you. Send your message again."
      />
    );
  }
  return (
    <Alert
      variant="warning"
      title="The requested Connection is unavailable"
      description="Refresh or choose another Connection. Ask an owner to check your Channel access if the expected Slack or Telegram account is missing."
    />
  );
}

function ChannelIdentityChallenge({
  challenge,
  provider,
  pending,
  reportError,
}: {
  challenge: { command: string; expiresAt: string };
  provider: string | undefined;
  pending: boolean;
  reportError(value: string): void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void copyToClipboard(challenge.command)
      .then(() => setCopied(true))
      .catch((error: unknown) =>
        reportError(
          error instanceof Error
            ? error.message
            : "Unable to copy. Copy the command shown above manually.",
        ),
      );
  }, [challenge.command, reportError]);
  const instruction =
    provider === "slack"
      ? "In Slack, mention the bot, then paste this command in a message in a conversation where the bot is present. Send it from your own Slack account."
      : "Send this command from your own Telegram account to the selected bot.";
  return (
    <>
      <Alert
        variant="info"
        title={challenge.command}
        description={`${instruction} Use it before ${new Date(challenge.expiresAt).toLocaleTimeString()}. Do not share it. After your identity appears here, send your original message again.`}
      />
      <Button variant="outline" disabled={pending} onPress={copy}>
        {copied ? "Copied link command" : "Copy link command"}
      </Button>
    </>
  );
}

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
      info="One Member can use several provider identities. Each identity is scoped to its Connection, so the same provider user ID in two workspaces or accounts stays distinct."
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
