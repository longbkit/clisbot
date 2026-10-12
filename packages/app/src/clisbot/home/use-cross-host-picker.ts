import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuickChatRoots } from "@/clisbot/quick-chats/quick-chat-projects";
import type { HostProfile } from "@/types/host-connection";
import type { HostProjectListItem } from "@/projects/host-projects";
import type { QuickStartDestination } from "@/clisbot/quick-starts/model";
import { botsRuntime } from "@/clisbot/bots/data/runtime";
import { useBotsQuery } from "@/clisbot/bots/data/use-bots";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  buildOtherHostDestinations,
  parseOtherHostOption,
  type StartBot,
} from "./start-destinations";

/** Bots on Hosts other than the selected one, through the sidebar's aggregated reader. */
function useOtherHostBots(
  hosts: readonly { serverId: string; serverName: string }[],
): ReadonlyMap<string, StartBot[]> {
  const query = useBotsQuery({ hosts, runtime: botsRuntime });
  return useMemo(() => {
    const byHost = new Map<string, StartBot[]>();
    if (query.loadState.status !== "loaded") return byHost;
    for (const bot of query.loadState.data) {
      byHost.set(bot.serverId, [...(byHost.get(bot.serverId) ?? []), bot]);
    }
    return byHost;
  }, [query.loadState]);
}

/**
 * The destination picker across Hosts: the selected Host's Quick chat, Projects and Bots first,
 * then the other online Hosts'. Picking one on another Host switches the Host, then picks the same
 * option there once that Host's list has it, through the ordinary selection.
 */
export function useCrossHostPicker(input: {
  enabled: boolean;
  selectedServerId: string;
  hosts: readonly HostProfile[];
  projects: HostProjectListItem[];
  icons: Map<string, string | null>;
  current: QuickStartDestination[];
  selectHost: (serverId: string) => void;
  selectCurrent: (optionId: string) => void;
}) {
  const { enabled, selectedServerId, hosts, projects, icons, current } = input;
  const { selectHost, selectCurrent } = input;
  const otherIds = useMemo(
    () => (enabled ? hosts.map((h) => h.serverId).filter((id) => id !== selectedServerId) : []),
    [enabled, hosts, selectedServerId],
  );
  const statuses = useHostRuntimeConnectionStatuses(otherIds);
  const online = useMemo(
    () => otherIds.filter((id) => statuses.get(id) === "online"),
    [otherIds, statuses],
  );
  const multiplicity = useHostFeatureMap(online, "workspaceMultiplicity");
  const botsFeature = useHostFeatureMap(online, "bots");
  const botHosts = useMemo(
    () =>
      online
        .filter((id) => botsFeature.get(id))
        .map((serverId) => ({
          serverId,
          serverName: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
        })),
    [online, botsFeature, hosts],
  );
  const botsByHost = useOtherHostBots(botHosts);
  const quickChatRoots = useQuickChatRoots(online);
  const others = useMemo(
    () =>
      buildOtherHostDestinations({
        hosts: online.map((serverId) => ({
          serverId,
          label: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
          allowAllProjects: multiplicity.get(serverId) === true,
          quickChatRoot: quickChatRoots.get(serverId),
        })),
        projects,
        icons,
        botsByHost,
      }),
    [online, hosts, multiplicity, projects, icons, botsByHost, quickChatRoots],
  );
  const [pending, setPending] = useState<{
    from: string;
    serverId: string;
    optionId: string;
  } | null>(null);
  const pick = useCallback(
    (id: string) => {
      const other = parseOtherHostOption(id);
      if (!other) {
        setPending(null);
        selectCurrent(id);
        return;
      }
      setPending({ from: selectedServerId, ...other });
      selectHost(other.serverId);
    },
    [selectCurrent, selectHost, selectedServerId],
  );
  useEffect(() => {
    if (!pending) return;
    // The user went somewhere else meanwhile: drop the pick rather than apply it later.
    if (selectedServerId !== pending.serverId && selectedServerId !== pending.from) {
      setPending(null);
      return;
    }
    if (selectedServerId !== pending.serverId) return;
    if (!current.some((entry) => entry.option.id === pending.optionId)) return;
    setPending(null);
    selectCurrent(pending.optionId);
  }, [pending, selectedServerId, current, selectCurrent]);
  const destinations = useMemo(() => [...current, ...others], [current, others]);
  return { destinations, pick, picking: pending !== null };
}
