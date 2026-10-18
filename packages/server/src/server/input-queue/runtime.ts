import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { InputQueueCommand, InputQueueView } from "@clisbot/protocol/input-queue";
import { sessionActorKey } from "@clisbot/protocol/session-authorship";
import { sessionOperationContent } from "@clisbot/protocol/session-operation";
import {
  currentSessionOperationIdentity,
  withSessionOperationIdentity,
} from "../agent/session-operation-context.js";
import type { ChatMessageFiles } from "../chats/chat-engine.js";
import type { attachSessionFiles } from "../file-upload/session-files.js";
import { queueFileStorage } from "./file-storage.js";
import {
  InputQueueStore,
  QueueConflict,
  QueueSnapshotSchema,
  type QueueSnapshot,
  type QueueStorage,
  type QueueItem,
} from "./input-queue-store.js";
import { hydrateQueueContent, prepareQueueFiles, readQueueFileChunk } from "./files.js";
import { StoredQueueContentSchema, type StoredQueueContent } from "./content.js";

interface QueueContentInput extends ChatMessageFiles {
  text: string;
}
export interface QueueTarget {
  directory: string;
  ready(): Promise<boolean>;
  delivered(id: string, content?: QueueContentInput): Promise<boolean>;
  handoff(
    id: string,
    content: StoredQueueContent,
    interrupt?: boolean,
    steerTarget?: { agentId: string; turnId: string },
  ): Promise<void>;
}
export interface QueueFileAuthority {
  ownsUpload: Parameters<typeof attachSessionFiles>[0]["ownsUpload"];
  resolveForkSource?: Parameters<typeof attachSessionFiles>[0]["resolveForkSource"];
}
interface QueueCommandResult {
  fileChunk?: { data: string; done: boolean };
  queue: InputQueueView;
  error: string | null;
  unchanged?: boolean;
  errorCode?: string;
}
interface TargetState {
  target: QueueTarget;
  queue: InputQueueStore;
  recovering: Promise<void>;
  draining?: Promise<void>;
  drainAgain?: boolean;
}
type EnqueueCommand = Extract<InputQueueCommand, { action: "enqueue" }>;
type EditCommand = Extract<InputQueueCommand, { text: string; revision: number }>;
const LOCAL_OWNER = { kind: "user", id: "owner" } as const;

function validatedStorage(directory: string): QueueStorage {
  const storage = queueFileStorage(directory);
  return {
    async read() {
      const raw = await storage.read();
      if (raw !== null)
        for (const item of QueueSnapshotSchema.parse(raw).items)
          StoredQueueContentSchema.parse(item.payload);
      return raw;
    },
    async write(snapshot) {
      let bytes = 0;
      for (const item of snapshot.items) {
        for (const file of StoredQueueContentSchema.parse(item.payload).files) {
          if (file.size > 50 * 1024 * 1024) throw new Error("Queued file exceeds 50 MB");
          bytes += file.size;
        }
      }
      if (bytes > 100 * 1024 * 1024) throw new Error("Queue attachments exceed 100 MB");
      await storage.write(snapshot);
    },
  };
}

/** Shared admission. The existing run/discussion owner decides when each target is ready. */
export class InputQueueRuntime {
  private readonly targets = new Map<string, TargetState>();
  private stopped = false;
  private readonly commands = new Set<Promise<QueueCommandResult>>();
  constructor(private readonly logger: Logger) {}

  register(key: string, target: QueueTarget): void {
    if (this.stopped || this.targets.has(key)) return;
    const queue = new InputQueueStore(validatedStorage(target.directory));
    const recovering = queue.recover((item) => this.recoveredDelivery(target, item));
    this.targets.set(key, { queue, target, recovering });
    void recovering
      .then(() => this.wake(key))
      .catch((err) => this.logger.error({ err, key }, "Queue recovery failed; target paused"));
  }

  private async recoveredDelivery(target: QueueTarget, item: QueueItem): Promise<boolean> {
    try {
      const content = StoredQueueContentSchema.parse(item.payload);
      const payload = await hydrateQueueContent(target.directory, content);
      return await withSessionOperationIdentity(content.identity, () =>
        target.delivered(item.id, payload),
      );
    } catch (err) {
      this.logger.warn(
        { err, id: item.id },
        "Queue recovery could not corroborate accepted handoff",
      );
      return false;
    }
  }

  command(
    key: string,
    operation: InputQueueCommand,
    authority: QueueFileAuthority,
  ): Promise<QueueCommandResult> {
    if (this.stopped) return Promise.reject(new Error("Host queue is shutting down"));
    const pending = this.executeCommand(key, operation, authority);
    this.commands.add(pending);
    void pending.finally(() => this.commands.delete(pending)).catch(() => undefined);
    return pending;
  }

  private async executeCommand(
    key: string,
    command: InputQueueCommand,
    authority: QueueFileAuthority,
  ): Promise<QueueCommandResult> {
    const state = this.targets.get(key);
    if (!state) throw new Error("Queue target is unavailable");
    await state.recovering;
    try {
      if (command.action === "read_file") return this.readFile(state, command);
      const snapshot = await this.execute(state, command, authority);
      if (command.action === "fetch" && command.revision === snapshot.revision)
        return { queue: { revision: snapshot.revision, items: [] }, error: null, unchanged: true };
      this.wake(key);
      return { queue: await this.view(state.target, snapshot), error: null };
    } catch (error) {
      if (!(error instanceof QueueConflict)) throw error;
      return {
        queue: await this.view(state.target, error.snapshot),
        error: error.message,
        errorCode: "queue_conflict",
      };
    }
  }

  private async readFile(
    state: TargetState,
    command: Extract<InputQueueCommand, { action: "read_file" }>,
  ): Promise<QueueCommandResult> {
    const snapshot = await state.queue.read();
    const item = snapshot.items.find((value) => value.id === command.id);
    if (!item) throw new QueueConflict("Item has already started or was deleted", snapshot);
    const fileChunk = await readQueueFileChunk(
      state.target.directory,
      StoredQueueContentSchema.parse(item.payload),
      command.fileId,
      command.offset,
    );
    return {
      queue: { revision: snapshot.revision, items: [] },
      unchanged: true,
      fileChunk,
      error: null,
    };
  }

  private async execute(
    state: TargetState,
    command: Exclude<InputQueueCommand, { action: "read_file" }>,
    authority: QueueFileAuthority,
  ): Promise<QueueSnapshot> {
    if (command.action === "fetch") return state.queue.read();
    if (command.action === "enqueue") return this.enqueue(state, command, authority);
    if (command.action === "send_now" || command.action === "steer_now") {
      const item = await state.queue.claim(command.id, command.revision);
      if (!item)
        throw new QueueConflict(
          "Item has already started or was deleted",
          await state.queue.read(),
        );
      await this.handoff(
        state,
        item.id,
        StoredQueueContentSchema.parse(item.payload),
        command.action === "send_now",
        command.action === "steer_now" ? command.target : undefined,
      );
      return state.queue.read();
    }
    return state.queue.mutate({
      ...command,
      action: command.action as "update" | "move_to_end" | "delete" | "discard",
      prepare:
        command.action === "update" || command.action === "move_to_end"
          ? (item) => this.prepareEdit(state, command as EditCommand, authority, item)
          : undefined,
    });
  }

  private async enqueue(
    { queue, target }: TargetState,
    command: EnqueueCommand,
    authority: QueueFileAuthority,
  ): Promise<QueueSnapshot> {
    const identity = currentSessionOperationIdentity() ?? {};
    const fingerprint = digest(command);
    const senderId = sessionActorKey(identity.actor ?? LOCAL_OWNER);
    const matches = (item: QueueItem) =>
      StoredQueueContentSchema.parse(item.payload).fingerprint === fingerprint;
    const existing = (await queue.read()).items.find((item) => item.id === command.id);
    if (existing) {
      if (!matches(existing) || existing.senderId !== senderId)
        throw new QueueConflict("Queue ID conflicts with accepted content", await queue.read());
      return queue.read();
    }
    return queue.enqueue(
      { id: command.id, senderId, createdAt: new Date().toISOString(), payload: undefined },
      {
        delivered: () => target.delivered(command.id, command),
        matches,
        prepare: (snapshot) =>
          prepareQueueFiles({
            directory: target.directory,
            text: command.text,
            files: command,
            ...authority,
            identity,
            fingerprint,
            retainedFiles: snapshot.items.flatMap(
              (queued) => StoredQueueContentSchema.parse(queued.payload).files,
            ),
          }),
      },
    );
  }

  private prepareEdit(
    { target }: TargetState,
    command: EditCommand,
    authority: QueueFileAuthority,
    item: QueueItem,
  ): Promise<StoredQueueContent> {
    const previous = StoredQueueContentSchema.parse(item.payload);
    return prepareQueueFiles({
      directory: target.directory,
      text: command.text,
      files: command,
      ...authority,
      previous,
      identity: previous.identity,
      fingerprint: digest(command),
    });
  }

  private async view(target: QueueTarget, snapshot: QueueSnapshot): Promise<InputQueueView> {
    return {
      revision: snapshot.revision,
      items: await Promise.all(
        snapshot.items.map(async (item) => {
          const content = StoredQueueContentSchema.parse(item.payload);
          const metadata = {
            id: item.id,
            createdAt: item.createdAt,
            state: item.state,
            reason: item.reason,
          };
          try {
            return { ...metadata, ...(await hydrateQueueContent(target.directory, content)) };
          } catch (error) {
            return {
              ...metadata,
              reason: error instanceof Error ? error.message : "Attachment unavailable",
              text: content.text,
              attachments: content.attachments,
            };
          }
        }),
      ),
    };
  }

  wake(key?: string): void {
    if (this.stopped) return;
    for (const [name, state] of this.targets) {
      if (key && key !== name) continue;
      if (state.draining) {
        state.drainAgain = true;
        continue;
      }
      state.draining = this.drain(state)
        .catch((err) => this.logger.error({ err, key: name }, "Queue drain paused"))
        .finally(() => {
          state.draining = undefined;
          if (state.drainAgain) {
            state.drainAgain = false;
            this.wake(name);
          }
        });
    }
  }

  private async drain(state: TargetState): Promise<void> {
    await state.recovering;
    if (
      this.stopped ||
      (await state.queue.read()).items[0]?.state !== "queued" ||
      !(await state.target.ready())
    )
      return;
    const item = await state.queue.claim();
    if (!item) return;
    await this.handoff(state, item.id, StoredQueueContentSchema.parse(item.payload));
    this.wake();
  }

  private async handoff(
    { target, queue }: TargetState,
    id: string,
    content: StoredQueueContent,
    interrupt = false,
    steerTarget?: { agentId: string; turnId: string },
  ): Promise<void> {
    try {
      await withSessionOperationIdentity(content.identity, () =>
        target.handoff(id, content, interrupt, steerTarget),
      );
      if (!(await target.delivered(id))) throw new Error("Durable handoff has not been confirmed");
      await queue.settle(id, "handed_off");
    } catch (error) {
      await queue.settle(
        id,
        "unknown",
        error instanceof Error ? error.message : "Delivery outcome unknown",
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([
      ...this.commands,
      ...[...this.targets.values()].flatMap((state) => [state.recovering, state.draining]),
    ]);
  }
}
function digest(command: InputQueueCommand): string {
  const { action: _action, ...content } = command;
  return createHash("sha256").update(sessionOperationContent(content)).digest("hex");
}
