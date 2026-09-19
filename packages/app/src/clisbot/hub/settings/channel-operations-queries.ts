import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import type { HubApiClient } from "../api-client";
import { hubResourceQueryKey } from "../query-keys";
import { channelIngressEventsResource } from "../channel-api";
import {
  HubChannelIngressEventsSchema,
  HubChannelIngressStatusSchema,
  HubChannelRuntimeStatusSchema,
} from "../contracts";
import type { HubChannelIngressEvent, HubChannelIngressStatus } from "../contracts";
import { channelAccountResource, type ChannelAccountRef } from "../channel-account-requests";

export const CHANNEL_DEAD_LETTER_PAGE = 25;

export interface ChannelIngressQueries {
  status: HubChannelIngressStatus | undefined;
  events: readonly HubChannelIngressEvent[];
  /** More dead letters exist beyond the first page. */
  hasMore: boolean;
  fetching: boolean;
  statusError: Error | null;
  eventsError: Error | null;
  refresh(): void;
}

/**
 * Queue depth and the first page of dead letters. Organization-wide by
 * default; a Channel Route Admin passes their accounts and both come from the
 * per-account endpoints (queue depth rides on `channel-accounts/<c>/<a>/status`).
 */
export function useChannelIngressQueries(
  adminAccounts: readonly ChannelAccountRef[] | null = null,
): ChannelIngressQueries {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const scope = {
    origin: hub.origin,
    organizationId,
    accountId: hub.signedIn?.account.id ?? null,
  };
  const enabled = organizationId.length > 0;
  const refs = adminAccounts ?? [];
  const keys = refs.map(channelAccountResource);
  const eventsResource = channelIngressEventsResource({
    status: "dead_letter",
    limit: CHANNEL_DEAD_LETTER_PAGE,
  });
  const status = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-ingress"), ...keys],
    queryFn: () =>
      adminAccounts === null
        ? hub.api().get("channel-ingress", HubChannelIngressStatusSchema)
        : administeredIngressStatus(hub.api(), refs),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 10_000,
  });
  const events = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, eventsResource), ...keys],
    queryFn: () =>
      adminAccounts === null
        ? hub.api().get(eventsResource, HubChannelIngressEventsSchema)
        : administeredDeadLetters(hub.api(), refs),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 10_000,
  });
  const refresh = useCallback(() => {
    void status.refetch();
    void events.refetch();
  }, [events, status]);
  return {
    status: status.data,
    events: events.data?.events ?? [],
    hasMore: events.data?.nextOffset !== null && events.data !== undefined,
    fetching: status.isFetching || events.isFetching,
    statusError: status.error,
    eventsError: events.error,
    refresh,
  };
}

/** Per-account queue depth folded into the organization-wide status shape. */
async function administeredIngressStatus(
  api: HubApiClient,
  refs: readonly ChannelAccountRef[],
): Promise<HubChannelIngressStatus> {
  const pages = await Promise.all(
    refs.map((ref) =>
      api.get(
        `channel-accounts/${channelAccountResource(ref)}/status`,
        HubChannelRuntimeStatusSchema,
      ),
    ),
  );
  const accounts = pages.flatMap((page) =>
    page.accounts.flatMap((account) =>
      account.ingress === undefined
        ? []
        : [
            {
              channel: account.channel,
              accountId: account.account,
              completed: 0,
              ...account.ingress,
            },
          ],
    ),
  );
  const totals = {
    pending: 0,
    claimed: 0,
    retrying: 0,
    deadLettered: 0,
    oldestPendingAgeMs: null as number | null,
    lanesBlocked: 0,
    completed: 0,
  };
  for (const account of accounts) {
    totals.pending += account.pending;
    totals.claimed += account.claimed;
    totals.retrying += account.retrying;
    totals.deadLettered += account.deadLettered;
    totals.lanesBlocked += account.lanesBlocked;
    if (account.oldestPendingAgeMs !== null) {
      totals.oldestPendingAgeMs = Math.max(
        totals.oldestPendingAgeMs ?? 0,
        account.oldestPendingAgeMs,
      );
    }
  }
  return { accounts, totals };
}

/** The first page of dead letters across the administered accounts. */
async function administeredDeadLetters(api: HubApiClient, refs: readonly ChannelAccountRef[]) {
  const pages = await Promise.all(
    refs.map((ref) =>
      api.get(
        `channel-ingress/accounts/${channelAccountResource(ref)}?status=dead_letter&limit=${String(CHANNEL_DEAD_LETTER_PAGE)}`,
        HubChannelIngressEventsSchema,
      ),
    ),
  );
  return {
    events: pages.flatMap((page) => page.events),
    nextOffset: pages.some((page) => page.nextOffset !== null) ? CHANNEL_DEAD_LETTER_PAGE : null,
  };
}
