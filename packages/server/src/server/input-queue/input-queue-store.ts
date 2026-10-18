import { z } from "zod";

export const QueueItemSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.string(),
    senderId: z.string(),
    state: z.enum(["queued", "sending", "needs_review"]),
    reason: z.string().optional(),
    // Payload is validated by the target adapter before admission.
    payload: z.unknown(),
  })
  .strict();
export const QueueSnapshotSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    items: z.array(QueueItemSchema).max(32),
  })
  .strict();
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

export interface QueueStorage {
  read(): Promise<unknown | null>;
  write(snapshot: QueueSnapshot): Promise<void>;
}

export class QueueConflict extends Error {
  constructor(
    message: string,
    readonly snapshot: QueueSnapshot,
  ) {
    super(message);
  }
}

/** One target, one writer. No lock is held across provider/network work. */
export class InputQueueStore {
  private tail: Promise<unknown> = Promise.resolve();
  private snapshot: QueueSnapshot | undefined;
  constructor(private readonly storage: QueueStorage) {}

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(run);
    this.tail = result;
    return result;
  }
  private async load(): Promise<QueueSnapshot> {
    if (!this.snapshot) {
      const raw = await this.storage.read();
      this.snapshot =
        raw === null ? { version: 1, revision: 0, items: [] } : QueueSnapshotSchema.parse(raw);
    }
    if (new Set(this.snapshot.items.map((item) => item.id)).size !== this.snapshot.items.length)
      throw new Error("Queue snapshot contains duplicate identities");
    return structuredClone(this.snapshot);
  }
  private async commit(next: QueueSnapshot): Promise<QueueSnapshot> {
    next.revision += 1;
    const checked = QueueSnapshotSchema.parse(next);
    if (Buffer.byteLength(JSON.stringify(checked)) > 2 * 1024 * 1024)
      throw new Error("Queue metadata limit exceeded");
    await this.storage.write(checked);
    this.snapshot = checked;
    return structuredClone(checked);
  }
  read(): Promise<QueueSnapshot> {
    return this.serial(() => this.load());
  }
  enqueue(
    item: Omit<QueueItem, "state">,
    options?: {
      delivered: () => Promise<boolean>;
      prepare: (snapshot: QueueSnapshot) => Promise<unknown>;
      matches?: (item: QueueItem) => boolean;
    },
  ): Promise<QueueSnapshot> {
    return this.serial(async () => {
      const next = await this.load();
      const existing = next.items.find((value) => value.id === item.id);
      if (existing) {
        if (
          existing.senderId !== item.senderId ||
          (options?.matches
            ? !options.matches(existing)
            : JSON.stringify(existing.payload) !== JSON.stringify(item.payload))
        )
          throw new QueueConflict("Queue ID conflicts with accepted content", next);
        return next;
      }
      if (options && (await options.delivered())) return next;
      if (next.items.length >= 32) throw new Error("Queue is full (32 items)");
      const payload = options ? await options.prepare(structuredClone(next)) : item.payload;
      next.items.push({ ...structuredClone(item), payload, state: "queued" });
      return this.commit(next);
    });
  }
  mutate(input: {
    id: string;
    revision: number;
    action: "update" | "move_to_end" | "delete" | "discard";
    payload?: unknown;
    prepare?: (item: QueueItem) => Promise<unknown>;
  }): Promise<QueueSnapshot> {
    return this.serial(async () => {
      const next = await this.load();
      const index = next.items.findIndex((item) => item.id === input.id);
      const item = next.items[index];
      if (next.revision !== input.revision)
        throw new QueueConflict("Queue changed; refresh before saving", next);
      if (!item)
        throw new QueueConflict("Item has already started or was deleted; draft retained", next);
      if (item.state !== "queued" && !(input.action === "discard" && item.state === "needs_review"))
        throw new QueueConflict("Item has already started; draft retained", next);
      if (input.action === "delete" || input.action === "discard") next.items.splice(index, 1);
      else {
        item.payload = input.prepare
          ? await input.prepare(structuredClone(item))
          : structuredClone(input.payload);
        if (input.action === "move_to_end") {
          next.items.splice(index, 1);
          next.items.push(item);
        }
      }
      return this.commit(next);
    });
  }
  claim(id?: string, revision?: number): Promise<QueueItem | null> {
    return this.serial(async () => {
      const next = await this.load();
      if (revision !== undefined && next.revision !== revision)
        throw new QueueConflict("Queue changed; refresh before sending", next);
      if (next.items.some((item) => item.state === "sending")) return null;
      const first = id ? next.items.find((item) => item.id === id) : next.items[0];
      if (!first || first.state !== "queued") return null;
      first.state = "sending";
      await this.commit(next);
      return structuredClone(first);
    });
  }
  settle(id: string, outcome: "handed_off" | "unknown", reason?: string): Promise<QueueSnapshot> {
    return this.serial(async () => {
      const next = await this.load();
      const item = next.items.find((value) => value.id === id);
      if (!item || item.state !== "sending") return next;
      if (outcome === "handed_off") next.items = next.items.filter((value) => value.id !== id);
      else {
        item.state = "needs_review";
        item.reason =
          reason ?? "Delivery outcome is unknown; check the transcript before resending";
      }
      return this.commit(next);
    });
  }
  /** Only the existing durable owner may prove handoff after restart. */
  async recover(proof: (item: QueueItem) => Promise<boolean>): Promise<void> {
    for (const item of (await this.read()).items) {
      if (item.state === "sending")
        await this.settle(item.id, (await proof(item)) ? "handed_off" : "unknown");
    }
  }
}
