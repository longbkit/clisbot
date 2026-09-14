import {
  assertAgentNotDeleted,
  persistDeletedAgentId,
  replaySessionDeletionIntents,
  SessionDeletedError,
  writeSessionDeletionIntent,
} from "./session-storage/deletion-intents.js";
import { deleteSessionDirectory } from "../file-upload/session-file-activity.js";
import { withSessionStorageIo } from "./session-storage/paged-journal.js";
import { isDeepStrictEqual } from "node:util";
import { copySessionAuthorship } from "./session-authorship.js";
import type { DurableSessionSummary } from "./session-storage/session-summary.js";
import { SessionAuthorshipShape } from "@getpaseo/protocol/session-authorship";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { writeDurableJson } from "./session-storage/durable-file.js";
import {
  assertSessionId,
  listSessionRecordPaths,
  moveSessionRecord,
} from "./session-storage/layout.js";
import { AgentFeatureSchema, AgentStatusSchema } from "../messages.js";
import { toStoredAgentRecord } from "./agent-projections.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { AgentOwnerSchema, daemonExecutionKey, type DaemonAgentOwner } from "./agent-owner.js";

const SERIALIZABLE_CONFIG_SCHEMA = z
  .object({
    modeId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    featureValues: z.record(z.string(), z.unknown()).nullable().optional(),
    providerOptions: z.record(z.string(), z.json()).nullable().optional(),
    toolPolicy: z
      .object({
        preapproved: z.array(
          z
            .object({
              kind: z.literal("mcp"),
              server: z.string(),
              tool: z.string(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable()
      .optional(),
    systemPrompt: z.string().nullable().optional(),
    mcpServers: z.record(z.string(), z.any()).nullable().optional(),
  })
  .nullable()
  .optional();

const PERSISTENCE_HANDLE_SCHEMA = z
  .object({
    provider: z.string(),
    sessionId: z.string(),
    nativeHandle: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .nullable()
  .optional();

const STORED_AGENT_SCHEMA = z.object({
  ...SessionAuthorshipShape,
  authorshipWatermark: z.string().optional(),
  id: z.string(),
  provider: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  lastUserMessageAt: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  lastStatus: AgentStatusSchema.default("closed"),
  lastModeId: z.string().nullable().optional(),
  config: SERIALIZABLE_CONFIG_SCHEMA,
  runtimeInfo: z
    .object({
      provider: z.string(),
      sessionId: z.string().nullable(),
      model: z.string().nullable().optional(),
      thinkingOptionId: z.string().nullable().optional(),
      modeId: z.string().nullable().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  features: z.array(AgentFeatureSchema).optional(),
  persistence: PERSISTENCE_HANDLE_SCHEMA,
  lastError: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  internal: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  owner: AgentOwnerSchema.optional(),
});

export type SerializableAgentConfig = Pick<
  AgentSessionConfig,
  | "modeId"
  | "model"
  | "thinkingOptionId"
  | "featureValues"
  | "providerOptions"
  | "toolPolicy"
  | "systemPrompt"
  | "mcpServers"
>;

export type StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>;
export function parseStoredAgentRecord(value: unknown): StoredAgentRecord {
  return STORED_AGENT_SCHEMA.parse(value);
}

export class AgentStorage {
  private cache: Map<string, StoredAgentRecord> = new Map();
  private pathById: Map<string, string> = new Map();
  private pathsById: Map<string, Set<string>> = new Map();
  private pendingWrites: Map<string, Promise<void>> = new Map();
  private deleting: Set<string> = new Set();
  private daemonAgentIdsByExecution: Map<string, string> = new Map();
  private daemonExecutionKeysByAgentId: Map<string, string> = new Map();
  private loaded = false;
  private baseDir: string;
  private loadPromise: Promise<StoredAgentRecord[]> | null = null;
  private logger: Logger;

  constructor(
    baseDir: string,
    logger: Logger,
    private readonly options: {
      sessionLayout?: boolean;
      removeSessionData?: (agentId: string, directory: string) => Promise<void>;
    } = {},
  ) {
    this.baseDir = baseDir;
    this.logger = logger.child({ module: "agent", component: "agent-storage" });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async list(): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  async get(agentId: string): Promise<StoredAgentRecord | null> {
    await this.load();
    return this.cache.get(agentId) ?? null;
  }

  async listByProviderSession(
    provider: string,
    providerHandleId: string,
  ): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values()).filter(
      (record) =>
        record.persistence?.provider === provider &&
        (record.persistence.sessionId === providerHandleId ||
          record.persistence.nativeHandle === providerHandleId),
    );
  }

  async listByWorkspace(workspaceId: string): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values()).filter((record) => record.workspaceId === workspaceId);
  }

  async findByDaemonExecution(owner: DaemonAgentOwner): Promise<StoredAgentRecord | null> {
    await this.load();
    const agentId = this.daemonAgentIdsByExecution.get(daemonExecutionKey(owner));
    return agentId ? (this.cache.get(agentId) ?? null) : null;
  }

  async upsert(record: StoredAgentRecord): Promise<void> {
    const accepted = structuredClone(record);
    await this.load();
    await this.queueRecordWrite(accepted);
  }

  private queueRecordWrite(record: StoredAgentRecord): Promise<void> {
    return this.queueRecordMutation(record.id, (existing) =>
      existing?.authorshipWatermark
        ? {
            ...record,
            ...copySessionAuthorship(existing),
            authorshipWatermark: existing.authorshipWatermark,
          }
        : record,
    );
  }

  private queueRecordMutation(
    agentId: string,
    mutate: (existing: StoredAgentRecord | null) => StoredAgentRecord,
  ): Promise<void> {
    if (this.deleting.has(agentId))
      return Promise.reject(new SessionDeletedError(`Agent ${agentId} is being deleted`));
    const prev = this.pendingWrites.get(agentId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await assertAgentNotDeleted(this.baseDir, agentId);
        const record = mutate(this.cache.get(agentId) ?? null);
        await this.writeRecord(record);
        return undefined;
      });

    const tracked = next.finally(() => {
      if (this.pendingWrites.get(agentId) === tracked) {
        this.pendingWrites.delete(agentId);
      }
    });

    this.pendingWrites.set(agentId, tracked);
    return tracked;
  }

  private async writeRecord(record: StoredAgentRecord): Promise<void> {
    const agentId = record.id;
    const nextPath = this.buildRecordPath(record);
    const previousPath = this.pathById.get(agentId);

    await (this.options.sessionLayout || path.basename(nextPath) === "session.json"
      ? writeDurableJson(nextPath, record)
      : writeJsonFileAtomic(nextPath, record));
    this.addIndexedPath(agentId, nextPath);

    if (previousPath && previousPath !== nextPath) {
      try {
        await fs.unlink(previousPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.removeIndexedPath(agentId, previousPath);
    }

    this.cache.set(agentId, record);
    this.indexOwner(record);
    this.pathById.set(agentId, nextPath);
  }

  beginDelete(agentId: string): void {
    this.deleting.add(agentId);
  }

  async preparePermanentDelete(agentId: string): Promise<string | null> {
    await this.load();
    this.beginDelete(agentId);
    await (this.pendingWrites.get(agentId) ?? Promise.resolve());
    if (!this.cache.has(agentId)) {
      this.deleting.delete(agentId);
      return null;
    }
    const directory = await this.getSessionDirectory(agentId);
    await writeSessionDeletionIntent(directory, {
      agentRoot: this.baseDir,
      paths: [...(this.pathsById.get(agentId) ?? [])],
    });
    await persistDeletedAgentId(this.baseDir, agentId);
    return directory;
  }

  async remove(agentId: string): Promise<void> {
    const directory = await this.preparePermanentDelete(agentId);
    if (directory) {
      if (this.options.removeSessionData) await this.options.removeSessionData(agentId, directory);
      else await deleteSessionDirectory(directory);
    }
    const paths = Array.from(this.pathsById.get(agentId) ?? []);
    await Promise.all(
      paths.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && code !== "ENOENT") {
            throw error;
          }
        }
      }),
    );

    this.cache.delete(agentId);
    this.removeOwnerIndex(agentId);
    this.pathById.delete(agentId);
    this.pathsById.delete(agentId);
    this.deleting.delete(agentId);
  }
  get activeDeletionCount(): number {
    return this.deleting.size;
  }

  async setAuthorshipStatus(
    agentId: string,
    status: "pending" | "recovering" | "error",
  ): Promise<void> {
    await this.load();
    await this.queueRecordMutation(agentId, (record) => {
      if (!record) throw new Error(`Agent ${agentId} not found`);
      return {
        ...record,
        authorshipStatus: status,
        lastInteractionBy: undefined,
        lastInteractionAt: undefined,
        lastMessageBy: undefined,
      };
    });
  }

  async applyAuthorship(agentId: string, value: DurableSessionSummary): Promise<boolean> {
    await this.load();
    const existing = this.cache.get(agentId);
    if (!existing) {
      await assertAgentNotDeleted(this.baseDir, agentId);
      throw new Error(`Agent ${agentId} not found`);
    }
    const materialize = (record: StoredAgentRecord) => ({
      ...copySessionAuthorship(value.summary),
      createdBy: record.createdBy,
      participantActors:
        record.createdBy &&
        !value.summary.participantActors?.some((actor) =>
          isDeepStrictEqual(actor, record.createdBy),
        )
          ? [record.createdBy, ...(value.summary.participantActors ?? [])]
          : value.summary.participantActors,
      channels: value.summary.channels?.length ? value.summary.channels : record.channels,
    });
    if (
      existing.authorshipWatermark &&
      isDeepStrictEqual(copySessionAuthorship(existing), materialize(existing))
    )
      return false;
    await this.queueRecordMutation(agentId, (record) => {
      if (!record) throw new Error(`Agent ${agentId} not found`);
      // This specialized path alone advances authorship. Ordinary snapshots merge the durable fields.
      return { ...record, ...materialize(record), authorshipWatermark: value.watermark };
    });
    return true;
  }

  async applySnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    await this.load();
    const hasTitleOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "title");
    const hasInternalOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "internal");
    await this.queueRecordMutation(agent.id, (existing) => {
      const record = toStoredAgentRecord(agent, {
        title: hasTitleOverride ? (options?.title ?? null) : (existing?.title ?? null),
        createdAt: existing?.createdAt,
        internal: hasInternalOverride ? options?.internal : (agent.internal ?? existing?.internal),
      });

      // Preserve soft-delete/archive status across snapshot flushes. The
      // projection runs inside the per-agent write queue so it cannot commit a
      // stale pre-archive record after the archive mutation.
      if (existing && existing.archivedAt !== undefined) {
        record.archivedAt = existing.archivedAt;
      }
      if (existing?.authorshipWatermark)
        Object.assign(record, copySessionAuthorship(existing), {
          authorshipWatermark: existing.authorshipWatermark,
        });
      return record;
    });
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    await this.load();
    await this.waitForPendingWrite(agentId);
    const record = await this.get(agentId);
    if (!record) {
      throw new Error(`Agent ${agentId} not found`);
    }
    await this.upsert({ ...record, title });
  }

  async flush(): Promise<void> {
    await this.load();
    const writes = Array.from(this.pendingWrites.values());
    await Promise.all(writes);
  }

  private async load(): Promise<StoredAgentRecord[]> {
    if (this.loaded) {
      return Array.from(this.cache.values());
    }

    if (!this.loadPromise) {
      this.loadPromise = this.doLoad();
    }

    return this.loadPromise;
  }

  private async doLoad(): Promise<StoredAgentRecord[]> {
    this.cache.clear();
    this.pathById.clear();
    this.pathsById.clear();
    this.daemonAgentIdsByExecution.clear();
    this.daemonExecutionKeysByAgentId.clear();

    try {
      await replaySessionDeletionIntents(this.baseDir);
      const records = await this.scanDisk();
      this.loaded = true;
      return records;
    } catch (error) {
      this.logger.error({ err: error }, "Failed to load agents");
      this.loadPromise = null;
      throw error;
    }
  }

  private async scanDisk(): Promise<StoredAgentRecord[]> {
    const records = new Map<string, StoredAgentRecord>();
    const directories = new Map<string, string[]>();
    const files = await listSessionRecordPaths(this.baseDir, (directory) => {
      const id = path.basename(directory);
      const candidates = directories.get(id) ?? [];
      candidates.push(directory);
      directories.set(id, candidates);
    });
    for (let offset = 0; offset < files.length; offset += 16) {
      const batch = await Promise.allSettled(
        files.slice(offset, offset + 16).map((filePath) =>
          withSessionStorageIo(async () => ({
            filePath,
            record: await this.readRecordFile(filePath),
          })),
        ),
      );
      for (const result of batch) {
        if (result.status === "rejected") throw result.reason;
        const { filePath, record } = result.value;
        if (!record) continue;
        assertSessionId(record.id);
        await assertAgentNotDeleted(this.baseDir, record.id);
        const previousPath = this.pathById.get(record.id);
        if (previousPath) {
          const [previous, current] = await Promise.all([
            fs.readFile(previousPath),
            fs.readFile(filePath),
          ]);
          if (!previous.equals(current)) {
            throw new Error(
              `Conflicting records for agent ${record.id}: ${previousPath} and ${filePath}`,
            );
          }
        }
        let canonicalPath = filePath;
        if (this.options.sessionLayout) {
          canonicalPath = this.resolveSessionLayoutPath(filePath, record, directories);
          await moveSessionRecord(filePath, canonicalPath);
        } else if (previousPath && path.basename(previousPath) === "session.json") {
          canonicalPath = previousPath;
        }
        records.set(record.id, record);
        this.cache.set(record.id, record);
        this.indexOwner(record);
        this.pathById.set(record.id, canonicalPath);
        this.addIndexedPath(record.id, canonicalPath);
        if (!this.options.sessionLayout) this.addIndexedPath(record.id, filePath);
      }
    }
    return Array.from(records.values());
  }

  /** Where a scanned record belongs under the session layout, without moving it yet. */
  private resolveSessionLayoutPath(
    filePath: string,
    record: StoredAgentRecord,
    directories: Map<string, string[]>,
  ): string {
    const candidates = directories.get(record.id) ?? [];
    if (candidates.length > 1)
      throw new Error(`Ambiguous retained session directories for agent ${record.id}`);
    if (path.basename(filePath) === "session.json") {
      if (path.basename(path.dirname(filePath)) !== record.id)
        throw new Error(`Session record directory does not match agent ${record.id}`);
      return filePath;
    }
    // Rollback keeps data beside the old record even if its cwd changes later.
    // An old daemon may move that legacy record; the unique storage-owned ID
    // directory still locates its retained history without moving only metadata.
    const directory =
      candidates[0] ?? path.join(this.baseDir, projectDirNameFromCwd(record.cwd), record.id);
    directories.set(record.id, [directory]);
    return path.join(directory, "session.json");
  }

  private async readRecordFile(filePath: string): Promise<StoredAgentRecord | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      return parseStoredAgentRecord(parsed);
    } catch (error) {
      this.logger.error({ err: error, filePath }, "Invalid agent record");
      throw error;
    }
  }

  private buildRecordPath(record: StoredAgentRecord): string {
    assertSessionId(record.id);
    // Keep an established session directory stable across cwd changes: providers may hold its paths.
    const existing = this.pathById.get(record.id);
    if (existing && path.basename(existing) === "session.json") return existing;
    const projectDir = projectDirNameFromCwd(record.cwd);
    return this.options.sessionLayout
      ? path.join(this.baseDir, projectDir, record.id, "session.json")
      : path.join(this.baseDir, projectDir, `${record.id}.json`);
  }

  get hasSessionLayout(): boolean {
    return [...this.pathById.values()].some(
      (recordPath) => path.basename(recordPath) === "session.json",
    );
  }

  async getSessionDirectory(agentId: string): Promise<string> {
    const record = await this.get(agentId);
    if (!record) throw new Error(`Agent ${agentId} not found`);
    const recordPath = this.pathById.get(agentId)!;
    return path.basename(recordPath) === "session.json"
      ? path.dirname(recordPath)
      : path.join(path.dirname(recordPath), record.id);
  }

  private addIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId) ?? new Set<string>();
    paths.add(filePath);
    this.pathsById.set(agentId, paths);
  }

  private removeIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId);
    if (!paths) {
      return;
    }
    paths.delete(filePath);
    if (paths.size === 0) {
      this.pathsById.delete(agentId);
    }
  }

  private indexOwner(record: StoredAgentRecord): void {
    this.removeOwnerIndex(record.id);
    if (record.owner?.kind === "daemon") {
      const key = daemonExecutionKey(record.owner);
      const previousAgentId = this.daemonAgentIdsByExecution.get(key);
      if (previousAgentId && previousAgentId !== record.id) {
        this.daemonExecutionKeysByAgentId.delete(previousAgentId);
      }
      this.daemonAgentIdsByExecution.set(key, record.id);
      this.daemonExecutionKeysByAgentId.set(record.id, key);
    }
  }

  private removeOwnerIndex(agentId: string): void {
    const key = this.daemonExecutionKeysByAgentId.get(agentId);
    if (!key) return;
    if (this.daemonAgentIdsByExecution.get(key) === agentId) {
      this.daemonAgentIdsByExecution.delete(key);
    }
    this.daemonExecutionKeysByAgentId.delete(agentId);
  }

  private async waitForPendingWrite(agentId: string): Promise<void> {
    await (this.pendingWrites.get(agentId) ?? Promise.resolve()).catch(() => undefined);
  }
}

function projectDirNameFromCwd(cwd: string): string {
  // path.win32.parse handles drive letters, UNC roots, and Unix roots on all platforms
  const { root } = path.win32.parse(cwd);
  const withoutRoot = cwd.slice(root.length).replace(/[\\/]+$/, "");
  // Sanitize root: strip colons and separators, keep letters (e.g. "C:\" → "C", "\\server\share\" → "server-share")
  const sanitizedRoot = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const prefix = sanitizedRoot ? sanitizedRoot + "-" : "";
  if (!withoutRoot) {
    return sanitizedRoot || "root";
  }
  return prefix + withoutRoot.replace(/[\\/]+/g, "-");
}
