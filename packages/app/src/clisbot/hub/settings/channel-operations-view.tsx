import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useConfirmation } from "@/components/confirmation-provider";
import { useHubAccount } from "../account-provider";
import type { HubApiClient } from "../api-client";
import {
  isChannelOperationUnavailable,
  pruneChannelIngress,
  resubmitChannelIngress,
} from "../channel-api";
import {
  channelIngressAccountRows,
  channelIngressDepth,
  channelIngressPruneConfirmation,
  channelIngressResubmitConfirmation,
  channelIngressSummary,
  resubmittableIngressIds,
  toggleChannelIngressSelection,
  type ChannelIngressAccountRow,
} from "../channel-ingress-operations";
import { channelSeverityVariant } from "../channel-account-health";
import { ChannelDeadLetterList } from "./channel-dead-letter-list";
import { CHANNEL_DEAD_LETTER_PAGE, useChannelIngressQueries } from "./channel-operations-queries";
import { useChannelCatalog } from "./channel-catalog-queries";

/** Channels → Operations: queue depth, dead letters, resubmit and prune. */
export function ChannelOperationsView() {
  const queries = useChannelIngressQueries();
  // Labels only. An unavailable catalog leaves the rows keyed by channel id.
  const catalog = useChannelCatalog();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setSelected(new Set());
    queries.refresh();
  }, [queries]);
  const toggle = useCallback((id: string) => {
    setSelected((current) => toggleChannelIngressSelection(current, id));
  }, []);
  const run = useChannelIngressActions({ setPending, setNotice, refresh });
  const ids = resubmittableIngressIds(queries.events, selected);
  const unavailable = isChannelOperationUnavailable(queries.statusError);
  const refreshAction = useMemo(
    () => (
      <Button
        size="sm"
        variant="ghost"
        loading={queries.fetching}
        disabled={queries.fetching}
        onPress={refresh}
      >
        Refresh
      </Button>
    ),
    [queries.fetching, refresh],
  );
  const deadLetterActions = useMemo(
    () => <DeadLetterActions pending={pending} ids={ids} run={run} disabled={unavailable} />,
    [ids, pending, run, unavailable],
  );
  return (
    <View style={styles.view}>
      <SettingsSection title="Ingress queue" trailing={refreshAction}>
        {unavailable ? (
          <Alert
            variant="info"
            title="Not available on this Hub"
            description="This Hub does not serve the channel ingress operations."
          />
        ) : null}
        {queries.statusError === null || unavailable ? null : (
          <Alert
            variant="warning"
            title="Queue status is unavailable"
            description={queries.statusError.message}
          />
        )}
        {notice === null ? null : <Alert variant="success" description={notice} />}
        {queries.status === undefined ? null : (
          <Text style={settingsStyles.rowHint}>
            {`${String(channelIngressDepth(queries.status.totals))} waiting · ${channelIngressSummary(queries.status.totals)}`}
          </Text>
        )}
        {queries.status === undefined ? null : (
          <QueueAccountList
            rows={channelIngressAccountRows(queries.status.accounts, catalog.entries)}
          />
        )}
      </SettingsSection>
      <SettingsSection title="Dead letters" trailing={deadLetterActions}>
        {queries.eventsError === null || unavailable ? null : (
          <Alert
            variant="warning"
            title="Dead letters are unavailable"
            description={queries.eventsError.message}
          />
        )}
        <ChannelDeadLetterList
          events={queries.events}
          catalog={catalog.entries}
          selected={selected}
          onToggle={toggle}
        />
        {queries.hasMore ? (
          <Text style={settingsStyles.rowHint}>
            {`Showing the first ${String(CHANNEL_DEAD_LETTER_PAGE)}; more remain.`}
          </Text>
        ) : null}
      </SettingsSection>
    </View>
  );
}

type IngressAction = (action: "resubmit" | "prune", ids: readonly string[]) => void;

function DeadLetterActions({
  pending,
  ids,
  run,
  disabled,
}: {
  pending: boolean;
  ids: readonly string[];
  run: IngressAction;
  disabled: boolean;
}) {
  const resubmit = useCallback(() => run("resubmit", ids), [ids, run]);
  const prune = useCallback(() => run("prune", []), [run]);
  return (
    <View style={styles.actions}>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || disabled || ids.length === 0}
        onPress={resubmit}
      >
        {`Resubmit${ids.length === 0 ? "" : ` (${String(ids.length)})`}`}
      </Button>
      <Button size="sm" variant="outline" disabled={pending || disabled} onPress={prune}>
        Prune
      </Button>
    </View>
  );
}

function QueueAccountList({ rows }: { rows: readonly ChannelIngressAccountRow[] }) {
  if (rows.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>No account has queued work.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
        >
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{`${row.channelLabel} · ${row.accountId}`}</Text>
            <Text style={settingsStyles.rowHint}>{row.summary}</Text>
            {row.oldestPending === null ? null : (
              <Text style={settingsStyles.rowHint}>{`Oldest pending ${row.oldestPending}`}</Text>
            )}
          </View>
          <StatusBadge
            label={`${String(row.depth)} waiting`}
            variant={channelSeverityVariant(row.severity)}
          />
        </View>
      ))}
    </View>
  );
}

function useChannelIngressActions(input: {
  setPending(value: boolean): void;
  setNotice(value: string | null): void;
  refresh(): void;
}): IngressAction {
  const hub = useHubAccount();
  const confirm = useConfirmation();
  const { setPending, setNotice, refresh } = input;
  return useCallback(
    (action, ids) => {
      const confirmation =
        action === "resubmit"
          ? channelIngressResubmitConfirmation(ids.length)
          : channelIngressPruneConfirmation();
      void (async () => {
        if (!(await confirm({ ...confirmation, destructive: action === "prune" }))) return;
        setPending(true);
        setNotice(null);
        try {
          setNotice(await runIngressAction(hub.api(), action, ids));
          refresh();
        } finally {
          setPending(false);
        }
      })();
    },
    [confirm, hub, refresh, setNotice, setPending],
  );
}

async function runIngressAction(
  api: HubApiClient,
  action: "resubmit" | "prune",
  ids: readonly string[],
): Promise<string> {
  if (action === "resubmit") {
    const { resubmitted } = await resubmitChannelIngress(api, ids);
    return `${String(resubmitted.length)} events resubmitted.`;
  }
  const { deleted } = await pruneChannelIngress(api);
  return `${String(deleted)} rows pruned.`;
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
