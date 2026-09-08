/**
 * The channel resource layer over `HubApiClient`.
 *
 * `api-client.ts` stays a transport — path prefix, JSON, problem parsing — and
 * knows no domain. Every organization-scoped channel endpoint the setup and
 * operations surfaces call lives here, so a resource string is written once and
 * a screen never spells one out inline.
 */
import { HubApiError, type HubApiClient } from "./api-client";
import {
  HubChannelIngressEventsSchema,
  HubChannelIngressPruneSchema,
  HubChannelIngressResubmitSchema,
  HubChannelIngressStatusSchema,
  HubChannelQrCancelSchema,
  HubChannelQrLogoutSchema,
  HubChannelQrPollSchema,
  HubChannelQrStartSchema,
  HubChannelPairingSchema,
  HubChannelPairingsSchema,
  HubChannelRuntimeStatusSchema,
  HubConnectionSchema,
} from "./contracts";

export const CHANNEL_ACCOUNT_STATUS_RESOURCE = "channel-accounts/status";
export const CHANNEL_INGRESS_RESOURCE = "channel-ingress";

export interface ChannelIngressQuery {
  /** An account id is ambiguous without its channel; the Hub rejects it alone. */
  channel?: string | undefined;
  accountId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function channelIngressEventsResource(query: ChannelIngressQuery = {}): string {
  const params = new URLSearchParams();
  if (query.channel !== undefined) params.set("channel", query.channel);
  if (query.channel !== undefined && query.accountId !== undefined) {
    params.set("accountId", query.accountId);
  }
  if (query.status !== undefined) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined && query.offset > 0) params.set("offset", String(query.offset));
  const search = params.toString();
  return search.length === 0
    ? `${CHANNEL_INGRESS_RESOURCE}/events`
    : `${CHANNEL_INGRESS_RESOURCE}/events?${search}`;
}

export function fetchChannelAccountStatus(client: HubApiClient) {
  return client.get(CHANNEL_ACCOUNT_STATUS_RESOURCE, HubChannelRuntimeStatusSchema);
}

export function fetchChannelIngressStatus(client: HubApiClient) {
  return client.get(CHANNEL_INGRESS_RESOURCE, HubChannelIngressStatusSchema);
}

export function fetchChannelIngressEvents(client: HubApiClient, query: ChannelIngressQuery = {}) {
  return client.get(channelIngressEventsResource(query), HubChannelIngressEventsSchema);
}

export function resubmitChannelIngress(client: HubApiClient, ids: readonly string[]) {
  return client.post(
    `${CHANNEL_INGRESS_RESOURCE}/resubmit`,
    { ids: [...ids] },
    HubChannelIngressResubmitSchema,
  );
}

/** An absent cutoff falls back to the Hub's own retention TTL for that status. */
export function pruneChannelIngress(
  client: HubApiClient,
  cutoffs: { completedOlderThanMs?: number; deadLetteredOlderThanMs?: number } = {},
) {
  return client.post(`${CHANNEL_INGRESS_RESOURCE}/prune`, cutoffs, HubChannelIngressPruneSchema);
}

export function createChannelConnection(client: HubApiClient, body: unknown) {
  return client.post("connections", body, HubConnectionSchema);
}

export function deleteChannelConnection(client: HubApiClient, connectionId: string): Promise<void> {
  return client.delete(`connections/${encodeURIComponent(connectionId)}`);
}

export type ChannelQrVerb = "start" | "poll" | "cancel" | "relink" | "logout";

/**
 * The QR login verbs the Hub lifts off a vertical's `plugin.setup`
 * (`channels/zalouser/HUB-WIRING.md` §7). Every verb is a POST because `poll`
 * advances the vertical's login state machine. The channel is a parameter: Zalo
 * Personal is the only `auth: "qr"` channel in the catalog today, and the path
 * is not shaped around it.
 */
export function channelQrResource(channel: string, accountId: string, verb: ChannelQrVerb): string {
  return `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}/qr/${verb}`;
}

export interface ChannelQrTarget {
  channel: string;
  accountId: string;
}

export function startChannelQrLogin(
  client: HubApiClient,
  target: ChannelQrTarget,
  input: { relink?: boolean } = {},
) {
  return client.post(
    channelQrResource(target.channel, target.accountId, input.relink === true ? "relink" : "start"),
    {},
    HubChannelQrStartSchema,
  );
}

export function pollChannelQrLogin(client: HubApiClient, target: ChannelQrTarget) {
  return client.post(
    channelQrResource(target.channel, target.accountId, "poll"),
    {},
    HubChannelQrPollSchema,
  );
}

export function cancelChannelQrLogin(client: HubApiClient, target: ChannelQrTarget) {
  return client.post(
    channelQrResource(target.channel, target.accountId, "cancel"),
    {},
    HubChannelQrCancelSchema,
  );
}

export function logoutChannelQrLogin(client: HubApiClient, target: ChannelQrTarget) {
  return client.post(
    channelQrResource(target.channel, target.accountId, "logout"),
    {},
    HubChannelQrLogoutSchema,
  );
}

/** The pairing queue for a `dmPolicy: pairing` account, and its two decisions. */
export function channelPairingResource(
  channel: string,
  accountId: string,
  decision?: "approve" | "deny",
): string {
  const base = `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}/pairing`;
  return decision === undefined ? base : `${base}/${decision}`;
}

export function fetchChannelPairings(client: HubApiClient, target: ChannelQrTarget) {
  return client.get(
    channelPairingResource(target.channel, target.accountId),
    HubChannelPairingsSchema,
  );
}

export function decideChannelPairing(
  client: HubApiClient,
  target: ChannelQrTarget,
  input: { senderIdentity: string; decision: "approve" | "deny" },
) {
  return client.post(
    channelPairingResource(target.channel, target.accountId, input.decision),
    { senderIdentity: input.senderIdentity },
    HubChannelPairingSchema,
  );
}

/**
 * A Hub that does not implement an endpoint answers with the management API's
 * unknown-route 404. That is "this Hub cannot do this", not "the request was
 * wrong", and it is the only signal the app gets.
 */
export function isChannelOperationUnavailable(error: unknown): boolean {
  return error instanceof HubApiError && error.status === 404;
}

/** The problem shape the connection form's guidance mapper expects. */
export function channelApiProblem(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof HubApiError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return {
    status: 0,
    code: "request_failed",
    message: error instanceof Error ? error.message : "The Hub could not be reached.",
  };
}
