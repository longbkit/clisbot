import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { useConfirmation } from "@/components/confirmation-provider";
import { useHubAccount } from "../account-provider";
import type { HubApiClient } from "../api-client";
import type { HubChannelIngressCounts } from "../contracts";
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
import type { ChannelAccountRef } from "../channel-account-requests";
import { useChannelCatalog } from "./channel-catalog-queries";

/**
 * Channels → Operations: queue depth, dead letters, resubmit and prune. A
 * Connection Admin (`adminAccounts`) sees their accounts' depth and dead
 * letters; resubmit and prune stay organization-wide.
 */
export function ChannelOperationsView({
  adminAccounts = null,
}: {
  adminAccounts?: readonly ChannelAccountRef[] | null;
}) {
  const { t } = useTranslation();
  const queries = useChannelIngressQueries(adminAccounts);
  const readOnly = adminAccounts !== null;
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
        {t("hub.channels.operations.refresh")}
      </Button>
    ),
    [queries.fetching, refresh, t],
  );
  const deadLetterActions = useMemo(
    () =>
      readOnly ? undefined : (
        <DeadLetterActions pending={pending} ids={ids} run={run} disabled={unavailable} />
      ),
    [ids, pending, readOnly, run, unavailable],
  );
  return (
    <View style={styles.view}>
      <SettingsSection title={t("hub.channels.operations.queueTitle")} trailing={refreshAction}>
        {unavailable ? (
          <Alert
            variant="info"
            title={t("hub.channels.operations.unavailableTitle")}
            description={t("hub.channels.operations.unavailableBody")}
          />
        ) : null}
        {queries.statusError === null || unavailable ? null : (
          <Alert
            variant="warning"
            title={t("hub.channels.operations.statusUnavailable")}
            description={queries.statusError.message}
          />
        )}
        {notice === null ? null : <Alert variant="success" description={notice} />}
        {queries.status === undefined ? null : <QueueTotals totals={queries.status.totals} />}
        {queries.status === undefined ? null : (
          <QueueAccountList
            rows={channelIngressAccountRows(queries.status.accounts, catalog.entries)}
          />
        )}
      </SettingsSection>
      <SettingsSection
        title={t("hub.channels.operations.deadLetters")}
        trailing={deadLetterActions}
      >
        {queries.eventsError === null || unavailable ? null : (
          <Alert
            variant="warning"
            title={t("hub.channels.operations.deadLettersUnavailable")}
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
            {t("hub.channels.operations.showingFirst", { count: CHANNEL_DEAD_LETTER_PAGE })}
          </Text>
        ) : null}
      </SettingsSection>
    </View>
  );
}

function QueueTotals({ totals }: { totals: HubChannelIngressCounts }) {
  const { t } = useTranslation();
  return (
    <Text style={settingsStyles.rowHint}>
      {t("hub.channels.operations.totals", {
        count: channelIngressDepth(totals),
        summary: channelIngressSummary(totals),
      })}
    </Text>
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
  const { t } = useTranslation();
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
        {ids.length === 0
          ? t("hub.channels.ingress.resubmit")
          : t("hub.channels.operations.resubmitCount", { count: ids.length })}
      </Button>
      <Button size="sm" variant="outline" disabled={pending || disabled} onPress={prune}>
        {t("hub.channels.ingress.prune")}
      </Button>
    </View>
  );
}

function QueueAccountList({ rows }: { rows: readonly ChannelIngressAccountRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("hub.channels.operations.noQueued")}</Text>
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
              <Text style={settingsStyles.rowHint}>
                {t("hub.channels.operations.oldestPending", { age: row.oldestPending })}
              </Text>
            )}
          </View>
          <StatusBadge
            label={t("hub.channels.operations.waiting", { count: row.depth })}
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
    return i18n.t("hub.channels.operations.resubmitted", { count: resubmitted.length });
  }
  const { deleted } = await pruneChannelIngress(api);
  return i18n.t("hub.channels.operations.pruned", { count: deleted });
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
