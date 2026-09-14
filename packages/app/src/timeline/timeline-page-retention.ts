/** Metadata only. Timeline payloads remain in the existing session/subagent stores. */
export interface RetainedTimelinePage {
  epoch: string;
  startSeq: number;
  endSeq: number;
  itemIds: readonly string[];
  sourceSeqRanges: readonly { startSeq: number; endSeq: number }[];
  bytes: number;
  itemBytes?: Readonly<Record<string, number>>;
  hasOlder: boolean;
}
export interface TimelineRetentionChange {
  keepItemIds: ReadonlySet<string>;
  range: {
    epoch: string;
    startSeq: number;
    endSeq: number;
    retainedRanges?: { startSeq: number; endSeq: number; hasOlder?: boolean }[];
  } | null;
  hasOlder: boolean;
}
interface StoredPage extends RetainedTimelinePage {
  accessed: number;
  metadataBytes: number;
}
interface TimelineOwner {
  sessionKey: string;
  pages: Map<string, StoredPage>;
  bytes: number;
  pinnedBytes: number;
  visible: boolean;
  readingItemId: string | null;
  changed: (change: TimelineRetentionChange) => void;
}
export const TIMELINE_MEMORY_LIMITS = {
  sessionBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  pageMetadataBytes: 256,
  ownerMetadataBytes: 256,
};
function pageKey(page: RetainedTimelinePage): string {
  return JSON.stringify([page.epoch, page.startSeq, page.endSeq]);
}
function retainedRange(pages: Iterable<StoredPage>): TimelineRetentionChange {
  const sorted = [...pages].sort((left, right) => left.startSeq - right.startSeq);
  const ranges: { startSeq: number; endSeq: number; hasOlder?: boolean }[] = [];
  const keepItemIds = new Set<string>();
  for (const page of sorted) {
    for (const id of page.itemIds) keepItemIds.add(id);
    const previous = ranges.at(-1);
    if (previous && page.startSeq <= previous.endSeq + 1)
      previous.endSeq = Math.max(previous.endSeq, page.endSeq);
    else ranges.push({ startSeq: page.startSeq, endSeq: page.endSeq, hasOlder: page.hasOlder });
  }
  const latest = ranges.pop();
  if (!latest) return { keepItemIds, range: null, hasOlder: false };
  return {
    keepItemIds,
    range: {
      epoch: sorted[0].epoch,
      startSeq: latest.startSeq,
      endSeq: latest.endSeq,
      ...(ranges.length ? { retainedRanges: ranges } : {}),
    },
    hasOlder: latest.hasOlder ?? true,
  };
}

function measurePages(pages: Iterable<StoredPage>): number {
  let bytes = 0;
  const items = new Map<string, number>();
  for (const page of pages) {
    bytes += page.metadataBytes;
    if (!page.itemBytes) {
      bytes += page.bytes;
      continue;
    }
    for (const [id, size] of Object.entries(page.itemBytes))
      items.set(id, Math.max(items.get(id) ?? 0, size));
  }
  for (const size of items.values()) bytes += size;
  return bytes;
}

/** One process-wide admission budget spans hosts and hidden tabs without copying payloads. */
export class TimelinePageRetention {
  private readonly owners = new Map<string, TimelineOwner>();
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private bytes = 0;
  private pendingBytes = 0;
  private readonly pendingByKey = new Map<string, number>();
  private clock = 0;
  constructor(
    private readonly limits: {
      sessionBytes: number;
      totalBytes: number;
      pageMetadataBytes: number;
      ownerMetadataBytes?: number;
    } = TIMELINE_MEMORY_LIMITS,
  ) {}
  register(key: string, changed: TimelineOwner["changed"], sessionKey = key): () => void {
    this.remove(key);
    this.owners.set(key, {
      sessionKey,
      pages: new Map(),
      bytes: this.limits.ownerMetadataBytes ?? 0,
      pinnedBytes: 0,
      visible: false,
      readingItemId: null,
      changed,
    });
    this.bytes += this.limits.ownerMetadataBytes ?? 0;
    this.enforce();
    if (
      this.bytes + this.pendingBytes > this.limits.totalBytes ||
      this.sessionBytes(sessionKey) > this.limits.sessionBytes
    ) {
      this.remove(key);
      throw new Error("Timeline retention owner metadata exceeds its memory budget");
    }
    const registered = this.owners.get(key);
    return () => {
      if (this.owners.get(key) === registered) this.remove(key);
    };
  }
  private remove(key: string): void {
    const owner = this.owners.get(key);
    if (!owner) return;
    this.bytes -= owner.bytes;
    this.owners.delete(key);
  }
  private sessionBytes(sessionKey: string): number {
    let bytes = 0;
    for (const [key, owner] of this.owners)
      if (owner.sessionKey === sessionKey) bytes += owner.bytes + (this.pendingByKey.get(key) ?? 0);
    return bytes;
  }
  private protectedPage(owner: TimelineOwner): StoredPage | undefined {
    if (!owner.visible) return undefined;
    let latest: StoredPage | undefined;
    let reading: StoredPage | undefined;
    for (const page of owner.pages.values()) {
      if (!latest || page.endSeq > latest.endSeq) latest = page;
      if (
        owner.readingItemId &&
        page.itemIds.includes(owner.readingItemId) &&
        (!reading || page.accessed > reading.accessed)
      )
        reading = page;
    }
    return reading ?? latest;
  }
  setReading(key: string, visible: boolean, itemId: string | null): void {
    const owner = this.owners.get(key);
    if (!owner) return;
    owner.visible = visible;
    owner.readingItemId = itemId;
    const page = this.protectedPage(owner);
    if (page) page.accessed = ++this.clock;
    this.enforce();
  }
  setPinnedBytes(key: string, bytes: number): boolean {
    const owner = this.owners.get(key);
    if (!owner || bytes > this.limits.sessionBytes) return false;
    const previous = owner.pinnedBytes;
    owner.pinnedBytes = bytes;
    this.recount(owner);
    this.enforce();
    if (
      this.sessionBytes(owner.sessionKey) > this.limits.sessionBytes ||
      this.bytes + this.pendingBytes > this.limits.totalBytes
    ) {
      owner.pinnedBytes = previous;
      this.recount(owner);
      return false;
    }
    return true;
  }
  reserve(key: string, bytes: number): (() => void) | null {
    const owner = this.owners.get(key);
    if (!owner || bytes > this.limits.sessionBytes) return null;
    const pending = this.pendingByKey.get(key) ?? 0;
    this.pendingByKey.set(key, pending + bytes);
    this.pendingBytes += bytes;
    this.enforce();
    if (
      this.sessionBytes(owner.sessionKey) > this.limits.sessionBytes ||
      this.bytes + this.pendingBytes > this.limits.totalBytes
    ) {
      this.pendingBytes -= bytes;
      if (pending) this.pendingByKey.set(key, pending);
      else this.pendingByKey.delete(key);
      return null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingBytes -= bytes;
      const next = (this.pendingByKey.get(key) ?? bytes) - bytes;
      if (next) this.pendingByKey.set(key, next);
      else this.pendingByKey.delete(key);
    };
  }
  canPrefetch(key: string, estimatedBytes = this.limits.sessionBytes / 4): boolean {
    const owner = this.owners.get(key);
    return Boolean(
      owner?.visible &&
      this.sessionBytes(owner.sessionKey) + estimatedBytes <= this.limits.sessionBytes &&
      this.bytes + this.pendingBytes + estimatedBytes <= this.limits.totalBytes,
    );
  }
  private exceedsPinnedBudget(owner: TimelineOwner, page: StoredPage): boolean {
    let protectedBytes = 0;
    const sessions = new Map<string, number>();
    for (const [key, candidate] of this.owners) {
      const pinned = this.protectedPage(candidate);
      const pages: StoredPage[] = candidate === owner ? [page] : [];
      if (
        pinned &&
        !(
          candidate === owner &&
          (pinned.epoch !== page.epoch ||
            pageKey(pinned) === pageKey(page) ||
            (!owner.readingItemId && page.endSeq >= pinned.endSeq) ||
            (owner.readingItemId && page.itemIds.includes(owner.readingItemId)))
        )
      )
        pages.push(pinned);
      const bytes =
        measurePages(pages) +
        candidate.pinnedBytes +
        (this.limits.ownerMetadataBytes ?? 0) +
        (this.pendingByKey.get(key) ?? 0);
      const sessionBytes = (sessions.get(candidate.sessionKey) ?? 0) + bytes;
      if (sessionBytes > this.limits.sessionBytes) return true;
      sessions.set(candidate.sessionKey, sessionBytes);
      protectedBytes += bytes;
    }
    return protectedBytes > this.limits.totalBytes;
  }
  private recount(owner: TimelineOwner): void {
    const bytes =
      measurePages(owner.pages.values()) +
      owner.pinnedBytes +
      (this.limits.ownerMetadataBytes ?? 0);
    this.bytes += bytes - owner.bytes;
    owner.bytes = bytes;
  }
  retain(key: string, page: RetainedTimelinePage): boolean {
    const owner = this.owners.get(key);
    if (!owner) throw new Error("Timeline retention owner is not registered");
    const stored: StoredPage = {
      ...page,
      metadataBytes:
        this.limits.pageMetadataBytes +
        page.itemIds.reduce((bytes, id) => bytes + id.length * 2 + 32, 0) +
        page.sourceSeqRanges.length * 32,
      itemIds: [...page.itemIds],
      ...(page.itemBytes ? { itemBytes: { ...page.itemBytes } } : {}),
      sourceSeqRanges: page.sourceSeqRanges.map((range) => ({ ...range })),
      accessed: ++this.clock,
    };
    const cost = measurePages([stored]);
    if (
      cost > this.limits.sessionBytes ||
      cost > this.limits.totalBytes ||
      this.exceedsPinnedBudget(owner, stored)
    )
      return false;
    const previous = owner.pages.values().next().value as StoredPage | undefined;
    if (previous && previous.epoch !== page.epoch) {
      owner.pages.clear();
      this.recount(owner);
    }
    const id = pageKey(page);
    owner.pages.set(id, stored);
    this.recount(owner);
    this.enforce();
    return owner.pages.has(id);
  }
  private oldestCandidate(
    sessionKey?: string,
  ): { owner: TimelineOwner; key: string; page: StoredPage } | undefined {
    let oldest: { owner: TimelineOwner; key: string; page: StoredPage } | undefined;
    for (const owner of this.owners.values()) {
      if (sessionKey && owner.sessionKey !== sessionKey) continue;
      const protectedPage = this.protectedPage(owner);
      for (const [key, page] of owner.pages) {
        if (page === protectedPage) continue;
        if (!oldest || page.accessed < oldest.page.accessed) oldest = { owner, key, page };
      }
    }
    return oldest;
  }
  private enforce(): void {
    const changed = new Set<TimelineOwner>();
    for (const owner of this.owners.values()) {
      while (this.sessionBytes(owner.sessionKey) > this.limits.sessionBytes) {
        const candidate = this.oldestCandidate(owner.sessionKey);
        if (!candidate) break;
        this.evict(candidate, changed);
      }
    }
    while (this.bytes + this.pendingBytes > this.limits.totalBytes) {
      const candidate = this.oldestCandidate();
      if (!candidate) break;
      this.evict(candidate, changed);
    }
    for (const owner of changed) owner.changed(retainedRange(owner.pages.values()));
    for (const listener of this.listeners) listener();
  }
  private evict(
    candidate: { owner: TimelineOwner; key: string; page: StoredPage },
    changed: Set<TimelineOwner>,
  ): void {
    candidate.owner.pages.delete(candidate.key);
    this.recount(candidate.owner);
    changed.add(candidate.owner);
  }
  readRange(key: string): TimelineRetentionChange | undefined {
    const owner = this.owners.get(key);
    return owner ? retainedRange(owner.pages.values()) : undefined;
  }
  get retainedBytes(): number {
    return this.bytes + this.pendingBytes;
  }
}

export const timelinePageRetention = new TimelinePageRetention();
export function timelineRetentionKey(serverId: string, agentId: string): string {
  return JSON.stringify([serverId, "agent", agentId]);
}
