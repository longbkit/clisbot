import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import {
  channelPairingResource,
  decideChannelPairing,
  fetchChannelPairings,
  isChannelOperationUnavailable,
} from "../channel-api";
import {
  channelPairingRows,
  channelPairingSummary,
  type ChannelPairingRow,
} from "../channel-pairing";

/**
 * The pairing queue for one Channel account, inside its Access section. A Hub
 * older than the pairing endpoints answers 404, which reads as "this Hub has no
 * pairing queue" rather than "nobody is waiting".
 */
export function ChannelPairingPanel({
  channel,
  accountId,
  disabled,
}: {
  channel: string;
  accountId: string;
  disabled: boolean;
}) {
  const queue = useChannelPairingQueue(channel, accountId);
  if (queue.unavailable) {
    return (
      <Alert
        variant="info"
        title="Pairing is not available on this Hub"
        description="Update the Hub to a build that serves the pairing queue to approve senders from here."
      />
    );
  }
  return (
    <View style={styles.panel}>
      <Text style={settingsStyles.rowHint}>{channelPairingSummary(queue.rows)}</Text>
      {queue.error === null ? null : (
        <Alert
          variant="warning"
          title="Pairing requests are unavailable"
          description={queue.error}
        />
      )}
      {queue.rows.length === 0 ? null : (
        <View style={settingsStyles.card}>
          {queue.rows.map((row, index) => (
            <PairingRow
              key={row.senderIdentity}
              row={row}
              bordered={index > 0}
              disabled={disabled || queue.deciding !== null}
              deciding={queue.deciding === row.senderIdentity}
              decide={queue.decide}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PairingRow({
  row,
  bordered,
  disabled,
  deciding,
  decide,
}: {
  row: ChannelPairingRow;
  bordered: boolean;
  disabled: boolean;
  deciding: boolean;
  decide(senderIdentity: string, decision: "approve" | "deny"): void;
}) {
  const approve = useCallback(() => decide(row.senderIdentity, "approve"), [decide, row]);
  const deny = useCallback(() => decide(row.senderIdentity, "deny"), [decide, row]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{row.title}</Text>
        <Text style={settingsStyles.rowHint}>{row.detail}</Text>
      </View>
      {row.decidable ? (
        <View style={styles.actions}>
          <Button
            size="xs"
            variant="secondary"
            disabled={disabled}
            loading={deciding}
            onPress={approve}
          >
            Approve
          </Button>
          <Button size="xs" variant="outline" disabled={disabled} onPress={deny}>
            Deny
          </Button>
        </View>
      ) : (
        <StatusBadge
          label={row.statusLabel}
          variant={row.status === "approved" ? "success" : "muted"}
        />
      )}
    </View>
  );
}

interface ChannelPairingQueue {
  rows: readonly ChannelPairingRow[];
  unavailable: boolean;
  error: string | null;
  /** The sender whose decision is in flight, or null. */
  deciding: string | null;
  decide(senderIdentity: string, decision: "approve" | "deny"): void;
}

function useChannelPairingQueue(channel: string, accountId: string): ChannelPairingQueue {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const query = useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId,
        accountId: hub.signedIn?.account.id ?? null,
      },
      channelPairingResource(channel, accountId),
    ),
    queryFn: () => fetchChannelPairings(hub.api(), { channel, accountId }),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 10_000,
  });
  const rows = useMemo(
    () => channelPairingRows(query.data?.pairings ?? []),
    [query.data?.pairings],
  );
  const refetch = query.refetch;
  const decide = useCallback(
    (senderIdentity: string, decision: "approve" | "deny") => {
      setDeciding(senderIdentity);
      setDecisionError(null);
      void decideChannelPairing(hub.api(), { channel, accountId }, { senderIdentity, decision })
        .then(() => refetch())
        .catch((cause: unknown) =>
          setDecisionError(cause instanceof Error ? cause.message : "The decision was not saved."),
        )
        .finally(() => setDeciding(null));
    },
    [accountId, channel, hub, refetch],
  );
  return {
    rows,
    unavailable: isChannelOperationUnavailable(query.error),
    error: decisionError ?? query.error?.message ?? null,
    deciding,
    decide,
  };
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
