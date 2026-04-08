import type { StoredFollowUpState } from "./follow-up-policy.ts";
import { dirname } from "node:path";
import { ensureDir } from "../shared/paths.ts";

export type StoredSessionEntry = {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  workspacePath: string;
  runnerCommand: string;
  followUp?: StoredFollowUpState;
  updatedAt: number;
};

type SessionStoreShape = Record<string, StoredSessionEntry>;

export class SessionStore {
  constructor(private readonly storePath: string) {}

  async list(): Promise<StoredSessionEntry[]> {
    const store = await this.readStore();
    return Object.values(store);
  }

  async get(sessionKey: string): Promise<StoredSessionEntry | null> {
    const store = await this.readStore();
    return store[sessionKey] ?? null;
  }

  async put(entry: StoredSessionEntry) {
    const store = await this.readStore();
    store[entry.sessionKey] = entry;
    await this.writeStore(store);
    return entry;
  }

  async update(
    sessionKey: string,
    updater: (entry: StoredSessionEntry | null) => StoredSessionEntry | null,
  ) {
    const store = await this.readStore();
    const next = updater(store[sessionKey] ?? null);
    if (next) {
      store[sessionKey] = next;
    } else {
      delete store[sessionKey];
    }
    await this.writeStore(store);
    return next;
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
      updatedAt: Date.now(),
    });
  }

  private async readStore(): Promise<SessionStoreShape> {
    const file = Bun.file(this.storePath);
    if (!(await file.exists())) {
      return {};
    }

    const text = await file.text();
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
    await Bun.write(this.storePath, JSON.stringify(store, null, 2));
  }
}
