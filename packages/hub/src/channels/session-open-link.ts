/**
 * Slack (and every other channel) only linkifies `http(s):`. A `paseo://` deep
 * link posted as link markup is rendered as literal text — verified against
 * Slack's own message parse — so the app destination is offered as an https URL
 * on the Hub that redirects into the scheme.
 */
export const SESSION_OPEN_PATH = "/api/open/agent";

/** Ids come from the daemon, not from a channel message; reject anything that
 * could not have come from there rather than building a URL around it. */
const ID_PATTERN = /^[\w.-]+$/;

export function sessionDeepLink(serverId: string, agentId: string): string {
  return `paseo://h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

export function sessionOpenUrl(origin: string, serverId: string, agentId: string): string {
  const url = new URL(`${SESSION_OPEN_PATH}/${encodeURIComponent(agentId)}`, origin);
  url.searchParams.set("host", serverId);
  return url.toString();
}

/** The redirect target, or undefined when the request cannot name one. */
export function sessionOpenRedirect(agentId: string, host: string | null): string | undefined {
  if (!host || !ID_PATTERN.test(host) || !ID_PATTERN.test(agentId)) return undefined;
  return sessionDeepLink(host, agentId);
}
