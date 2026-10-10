import { useLocalDay } from "./use-local-day";
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Combobox } from "@/components/ui/combobox";
import { FilterPill } from "@/components/hosts/host-filter";
import { useSessionStore } from "@/stores/session-store";
import type { FetchAgentHistoryOptions } from "@clisbot/client/internal/daemon-client";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activityBucket } from "./activity";
const KINDS = [
  { id: "all", label: "All types" },
  { id: "bot", label: "Bots" },
  { id: "project", label: "Projects and Quick chat" },
];
const DATES = [
  { id: "all", label: "Any date" },
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
];
function Filter({
  options,
  value,
  onSelect,
  title,
}: {
  options: typeof KINDS;
  value: string;
  onSelect: (value: string) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const show = useCallback(() => setOpen(true), []);
  const label = options.find((item) => item.id === value)?.label ?? title;
  return (
    <>
      <FilterPill
        anchorRef={anchor}
        onPress={show}
        label={label}
        accessibilityLabel={`${title}: ${label}`}
      />
      <Combobox
        title={title}
        anchorRef={anchor}
        options={options}
        value={value}
        onSelect={onSelect}
        open={open}
        onOpenChange={setOpen}
        desktopPlacement="bottom-start"
      />
    </>
  );
}
export function useInboxFilters(serverIds: string[]) {
  const day = useLocalDay();
  const [kind, setKind] = useState("all");
  const [date, setDate] = useState("all");
  // Hosts that never connected are not searched either; they must not hide the filters.
  const supported = useSessionStore((state) => {
    const known = serverIds.filter((id) => state.sessions[id]?.serverInfo);
    return (
      known.length > 0 &&
      known.every((id) => state.sessions[id]?.serverInfo?.features?.inboxFilters === true)
    );
  });
  const activityFilter = useMemo<FetchAgentHistoryOptions["activityFilter"]>(() => {
    if (!supported) return undefined;
    const now = new Date(day);
    const updatedAfter =
      date === "all"
        ? undefined
        : new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - (date === "week" ? 6 : 0),
          ).toISOString();
    return { kind: kind === "all" ? undefined : (kind as "bot" | "project"), updatedAfter };
  }, [supported, kind, date, day]);
  // Pills only: the screen places them on its filter row beside search and Host.
  const view = supported ? (
    <>
      <Filter title="Type" options={KINDS} value={kind} onSelect={setKind} />
      <Filter title="Date" options={DATES} value={date} onSelect={setDate} />
    </>
  ) : null;
  return { activityFilter, view };
}
export function mergeInboxAgents(
  history: AggregatedAgent[],
  live: AggregatedAgent[],
  host: string | null,
  search: string,
  filtered: boolean,
) {
  const merged = new Map(history.map((agent) => [`${agent.serverId}:${agent.id}`, agent]));
  for (const agent of live) {
    const key = `${agent.serverId}:${agent.id}`;
    if (host && host !== agent.serverId) continue;
    if ((search || filtered) && !merged.has(key)) continue;
    if (activityBucket(agent) !== "recent" || merged.has(key)) merged.set(key, agent);
  }
  return [...merged.values()];
}
