import { randomBytes } from "node:crypto";
import type { AgentPermissionResponse } from "../agent/agent-sdk-types.js";

/**
 * Send approvals (docs/features/connectors/README.md, "Runtime"). One approval covers one send:
 * identical calls while the person is deciding share the open request, and an Allow is taken by
 * exactly one call. An Allow whose call was not sent, because the agent hung up while waiting,
 * is kept for ten minutes so the agent's retry runs without asking again.
 */

const KEPT_MS = 10 * 60_000;

interface Entry {
  decided: Promise<AgentPermissionResponse>;
  /** When an unused Allow was kept for a retry; null while the request is open. */
  keptAt: number | null;
}

export type ApprovalOutcome =
  | { kind: "allowed" }
  | { kind: "declined"; message?: string }
  /** The Allow went to an identical call made at the same time. */
  | { kind: "taken" };

export class SendApprovals {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number) {}

  /**
   * The person's answer for the call `key` names, raising a request with a fresh id when none is
   * open or kept. Rejects when the request cannot be raised (the agent is gone).
   */
  async decide(
    key: string,
    raise: (requestId: string) => Promise<AgentPermissionResponse>,
  ): Promise<ApprovalOutcome> {
    this.dropStale();
    let entry = this.entries.get(key);
    if (!entry) {
      const requestId = `connector_send_${key.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
      const created: Entry = { decided: raise(requestId), keptAt: null };
      this.entries.set(key, created);
      created.decided.catch(() => this.forget(key, created));
      entry = created;
    }
    const response = await entry.decided;
    if (response.behavior !== "allow") {
      this.forget(key, entry);
      return { kind: "declined", ...(response.message ? { message: response.message } : {}) };
    }
    if (this.entries.get(key) !== entry) return { kind: "taken" };
    this.entries.delete(key);
    return { kind: "allowed" };
  }

  /** Puts back an Allow whose call was not sent, for the retry. */
  keep(key: string): void {
    this.entries.set(key, {
      decided: Promise.resolve({ behavior: "allow" }),
      keptAt: this.now(),
    });
  }

  private forget(key: string, entry: Entry): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }

  private dropStale(): void {
    const cutoff = this.now() - KEPT_MS;
    for (const [key, entry] of this.entries) {
      if (entry.keptAt !== null && entry.keptAt < cutoff) this.entries.delete(key);
    }
  }
}
