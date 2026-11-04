import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

/**
 * Sessions each reader follows on this Host, keyed by `notificationReaderKey`.
 *
 * A follow is a preference, never a grant: notifications about a followed session
 * still pass the reader's access checks when they are sent.
 */
export class NotificationFollowStore {
  private readonly logger: pino.Logger;
  private follows = new Map<string, ReadonlySet<string>>();

  constructor(
    logger: pino.Logger,
    private readonly filePath: string,
    private readonly write: typeof writePrivateFileAtomicSync = writePrivateFileAtomicSync,
  ) {
    this.logger = logger.child({ component: "notification-follows" });
    this.load();
  }

  isFollowing(readerKey: string, agentId: string): boolean {
    return this.follows.get(readerKey)?.has(agentId) === true;
  }

  list(readerKey: string): string[] {
    return [...(this.follows.get(readerKey) ?? [])].sort();
  }

  /** Persists before it applies, so a failed write leaves the previous choice in effect. */
  set(readerKey: string, agentId: string, followed: boolean): void {
    const current = new Set(this.follows.get(readerKey));
    if (current.has(agentId) === followed) return;
    if (followed) current.add(agentId);
    else current.delete(agentId);
    const next = new Map(this.follows);
    if (current.size > 0) next.set(readerKey, current);
    else next.delete(readerKey);
    this.persist(next);
    this.follows = next;
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      ensurePrivateFile(this.filePath);
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as { readers?: unknown };
      const readers =
        parsed.readers && typeof parsed.readers === "object"
          ? (parsed.readers as Record<string, unknown>)
          : {};
      for (const [readerKey, agentIds] of Object.entries(readers)) {
        if (!Array.isArray(agentIds)) continue;
        const ids = agentIds.filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length > 0) this.follows.set(readerKey, new Set(ids));
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to load notification follows");
    }
  }

  private persist(follows: ReadonlyMap<string, ReadonlySet<string>>): void {
    const readers = Object.fromEntries(
      [...follows].map(([readerKey, agentIds]) => [readerKey, [...agentIds].sort()]),
    );
    this.write(this.filePath, `${JSON.stringify({ readers }, null, 2)}\n`);
  }
}
