import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import { channelIdentityLine, useChannelIdentityReads } from "../channel-identity-directory";
import type { ChannelCatalogEntry } from "../channel-catalog";
import { CopyableCommand } from "../copyable-command";
import { useChannelCatalog } from "./channel-catalog-queries";
import { QueryFeedback, selectedOptionDisplay } from "./channel-identity-form-parts";
import {
  useLinkRealms,
  type HubChannelIdentity,
  type HubConnection,
  type LinkRealm,
} from "./channel-identity-link-realms";
import { HubChannelIdentityChallengeSchema } from "../contracts";

interface IssuedChallenge {
  realm: LinkRealm;
  command: string;
  expiresAt: string;
}

type RunMutation = (action: () => Promise<void>) => Promise<void>;

export function ChannelIdentitySelfLinkSettings() {
  const hub = useHubAccount();
  const params = useLocalSearchParams<{ channelConnectionId?: string }>();
  const requestedConnectionId =
    typeof params.channelConnectionId === "string" && params.channelConnectionId.length > 0
      ? params.channelConnectionId
      : null;
  return (
    <ChannelIdentitySelfLinkForm
      key={JSON.stringify([
        hub.origin,
        hub.signedIn?.account.id,
        hub.signedIn?.organization.id,
        requestedConnectionId,
      ])}
      requestedConnectionId={requestedConnectionId}
    />
  );
}

function ChannelIdentitySelfLinkForm({
  requestedConnectionId,
}: {
  requestedConnectionId: string | null;
}) {
  const catalog = useChannelCatalog();
  const mutation = useMutationState();
  const [chosenRealmKey, setChosenRealmKey] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null);
  const [landed, setLanded] = useState<LinkRealm | null>(null);
  const reads = useOwnChannelIdentities(challenge !== null);
  const realms = useLinkRealms({
    connections: reads.connections.data?.connections,
    ownIdentities: reads.ownIdentities,
    identitiesLoaded: reads.identities.data !== undefined,
    catalog: catalog.entries,
    chosenRealmKey,
    requestedConnectionId,
  });
  const onLanded = useCallback((realm: LinkRealm) => {
    setLanded(realm);
    setChallenge(null);
    setChosenRealmKey(null);
  }, []);
  useDropLandedChallenge(challenge, realms.isLinked, onLanded);
  const onIssued = useCallback((issued: IssuedChallenge) => {
    setLanded(null);
    setChallenge(issued);
  }, []);
  const createChallenge = useCreateChallenge(
    realms.selected,
    requestedConnectionId,
    mutation.run,
    onIssued,
  );
  const unlink = useUnlinkIdentity(mutation.run, reads.identities.refetch);
  const { setError } = mutation;
  const chooseRealm = useCallback(
    (value: string) => {
      setChosenRealmKey(value);
      setChallenge(null);
      setError(null);
    },
    [setError],
  );

  if (reads.membershipId === null) return null;
  return (
    <View>
      <SettingsSection title="Channel identity setup">
        <Alert
          variant="info"
          title="Link the accounts you chat from"
          description="Link once for each place you chat — a Slack workspace, or all of Telegram, Discord, or Google Chat — and every bot there recognizes you. Feishu and Zalo bots are linked one at a time. Linking only proves who you are; what you can do still follows the access you were given."
        />
        <QueryFeedback queries={[reads.identities, reads.connections]} />
        <RefreshButton reads={reads} pending={mutation.pending} />
        <RequestedConnectionFeedback
          requested={requestedConnectionId}
          ready={realms.requestedReady}
          selected={realms.selected !== undefined}
          alreadyLinked={realms.requestedLinked}
        />
        {mutation.error ? <Alert variant="error" title={mutation.error} /> : null}
      </SettingsSection>
      <LinkedIdentitiesSection
        loaded={reads.identities.data !== undefined}
        ownIdentities={reads.ownIdentities}
        connections={reads.connections.data?.connections ?? []}
        catalog={catalog.entries}
        pending={mutation.pending}
        unlink={unlink}
      />
      <LinkRealmSection
        realms={realms}
        chooseRealm={chooseRealm}
        createChallenge={createChallenge}
        challenge={challenge}
        landed={landed}
        pending={mutation.pending}
      />
    </View>
  );
}

function useOwnChannelIdentities(pollWhileLinking: boolean) {
  const hub = useHubAccount();
  const membershipId = hub.signedIn?.membership.id ?? null;
  const { identities, connections } = useChannelIdentityReads({
    enabled: membershipId !== null,
    refetchIntervalMs: pollWhileLinking ? 3_000 : false,
  });
  const ownIdentities = useMemo(
    () => (identities.data?.identities ?? []).filter(({ memberId }) => memberId === membershipId),
    [identities.data?.identities, membershipId],
  );
  return { membershipId, identities, connections, ownIdentities };
}

/** One pending flag and one error for every Hub write on the screen. */
function useMutationState() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback<RunMutation>(async (action) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Hub request failed.");
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, setError, run };
}

/** The link landed: its realm leaves the options, so the code and the choice go. */
function useDropLandedChallenge(
  challenge: IssuedChallenge | null,
  isLinked: (key: string) => boolean,
  onLanded: (realm: LinkRealm) => void,
) {
  useEffect(() => {
    if (challenge !== null && isLinked(challenge.realm.key)) onLanded(challenge.realm);
  }, [challenge, isLinked, onLanded]);
}

function useCreateChallenge(
  realm: LinkRealm | undefined,
  requestedConnectionId: string | null,
  run: RunMutation,
  onIssued: (challenge: IssuedChallenge) => void,
) {
  const hub = useHubAccount();
  return useCallback(() => {
    if (realm === undefined) return;
    // Any bot of the realm redeems the code; prefer the one the Member came from.
    const through =
      realm.connections.find(({ id }) => id === requestedConnectionId) ?? realm.connections[0];
    void run(async () => {
      const value = await hub
        .api()
        .post(
          "channel-identities/challenges",
          { connectionId: through.id },
          HubChannelIdentityChallengeSchema,
        );
      onIssued({ realm, ...value });
    });
  }, [realm, requestedConnectionId, run, hub, onIssued]);
}

function useUnlinkIdentity(run: RunMutation, refetch: () => Promise<unknown>) {
  const hub = useHubAccount();
  return useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: "Unlink your Channel identity?",
        message:
          "Messages from this account will stop resolving to your Hub account on every bot this link covers.",
        confirmLabel: "Unlink identity",
        destructive: true,
      });
      if (!confirmed) return;
      await run(async () => {
        await hub.api().delete(`channel-identities/${encodeURIComponent(id)}`);
        await refetch();
      });
    },
    [hub, run, refetch],
  );
}

function RefreshButton({
  reads,
  pending,
}: {
  reads: ReturnType<typeof useOwnChannelIdentities>;
  pending: boolean;
}) {
  const { identities, connections } = reads;
  const refresh = useCallback(() => {
    void Promise.all([identities.refetch(), connections.refetch()]);
  }, [identities, connections]);
  return (
    <Button size="sm" variant="outline" disabled={pending} onPress={refresh}>
      Refresh identities
    </Button>
  );
}

function LinkRealmSection({
  realms,
  chooseRealm,
  createChallenge,
  challenge,
  landed,
  pending,
}: {
  realms: ReturnType<typeof useLinkRealms>;
  chooseRealm(value: string): void;
  createChallenge(): void;
  challenge: IssuedChallenge | null;
  landed: LinkRealm | null;
  pending: boolean;
}) {
  const selectedKey = realms.selected?.key ?? null;
  return (
    <SettingsSection title="Link a new identity">
      <View style={[settingsStyles.card, styles.form]}>
        {landed === null ? null : <LinkedNotice realm={landed} />}
        {realms.options.length === 0 ? (
          <Text style={settingsStyles.rowHint}>{realms.emptyText}</Text>
        ) : (
          <>
            <SelectField
              label="Where you chat"
              value={selectedKey}
              selectedDisplay={selectedOptionDisplay(realms.options, selectedKey)}
              options={realms.options}
              onChange={chooseRealm}
              placeholder="Choose where you chat"
              emptyText={realms.emptyText}
              searchable={realms.options.length > 6}
              title="Where you chat"
              disabled={pending}
            />
            <Button disabled={pending || realms.selected === undefined} onPress={createChallenge}>
              {pending ? "Creating code…" : "Create link code"}
            </Button>
          </>
        )}
        {challenge === null ? null : (
          <ChannelIdentityChallenge key={challenge.command} challenge={challenge} />
        )}
      </View>
    </SettingsSection>
  );
}

function LinkedIdentitiesSection({
  loaded,
  ownIdentities,
  connections,
  catalog,
  pending,
  unlink,
}: {
  loaded: boolean;
  ownIdentities: readonly HubChannelIdentity[];
  connections: readonly HubConnection[];
  catalog: readonly ChannelCatalogEntry[];
  pending: boolean;
  unlink(id: string): Promise<void>;
}) {
  if (!loaded) return <SettingsSection title="Linked identities">{null}</SettingsSection>;
  return (
    <SettingsSection title="Linked identities">
      <View style={settingsStyles.card}>
        {ownIdentities.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>No chat accounts are linked yet.</Text>
          </View>
        ) : (
          ownIdentities.map((identity, index) => (
            <View
              key={identity.id}
              style={[settingsStyles.row, styles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {identity.displayName ?? identity.externalSubjectId}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {channelIdentityLine(catalog, identity, connections)}
                </Text>
              </View>
              <IdentityUnlinkButton identityId={identity.id} pending={pending} unlink={unlink} />
            </View>
          ))
        )}
      </View>
    </SettingsSection>
  );
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
        description="The bot that sent you here already recognizes you. Send your message again."
      />
    );
  }
  return (
    <Alert
      variant="warning"
      title="That bot is no longer available"
      description="Refresh, or choose where you chat below. Ask an owner if the bot you expected is missing."
    />
  );
}

/** What a landed link now covers, so nobody links the same place bot by bot. */
function LinkedNotice({ realm }: { realm: LinkRealm }) {
  const reach =
    realm.scope === "bot"
      ? `${realm.label} now recognizes you. ${realm.channelLabel} gives each bot its own user ids, so link other ${realm.channelLabel} bots separately.`
      : `Every bot here now recognizes you: ${realm.botNames.join(", ")}.`;
  return (
    <Alert
      variant="success"
      title={`Linked: ${realm.label}`}
      description={`${reach} Send your original message again.`}
    />
  );
}

/** Where and how to send the code on this realm's Channel. */
function linkInstruction(realm: LinkRealm): string {
  const bots = realm.botNames.join(", ");
  if (realm.provider === "slack") {
    const who = realm.scope === "bot" ? "the bot" : "any bot of this workspace";
    return `In Slack, mention ${who} (${bots}) in a conversation where it is present, then paste this command in that message. Send it from your own Slack account.`;
  }
  const target = realm.scope === "bot" ? `the bot ${bots}` : `any one of these bots: ${bots}`;
  return `Send this command from your own ${realm.channelLabel} account to ${target}. In a direct message send it as is; in a group, mention the bot in the same message.`;
}

// setTimeout fires at once past this delay, so a far deadline waits in steps.
const MAX_TIMER_MS = 2_147_483_647;

function useExpired(expiresAt: string): boolean {
  const deadline = new Date(expiresAt).getTime();
  const [expired, setExpired] = useState(() => Date.now() >= deadline);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (expired) return;
    const remaining = Math.max(deadline - Date.now(), 0);
    const timer = setTimeout(
      () => (remaining > MAX_TIMER_MS ? setTick((current) => current + 1) : setExpired(true)),
      Math.min(remaining, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [deadline, expired, tick]);
  return expired;
}

function ChannelIdentityChallenge({ challenge }: { challenge: IssuedChallenge }) {
  const expired = useExpired(challenge.expiresAt);
  if (expired) {
    return (
      <Alert
        variant="warning"
        title="This link code expired"
        description="Create a new code and send it within its time limit."
      />
    );
  }
  return (
    <View style={styles.challenge}>
      <Text style={settingsStyles.rowHint}>{linkInstruction(challenge.realm)}</Text>
      <CopyableCommand command={challenge.command} copyLabel="Copy link command" />
      <Text style={settingsStyles.rowHint}>
        {`Use it once before ${new Date(challenge.expiresAt).toLocaleTimeString()}, and do not share it. Waiting for your message — this page updates by itself.`}
      </Text>
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
  challenge: {
    gap: theme.spacing[2],
  },
}));
