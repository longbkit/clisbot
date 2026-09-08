import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { channelIngressEventsResource } from "../channel-api";
import { HubChannelIngressEventsSchema, HubChannelIngressStatusSchema } from "../contracts";
import type { HubChannelIngressEvent, HubChannelIngressStatus } from "../contracts";

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

/** Queue depth and the first page of dead letters, both organization-scoped. */
export function useChannelIngressQueries(): ChannelIngressQueries {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const scope = {
    origin: hub.origin,
    organizationId,
    accountId: hub.signedIn?.account.id ?? null,
  };
  const enabled = organizationId.length > 0;
  const eventsResource = channelIngressEventsResource({
    status: "dead_letter",
    limit: CHANNEL_DEAD_LETTER_PAGE,
  });
  const status = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "channel-ingress"),
    queryFn: () => hub.api().get("channel-ingress", HubChannelIngressStatusSchema),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 10_000,
  });
  const events = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, eventsResource),
    queryFn: () => hub.api().get(eventsResource, HubChannelIngressEventsSchema),
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
