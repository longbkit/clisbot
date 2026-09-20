// The Host behind each Route, for the rows that show it.
//
// A Route names an environment, the environment names a Host, and the Hub knows
// whether it holds that Host's connection. Threading those two lookups through
// the Connections list would touch five components that do not care, so the
// Channels screen publishes the resolver once and the Route row reads it.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { routeHostConnection, type HubHostConnection } from "@/clisbot/hub/channel-host-connection";

type Unknowns = Record<string, unknown>;
type RouteHostResolver = (route: Unknowns) => HubHostConnection | null;

const RouteHostContext = createContext<RouteHostResolver>(() => null);

const NO_RESOURCE: Unknowns = {};
const NO_DAEMONS: readonly HostRow[] = [];

interface HostRow {
  id: string;
  slug: string;
  presence: string;
}

/** Takes the two queries' payloads as they are, loaded or not: the defaults
 * live here so the Channels screen neither builds them per render nor carries
 * the branches. */
export function RouteHostProvider({
  configuration,
  daemons,
  children,
}: {
  configuration: { resource?: Unknowns | null } | undefined;
  daemons: { daemons: readonly HostRow[] } | undefined;
  children: ReactNode;
}) {
  const resource = configuration?.resource ?? NO_RESOURCE;
  const hosts = daemons?.daemons ?? NO_DAEMONS;
  const resolve = useMemo<RouteHostResolver>(
    () => (route) => routeHostConnection({ route, resource, daemons: hosts }),
    [resource, hosts],
  );
  return <RouteHostContext.Provider value={resolve}>{children}</RouteHostContext.Provider>;
}

/** The Host a Route runs on, or `null` when the Route names none. */
export function useRouteHost(route: Unknowns): HubHostConnection | null {
  return useContext(RouteHostContext)(route);
}
