import { createContext, useContext, type ReactNode } from "react";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";

const EMPTY: ReadonlyMap<string, HostBadgeModel> = new Map();
const SessionLineHostBadges = createContext<ReadonlyMap<string, HostBadgeModel>>(EMPTY);

/**
 * Host badges for Work session lines. In the session groupings a session line stands in for its
 * workspace row, and with work spread over several machines each line has to say which one it is
 * on, so a Host nobody chose a badge for shows its name here, the local one included. A Host set
 * to icon or hidden keeps that choice, and `enabled` (Display > Show > Host, more than one Host)
 * still turns every badge off. Workspace rows keep their own default, which hides the local Host.
 */
export function SessionLineHostBadgesProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const badges = useHostBadges({ enabled, unchosenDisplay: "name" });
  return <SessionLineHostBadges.Provider value={badges}>{children}</SessionLineHostBadges.Provider>;
}

export function useSessionLineHostBadge(serverId: string): HostBadgeModel | null {
  return useContext(SessionLineHostBadges).get(serverId) ?? null;
}
