import type { StoredFollowUpState } from "./follow-up-policy.ts";
import type { StoredIntervalLoop } from "./loop-state.ts";
import type { StoredSessionRuntime } from "./run-observation.ts";
import type { StoredRecentConversationState } from "../shared/recent-message-context.ts";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { ensureDir } from "../shared/paths.ts";

export type StoredSessionEntry = {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  workspacePath: string;
  runnerCommand: string;
  followUp?: StoredFollowUpState;
  runtime?: StoredSessionRuntime;
  intervalLoops?: StoredIntervalLoop[];
  recentConversation?: StoredRecentConversationState;
  updatedAt: number;
};

type SessionStoreShape = Record<string, StoredSessionEntry>;

export class SessionStore {
  private static readonly pathLocks = new Map<string, Promise<void>>();

  constructor(private readonly storePath: string) {}

  async list(): Promise<StoredSessionEntry[]> {
    return this.withPathLock(async () => {
      const store = await this.readStore();
      return Object.values(store);
    });
  }

  async get(sessionKey: string): Promise<StoredSessionEntry | null> {
    return this.withPathLock(async () => {
      const store = await this.readStore();
      return store[sessionKey] ?? null;
    });
  }

  async put(entry: StoredSessionEntry) {
    return this.withPathLock(async () => {
      const store = await this.readStore();
      store[entry.sessionKey] = entry;
      await this.writeStore(store);
      return entry;
    });
  }

  async update(
    sessionKey: string,
    updater: (entry: StoredSessionEntry | null) => StoredSessionEntry | null,
  ) {
    return this.withPathLock(async () => {
      const store = await this.readStore();
      const next = updater(store[sessionKey] ?? null);
      if (next) {
        store[sessionKey] = next;
      } else {
        delete store[sessionKey];
      }
      await this.writeStore(store);
      return next;
    });
  }

  async touch(params: {
    sessionKey: string;
    agentId: string;
    sessionId?: string | null;
    workspacePath: string;
    runnerCommand: string;
  }) {
    const existing = await this.get(params.sessionKey);
    const sessionId = params.sessionId?.trim() || existing?.sessionId;
    if (!sessionId) {
      return null;
    }

    return this.put({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId,
      workspacePath: params.workspacePath,
      runnerCommand: params.runnerCommand,
      followUp: existing?.followUp,
      runtime: existing?.runtime,
      intervalLoops: existing?.intervalLoops,
      recentConversation: existing?.recentConversation,
      updatedAt: Date.now(),
    });
  }

  private async withPathLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = SessionStore.pathLocks.get(this.storePath) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockPromise = previous.then(() => next);
    SessionStore.pathLocks.set(this.storePath, lockPromise);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (SessionStore.pathLocks.get(this.storePath) === lockPromise) {
        SessionStore.pathLocks.delete(this.storePath);
      }
    }
  }

  private async readStore(): Promise<SessionStoreShape> {
    if (!(await fileExists(this.storePath))) {
      return {};
    }

    const text = await readTextFile(this.storePath);
    if (!text.trim()) {
      return {};
    }

    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as SessionStoreShape;
  }

  private async writeStore(store: SessionStoreShape) {
    await ensureDir(dirname(this.storePath));
    const tempPath = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeTextFile(tempPath, JSON.stringify(store, null, 2));
    await rename(tempPath, this.storePath);
  }
}
