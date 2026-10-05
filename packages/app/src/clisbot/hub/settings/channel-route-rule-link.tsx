// Link my channel account, in place: the Route form issues the same `/link`
// code Account settings does, shows it, and turns green when the link lands —
// the person configuring a Rule that names them never leaves the form.

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { channelCatalogLabel } from "../channel-catalog";
import type { ChannelConfigurationRecord } from "../channel-configuration";
import { HubChannelIdentityChallengeSchema } from "../contracts";
import { CopyableCommand } from "../copyable-command";
import type { HubConnection } from "./channel-identity-link-realms";
import { useChannelCatalog } from "./channel-catalog-queries";
import { routeAudienceDraft } from "./channel-route-audience";
import {
  ruleLetsIn,
  unlinkedSelf,
  useRulePeople,
  type RulePeople,
} from "./channel-route-rule-people";
import { useExpired } from "./use-expired";

interface Challenge {
  command: string;
  expiresAt: string;
}

const POLL_MS = 3_000;
const NO_TEAMS: readonly never[] = [];

/**
 * On a Connection's card, after its Routes are saved: the Member using the app
 * is named by one of its Rules but the bot cannot recognize them, so those
 * Rules let them in nowhere. The same in-place link the Route form offers.
 */
export function ConnectionSelfLink({
  account,
  connection,
}: {
  account: ChannelConfigurationRecord;
  connection: HubConnection | undefined;
}) {
  const catalog = useChannelCatalog();
  const enabled = account["enabled"] !== false;
  const people = useRulePeople({
    connection,
    teams: NO_TEAMS,
    watchLinks: false,
    listening: enabled,
  });
  const self = unlinkedSelf(people);
  const named = useMemo(() => {
    if (self === undefined) return false;
    const routes = Array.isArray(account["routes"]) ? account["routes"] : [];
    return routes.some(
      (route) =>
        typeof route === "object" &&
        route !== null &&
        routeAudienceDraft(route as ChannelConfigurationRecord).some((rule) =>
          ruleLetsIn(rule, self),
        ),
    );
  }, [account, self]);
  // A disabled Connection answers nothing, a `/link` included.
  if (!named || !enabled || people.connection === undefined) return null;
  const channel = typeof account["channel"] === "string" ? account["channel"] : null;
  const channelName =
    channel === null ? "the channel" : channelCatalogLabel(catalog.entries, channel);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <LinkMyAccount connection={people.connection} channelName={channelName} people={people}>
        <Text style={settingsStyles.rowHint}>
          {`The bot can't recognize you on ${channelName} yet, so the Rules that name you do not let you in.`}
        </Text>
      </LinkMyAccount>
    </View>
  );
}

export function LinkMyAccount({
  connection,
  channelName,
  people,
  children,
}: {
  connection: HubConnection;
  channelName: string;
  people: RulePeople;
  /** Why the link matters here, above the button. */
  children: ReactNode;
}) {
  const hub = useHubAccount();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const issue = useCallback(() => {
    setPending(true);
    setError(null);
    void hub
      .api()
      .post(
        "channel-identities/challenges",
        { connectionId: connection.id },
        HubChannelIdentityChallengeSchema,
      )
      .then(setChallenge)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "The Hub could not create a code."),
      )
      .finally(() => setPending(false));
  }, [connection.id, hub]);
  if (connection.canLinkIdentity === false) {
    return (
      <Alert
        variant="warning"
        title={`The bot can't recognize you on ${channelName} yet`}
        description="Link your account from Account settings → Linked identities."
      />
    );
  }
  return (
    <View style={[settingsStyles.card, styles.panel]}>
      {children}
      {challenge === null ? (
        <View style={styles.action}>
          <Button size="sm" variant="outline" disabled={pending} onPress={issue}>
            {pending ? "Creating code…" : `Link my ${channelName} account`}
          </Button>
        </View>
      ) : (
        // Keyed by the code, so a new code starts unexpired.
        <IssuedCode
          key={challenge.command}
          challenge={challenge}
          channelName={channelName}
          reissue={issue}
          pending={pending}
          refresh={people.refresh}
        />
      )}
      {error === null ? null : <Text style={settingsStyles.rowError}>{error}</Text>}
    </View>
  );
}

function IssuedCode({
  challenge,
  channelName,
  reissue,
  pending,
  refresh,
}: {
  challenge: Challenge;
  channelName: string;
  reissue(): void;
  pending: boolean;
  refresh(): void;
}) {
  const expired = useExpired(challenge.expiresAt);
  // The form drops the prompt once the link shows up in the Hub's identities;
  // nothing can land after the code expires.
  useLinkPolling(!expired, refresh);
  if (expired) {
    return (
      <View style={styles.action}>
        <Text style={settingsStyles.rowHint}>This code expired.</Text>
        <Button size="sm" variant="outline" disabled={pending} onPress={reissue}>
          {pending ? "Creating code…" : "Create a new code"}
        </Button>
      </View>
    );
  }
  return (
    <>
      <Text style={settingsStyles.rowHint}>{`Send this to the bot in ${channelName}:`}</Text>
      <CopyableCommand command={challenge.command} copyLabel="Copy link command" />
      <Text style={settingsStyles.rowHint}>
        {`Use it before ${new Date(challenge.expiresAt).toLocaleTimeString()}. This form updates when the link lands.`}
      </Text>
    </>
  );
}

function useLinkPolling(active: boolean, refresh: () => void): void {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);
}

const styles = StyleSheet.create((theme) => ({
  panel: { gap: theme.spacing[2], padding: theme.spacing[3] },
  action: { alignItems: "flex-start", gap: theme.spacing[2] },
}));
