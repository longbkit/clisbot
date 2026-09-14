import { ProviderSubagentPersistence } from "./persistence.js";
import type { AgentProvider, AgentTimelineItem } from "../agent-sdk-types.js";
import { limitAgentTimelineItemContent } from "../agent-timeline-content.js";
import { InMemoryAgentTimelineStore } from "../agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  TimelineDocumentReadOptions,
} from "../agent-timeline-store-types.js";
import { selectTimelineWindowByProjectedLimit } from "../timeline-projection.js";
import { pendingSessionEvents } from "../session-storage/pending-event-budget.js";
import { descriptorBytes, SUBAGENT_METADATA_LIMITS } from "./metadata-limits.js";

export type ProviderSubagentStatus = "running" | "completed" | "failed" | "canceled";

export interface ProviderSubagentDescriptor {
  id: string;
  parentAgentId: string;
  /** Direct provider-subagent parent. Null identifies a child of the managed agent. */
  parentSubagentId: string | null;
  provider: AgentProvider;
  title: string | null;
  description: string | null;
  status: ProviderSubagentStatus;
  createdAt: string;
  updatedAt: string;
  toolCallId: string | null;
  cwd: string | null;
  subtitle: string | null;
  runtimeAvailable?: boolean;
}

export type ProviderSubagentInputEvent =
  | {
      type: "upsert";
      id: string;
      title?: string | null;
      description?: string | null;
      /**
       * Omit to keep the stored status. A presentation-only upsert says nothing about whether the
       * child is still running, and must not revert a finished one.
       */
      status?: ProviderSubagentStatus;
      toolCallId?: string | null;
      cwd?: string | null;
      subtitle?: string | null;
      parentSubagentId?: string | null;
      timestamp?: string;
    }
  | {
      type: "timeline";
      id: string;
      item: AgentTimelineItem;
      timestamp?: string;
    }
  | { type: "remove"; id: string };

export type ProviderSubagentStoreEvent =
  | { type: "upsert"; subagent: ProviderSubagentDescriptor }
  | {
      type: "timeline";
      parentAgentId: string;
      subagentId: string;
      provider: AgentProvider;
      row: AgentTimelineRow;
      epoch: string;
    }
  | { type: "remove"; parentAgentId: string; subagentId: string };

function storeKey(parentAgentId: string, subagentId: string): string {
  return `${parentAgentId}\0${subagentId}`;
}

/**
 * Sticky upsert semantics for a descriptor field: an omitted value preserves what is stored, an
 * explicit `null` clears it. Providers observe these fields incrementally, so a partial upsert
 * must never blank fields it says nothing about.
 */
function stickyField<T>(next: T | undefined, previous: T | null | undefined): T | null {
  return next === undefined ? (previous ?? null) : next;
}
function makeDescriptor(
  parentAgentId: string,
  provider: AgentProvider,
  event: Extract<ProviderSubagentInputEvent, { type: "upsert" }>,
  previous?: ProviderSubagentDescriptor,
): ProviderSubagentDescriptor {
  const timestamp = event.timestamp ?? new Date().toISOString();
  return {
    id: event.id,
    parentAgentId,
    provider,
    title: stickyField(event.title, previous?.title),
    description: stickyField(event.description, previous?.description),
    status: event.status ?? previous?.status ?? "running",
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    toolCallId: stickyField(event.toolCallId, previous?.toolCallId),
    cwd: stickyField(event.cwd, previous?.cwd),
    subtitle: stickyField(event.subtitle, previous?.subtitle),
    parentSubagentId: stickyField(event.parentSubagentId, previous?.parentSubagentId),
  };
}

export class ProviderSubagentStore {
  private readonly descriptors = new Map<string, ProviderSubagentDescriptor>();
  private readonly timelines = new InMemoryAgentTimelineStore();
  private readonly persistence?: ProviderSubagentPersistence;
  private readonly parentAccess = new Map<string, number>();
  private readonly hydratedParents = new Set<string>();
  private readonly writable: boolean;
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly metadataReservations = new Map<string, number>();

  constructor(options?: {
    resolveParentDirectory: (parentAgentId: string) => Promise<string>;
    writable?: boolean;
  }) {
    this.writable = options?.writable !== false;
    if (options) this.persistence = new ProviderSubagentPersistence(options.resolveParentDirectory);
  }

  get durable(): boolean {
    return this.persistence !== undefined;
  }
  async hasStoredHistory(parentAgentId: string): Promise<boolean> {
    return this.persistence?.hasData(parentAgentId) ?? false;
  }

  async hydrate(parentAgentId: string): Promise<void> {
    if (!this.persistence || this.hydratedParents.has(parentAgentId)) return;
    const descriptors = await this.persistence.list(parentAgentId);
    this.ensureMetadataCapacity(parentAgentId, descriptors);
    for (const descriptor of descriptors) {
      this.descriptors.set(storeKey(parentAgentId, descriptor.id), {
        ...descriptor,
        runtimeAvailable: false,
      });
    }
    this.hydratedParents.add(parentAgentId);
    this.parentAccess.set(parentAgentId, Date.now());
  }

  async applyCommitted(
    parentAgentId: string,
    provider: AgentProvider,
    event: ProviderSubagentInputEvent,
    options?: { runtimeAvailable?: boolean },
  ): Promise<ProviderSubagentStoreEvent> {
    if (!this.persistence || !this.writable) return this.apply(parentAgentId, provider, event);
    if (event.type === "upsert") descriptorBytes(event);
    const release = pendingSessionEvents.reserve(parentAgentId, event);
    try {
      event = structuredClone(event);
      options = options ? { ...options } : undefined;
    } catch (error) {
      release();
      throw error;
    }
    const previous = this.operations.get(parentAgentId) ?? Promise.resolve();
    // An async IIFE rather than .then(): every branch below already returns its own
    // update, and the promise rule cannot see that through a then() callback.
    const operation = (async () => {
      await previous.catch(() => undefined);
      await this.hydrate(parentAgentId);
      const key = storeKey(parentAgentId, event.id);
      if (event.type === "upsert") {
        const subagent = {
          ...makeDescriptor(parentAgentId, provider, event, this.descriptors.get(key)),
          runtimeAvailable: options?.runtimeAvailable ?? false,
        };
        this.ensureMetadataCapacity(parentAgentId, [subagent]);
        const previousDescriptor = this.descriptors.get(key);
        this.metadataReservations.set(
          parentAgentId,
          Math.max(
            0,
            descriptorBytes(subagent) -
              (previousDescriptor ? descriptorBytes(previousDescriptor) : 0),
          ),
        );
        try {
          await this.persistence!.save({ type: "upsert", subagent });
          this.descriptors.set(key, { ...subagent });
          this.parentAccess.set(parentAgentId, Date.now());
          return { type: "upsert" as const, subagent };
        } finally {
          this.metadataReservations.delete(parentAgentId);
        }
      }
      if (event.type === "remove") {
        const update = { type: "remove" as const, parentAgentId, subagentId: event.id };
        await this.persistence!.save(update);
        this.apply(parentAgentId, provider, event);
        return update;
      }
      if (!this.timelines.has(key)) {
        const state = await this.persistence!.state(parentAgentId, event.id);
        this.timelines.initialize(key, state);
      }
      const update = this.applyTimeline(parentAgentId, provider, event, true);
      try {
        await this.persistence!.save(update);
      } finally {
        // On failure, reload the durable allocator before any subsequent event.
        this.timelines.delete(key);
      }
      return update;
    })();
    this.operations.set(parentAgentId, operation);
    try {
      return await operation;
    } finally {
      release();
      if (this.operations.get(parentAgentId) === operation) this.operations.delete(parentAgentId);
    }
  }

  async fetchCommittedTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    await this.operations.get(parentAgentId);
    return this.persistence
      ? this.persistence.fetch(parentAgentId, subagentId, options)
      : this.fetchTimeline(parentAgentId, subagentId, options);
  }

  async fetchProjectedCommittedTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ) {
    await this.operations.get(parentAgentId);
    return this.persistence
      ? this.persistence.fetchProjected(parentAgentId, subagentId, options)
      : null;
  }
  async readPayload(
    parentAgentId: string,
    subagentId: string,
    options: TimelineDocumentReadOptions,
  ) {
    await this.operations.get(parentAgentId);
    if (!this.persistence) throw new Error("Durable subagent history unavailable");
    return this.persistence.readPayload(parentAgentId, subagentId, options);
  }
  async readSourceRanges(
    parentAgentId: string,
    subagentId: string,
    options: TimelineDocumentReadOptions,
  ) {
    await this.operations.get(parentAgentId);
    if (!this.persistence) throw new Error("Durable subagent history unavailable");
    return this.persistence.readSourceRanges(parentAgentId, subagentId, options);
  }

  private ensureMetadataCapacity(
    currentParentId: string,
    changes: readonly ProviderSubagentDescriptor[],
  ): void {
    const updates = new Map(
      changes.map((descriptor) => [storeKey(currentParentId, descriptor.id), descriptor]),
    );
    const usage = () => {
      let total = 0;
      let parent = 0;
      for (const [key, descriptor] of this.descriptors) {
        if (updates.has(key)) continue;
        const bytes = descriptorBytes(descriptor);
        total += bytes;
        if (descriptor.parentAgentId === currentParentId) parent += bytes;
      }
      for (const descriptor of changes) {
        const bytes = descriptorBytes(descriptor);
        total += bytes;
        parent += bytes;
      }
      for (const bytes of this.metadataReservations.values()) total += bytes;
      return { total, parent };
    };
    let bytes = usage();
    if (bytes.parent > SUBAGENT_METADATA_LIMITS.cacheBytes)
      throw new Error("Provider subagent metadata exceeds cache byte budget");
    while (
      bytes.total > SUBAGENT_METADATA_LIMITS.cacheBytes ||
      this.hydratedParents.size + (this.hydratedParents.has(currentParentId) ? 0 : 1) >
        SUBAGENT_METADATA_LIMITS.parents
    ) {
      const oldest = [...this.parentAccess]
        .filter(([id]) => id !== currentParentId && !this.operations.has(id))
        .sort((a, b) => a[1] - b[1])[0];
      if (!oldest) throw new Error("Provider subagent metadata exceeds cache byte budget");
      this.deleteParent(oldest[0]);
      bytes = usage();
    }
  }

  async flushParent(parentAgentId: string): Promise<void> {
    await this.operations.get(parentAgentId);
  }

  async flush(): Promise<void> {
    await Promise.all(this.operations.values());
    await this.persistence?.flush();
  }

  apply(
    parentAgentId: string,
    provider: AgentProvider,
    event: ProviderSubagentInputEvent,
  ): ProviderSubagentStoreEvent {
    const key = storeKey(parentAgentId, event.id);
    if (event.type === "remove") {
      this.descriptors.delete(key);
      this.timelines.delete(key);
      return { type: "remove", parentAgentId, subagentId: event.id };
    }

    if (event.type === "timeline") {
      return this.applyTimeline(parentAgentId, provider, event, false);
    }

    const previous = this.descriptors.get(key);
    if (!this.timelines.has(key)) {
      this.timelines.initialize(key);
    }
    const subagent = makeDescriptor(parentAgentId, provider, event, previous);
    this.descriptors.set(key, subagent);
    return { type: "upsert", subagent };
  }
  private applyTimeline(
    parentAgentId: string,
    provider: AgentProvider,
    event: Extract<ProviderSubagentInputEvent, { type: "timeline" }>,
    retainFullContent: boolean,
  ): ProviderSubagentStoreEvent {
    const key = storeKey(parentAgentId, event.id);
    if (!this.timelines.has(key)) this.timelines.initialize(key);
    const row = this.timelines.append(
      key,
      retainFullContent ? event.item : limitAgentTimelineItemContent(event.item),
      { timestamp: event.timestamp },
    );
    return {
      type: "timeline",
      parentAgentId,
      subagentId: event.id,
      provider,
      row,
      epoch: this.timelines.getEpoch(key),
    };
  }

  list(parentAgentId: string): ProviderSubagentDescriptor[] {
    return [...this.descriptors.values()]
      .filter((subagent) => subagent.parentAgentId === parentAgentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((subagent) => Object.assign({}, subagent));
  }

  listAll(): ProviderSubagentDescriptor[] {
    return [...this.descriptors.values()].map((subagent) => Object.assign({}, subagent));
  }

  get(parentAgentId: string, subagentId: string): ProviderSubagentDescriptor | null {
    const descriptor = this.descriptors.get(storeKey(parentAgentId, subagentId));
    return descriptor ? { ...descriptor } : null;
  }

  fetchTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): AgentTimelineFetchResult {
    const direction = options?.direction ?? "tail";
    const limit = options?.limit === undefined ? 200 : Math.max(0, Math.floor(options.limit));
    const timeline = this.timelines.fetch(storeKey(parentAgentId, subagentId), {
      ...options,
      limit: 0,
    });
    if (limit === 0 || timeline.rows.length === 0) {
      return timeline;
    }
    const selected = selectTimelineWindowByProjectedLimit({
      rows: timeline.rows,
      direction: timeline.reset ? "tail" : direction,
      limit,
    });
    const firstRow = selected.selectedRows[0];
    const lastRow = selected.selectedRows[selected.selectedRows.length - 1];
    return {
      ...timeline,
      rows: selected.selectedRows,
      hasOlder:
        timeline.hasOlder || (firstRow !== undefined && firstRow.seq > timeline.window.minSeq),
      hasNewer:
        timeline.hasNewer || (lastRow !== undefined && lastRow.seq < timeline.window.maxSeq),
    };
  }

  deleteParent(parentAgentId: string): ProviderSubagentStoreEvent[] {
    this.hydratedParents.delete(parentAgentId);
    this.parentAccess.delete(parentAgentId);
    const events: ProviderSubagentStoreEvent[] = [];
    for (const subagent of this.list(parentAgentId)) {
      const key = storeKey(parentAgentId, subagent.id);
      this.descriptors.delete(key);
      this.timelines.delete(key);
      events.push({ type: "remove", parentAgentId, subagentId: subagent.id });
    }
    return events;
  }
}
