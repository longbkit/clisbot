import { createClientInputQueue } from "@/composer/client-input-queue";
import type { QueuedComposerMessage, QueueWriter } from "@/composer/actions";
import { composerAttachmentIds } from "@/composer/attachment-references";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";

export interface ChatQueueDependencies {
  prepare(
    item: QueuedComposerMessage,
    behavior?: "steer" | "interrupt" | "send",
  ): Promise<null | (() => Promise<{ targets?: readonly string[] }>)>;
  changed(): void;
  admit?(): void;
}
export class ChatQueueNotReady extends Error {}

/** One bounded app-memory FIFO per principal/Host/Chat. It never owns a participant session. */
export class ClientChatQueue {
  manualDelivery = false;
  setManualDelivery(value: boolean) {
    if (this.manualDelivery === value) return;
    this.manualDelivery = value;
    this.replace([...this.items]);
  }
  private items: QueuedComposerMessage[] = [];
  private listeners = new Set<() => void>();
  private checking = false;
  private flight: symbol | null = null;
  private gate: { id: string; busySeen: boolean; settled: boolean } | null = null;
  private retained: (() => void)[] = [];
  readonly writer: QueueWriter = {
    read: () => this.items,
    write: (update) => {
      const next = update(new Map([["chat", this.items]])).get("chat") ?? [];
      this.replace(next);
    },
  };
  readonly local = createClientInputQueue(this.writer, "chat");
  constructor(private readonly deps: ChatQueueDependencies) {}
  get waitingMessageId() {
    return this.gate && !this.gate.settled ? this.gate.id : null;
  }
  get observed() {
    return this.listeners.size > 0;
  }
  get hasWork() {
    return this.items.length > 0 || Boolean(this.gate && !this.gate.settled);
  }
  snapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private replace(items: QueuedComposerMessage[]) {
    if (!this.items.length && items.length) this.deps.admit?.();
    if (items.length > 100) throw new Error("Client Chat queue is full (100 items)");
    const retained = items
      .flatMap((item) => [...composerAttachmentIds(item.attachments)])
      .map(retainAttachmentForGarbageCollection);
    for (const release of this.retained) release();
    this.retained = retained;
    this.items = items;
    for (const listener of this.listeners) listener();
    this.deps.changed();
  }
  remove = (id: string) => {
    if (this.local.read(id)?.state === "sending") return;
    this.local.remove(id);
    if (this.gate?.id === id) this.gate = null;
  };
  observe(busy: boolean | null, replyTo?: string) {
    if (!this.gate) return;
    if (busy === true) this.gate.busySeen = true;
    if ((busy === false && this.gate.busySeen) || replyTo === this.gate.id)
      this.gate.settled = true;
  }
  pump = () => {
    if (this.checking || this.flight || (this.gate && !this.gate.settled)) return;
    const head = this.items[0];
    if (!head || (head.state && head.state !== "queued")) return;
    void this.attempt(head.id);
  };
  dispatch = async (id: string, behavior: "steer" | "interrupt" | "send") => {
    if (this.checking || this.flight) return;
    await this.attempt(id, behavior);
  };
  private async attempt(id: string, behavior?: "steer" | "interrupt" | "send") {
    const item = this.local.read(id);
    if (!item || (item.state && item.state !== "queued")) return;
    this.checking = true;
    try {
      const send = await this.deps.prepare(item, behavior);
      if (!send || this.local.read(id) !== item) return;
      await this.handoff(item, send);
      queueMicrotask(() => this.deps.changed());
    } catch (error) {
      if (behavior) throw error;
      if (!(error instanceof ChatQueueNotReady) && this.local.read(id) === item)
        this.mark(id, "needs_review", String(error));
    } finally {
      this.checking = false;
      if (this.local.read(id) !== item) this.deps.changed();
    }
  }
  private async handoff(
    item: QueuedComposerMessage,
    send: () => Promise<{ targets?: readonly string[] }>,
  ) {
    const token = Symbol("Chat client queue handoff");
    this.flight = token;
    this.gate = { id: item.id, busySeen: false, settled: false };
    this.mark(item.id, "sending");
    try {
      const result = await send();
      if (this.flight !== token) return;
      this.local.remove(item.id);
      if (result.targets?.length === 0) this.gate = null;
    } catch (error) {
      if (this.flight !== token) return;
      if (error instanceof ChatQueueNotReady) {
        this.mark(item.id, "queued");
        this.gate = null;
      } else this.mark(item.id, "needs_review", String(error));
    } finally {
      if (this.flight === token) this.flight = null;
    }
  }
  private mark(id: string, state: NonNullable<QueuedComposerMessage["state"]>, reason?: string) {
    this.replace(
      this.items.map((item) =>
        item.id === id
          ? {
              id: item.id,
              text: item.text,
              attachments: item.attachments,
              state,
              ...(reason ? { reason } : {}),
            }
          : item,
      ),
    );
  }
}
