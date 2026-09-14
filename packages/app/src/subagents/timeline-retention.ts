import type { StreamItem } from "@/types/stream";
import {
  timelinePageRetention,
  timelineRetentionKey,
  type TimelinePageRetention,
  type TimelineRetentionChange,
} from "@/timeline/timeline-page-retention";
import type { ProviderSubagentTimelineState } from "./provider-store";
import type { ProviderSubagentTimelinePage } from "./projected-timeline";

export function trimSubagentTimeline(
  current: ProviderSubagentTimelineState,
  change: TimelineRetentionChange,
): ProviderSubagentTimelineState {
  if (current.pagingMode !== "source_ranges") {
    return change.range
      ? current
      : {
          ...current,
          tail: [],
          head: [],
          rows: new Map(),
          cursor: null,
          lastSeq: 0,
          hasOlder: true,
          historyReady: false,
        };
  }
  const keep = (item: StreamItem) => change.keepItemIds.has(item.id);
  return {
    ...current,
    tail: current.tail.filter(keep),
    head: current.head.filter(keep),
    cursor: change.range,
    historyReady: Boolean(change.range),
    lastSeq: change.range?.endSeq ?? 0,
    hasOlder: change.hasOlder || !change.range,
  };
}

/** Only page metadata is retained here; the subagent store owns all row payloads. */
export /** Source-range lanes are charged per retained item; a full page is charged as one blob. */
function retentionCost(
  current: ProviderSubagentTimelineState,
  items: readonly StreamItem[],
  allItems: readonly StreamItem[],
): { bytes: number; itemBytes?: Record<string, number> } {
  const sizeOf = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength * 2 + 256;
  if (current.pagingMode !== "source_ranges")
    return { bytes: sizeOf([allItems, [...current.rows]]) };
  return { bytes: 0, itemBytes: Object.fromEntries(items.map((item) => [item.id, sizeOf(item)])) };
}

export class ProviderSubagentTimelineRetention {
  private readonly owners = new Map<string, () => void>();
  private readonly visible = new Set<string>();
  constructor(
    private readonly evict: (key: string, change: TimelineRetentionChange) => void,
    private readonly budget: TimelinePageRetention = timelinePageRetention,
  ) {}
  ensure(key: string, serverId: string, parentAgentId: string): void {
    if (this.owners.has(key)) return;
    this.owners.set(
      key,
      this.budget.register(
        key,
        (change) => this.evict(key, change),
        timelineRetentionKey(serverId, parentAgentId),
      ),
    );
  }
  setReading(key: string, visible: boolean, itemId: string | null): void {
    if (visible) this.visible.add(key);
    else this.visible.delete(key);
    this.budget.setReading(key, visible, itemId);
  }
  isVisible(key: string): boolean {
    return this.visible.has(key);
  }
  remove(key: string): void {
    this.owners.get(key)?.();
    this.owners.delete(key);
    this.visible.delete(key);
  }
  admit(
    key: string,
    current: ProviderSubagentTimelineState,
    page?: ProviderSubagentTimelinePage,
  ): ProviderSubagentTimelineState {
    const allItems = [...current.tail, ...current.head];
    const positions =
      page?.pagingMode === "source_ranges"
        ? new Set(
            [...(page.entries ?? []), ...(page.contextEntries ?? [])].map((entry) => entry.seqEnd),
          )
        : null;
    const items = positions
      ? allItems.filter((item) => item.timelineCursor && positions.has(item.timelineCursor.seq))
      : allItems;
    const startSeq =
      page?.startCursor?.seq ??
      current.cursor?.startSeq ??
      (current.rows.size ? Math.min(...current.rows.keys()) : 0);
    const endSeq = page?.endCursor?.seq ?? current.lastSeq;
    if (!current.epoch || !endSeq) return current;
    const sourceSeqRanges = items.flatMap((item) => item.timelineCursor?.sourceSeqRanges ?? []);
    const accepted = this.budget.retain(key, {
      epoch: current.epoch,
      startSeq,
      endSeq,
      hasOlder: page?.hasOlder ?? current.hasOlder,
      itemIds: items.map((item) => item.id),
      sourceSeqRanges,
      ...retentionCost(current, items, allItems),
    });
    if (!accepted) throw new Error("Subagent history exceeds the available memory budget");
    return trimSubagentTimeline(current, this.budget.readRange(key)!);
  }
}
