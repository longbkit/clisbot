// Which Host a Route runs on, and whether the Hub can reach it right now.
//
// Since the channel plane started driving a Host over the connection that Host
// holds to the Hub, those are the same fact: a Host whose socket is registered
// is a Host the bot can answer from. `presence` on the Hub's daemons resource
// is that fact, so the Hosts screen and a Route row read one thing.

import type { StatusBadgeVariant } from "@/components/ui/status-badge";

export interface HubHostConnection {
  /** What the Host is called in the UI. */
  label: string;
  /** The Hub's socket to that Host is registered. */
  connected: boolean;
}

interface DaemonRow {
  id: string;
  slug: string;
  presence: string;
}

type Unknowns = Record<string, unknown>;

/** The Host a Route's environment names, with its connection state. */
export function routeHostConnection(input: {
  route: Unknowns;
  /** The account's configuration resource, which holds `environments`. */
  resource: Unknowns;
  daemons: readonly DaemonRow[];
}): HubHostConnection | null {
  const environmentName = stringAt(input.route, "environment");
  if (environmentName === undefined) return null;
  const environments = recordAt(input.resource, "environments");
  const environment =
    environments === undefined ? undefined : recordAt(environments, environmentName);
  const daemonId = environment === undefined ? undefined : stringAt(environment, "daemon");
  if (daemonId === undefined) return null;
  const daemon = input.daemons.find((candidate) => candidate.id === daemonId);
  if (daemon === undefined) return { label: daemonId, connected: false };
  return { label: daemon.slug, connected: daemon.presence === "connected" };
}

/** One vocabulary for the Host connection, shared by both screens. */
export function hostConnectionPresentation(connection: HubHostConnection): {
  label: string;
  variant: StatusBadgeVariant;
} {
  return connection.connected
    ? { label: `Host ${connection.label}`, variant: "success" }
    : { label: `Host ${connection.label} offline`, variant: "warning" };
}

/** The Hosts screen says the same thing about the Hub's own link. */
export function hubLinkPresentation(presence: string): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (presence === "connected") return { label: "Hub connected", variant: "success" };
  if (presence === "offline") return { label: "Hub offline", variant: "warning" };
  return { label: "Hub unknown", variant: "muted" };
}

function stringAt(record: Unknowns, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function recordAt(record: Unknowns, key: string): Unknowns | undefined {
  const value = record[key];
  return typeof value === "object" && value !== null ? (value as Unknowns) : undefined;
}
