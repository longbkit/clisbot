import { SessionDeletedError } from "./deletion-intents.js";

export type AuthorshipRecoveryStatus = "pending" | "recovering" | "error";
const MAX_QUEUED = 64;

export interface AuthorshipRecoveryDeps {
  recover: (agentId: string) => Promise<unknown>;
  isDeleting: (agentId: string) => boolean;
}

/**
 * Background authorship rebuild. A deletion fence is the only reason to drop a session
 * silently; every other failure surfaces through the status observer.
 */
export class AuthorshipRecoveryQueue {
  private readonly queued = new Set<string>();
  private worker?: Promise<void>;
  private failure: unknown;
  private demandRequested = false;
  private refill?: () => Promise<readonly string[]>;
  private observer?: (agentId: string, status: AuthorshipRecoveryStatus) => Promise<void>;

  constructor(private readonly deps: AuthorshipRecoveryDeps) {}

  setStatusObserver(
    observer: (agentId: string, status: AuthorshipRecoveryStatus) => Promise<void>,
  ): void {
    this.observer = observer;
  }
  setRefill(refill: () => Promise<readonly string[]>): void {
    this.refill = refill;
  }
  requestSweep(): void {
    this.demandRequested = true;
    this.start();
  }

  schedule(agentId: string, prioritize = false): boolean {
    if (this.deps.isDeleting(agentId)) return false;
    if (this.queued.has(agentId) && !prioritize) return true;
    if (this.queued.size >= MAX_QUEUED && !this.queued.has(agentId)) {
      if (!prioritize) return false;
      this.queued.delete([...this.queued].at(-1)!);
    }
    if (prioritize) {
      this.queued.delete(agentId);
      const rest = [...this.queued];
      this.queued.clear();
      this.queued.add(agentId);
      for (const id of rest) this.queued.add(id);
    } else this.queued.add(agentId);
    this.start();
    return true;
  }

  async drain(): Promise<void> {
    while (this.worker) await this.worker;
    if (this.failure) throw this.failure;
  }

  private start(): void {
    if (this.worker) return;
    this.worker = Promise.resolve()
      .then(() => this.run())
      .catch((error: unknown) => {
        this.failure = error;
      })
      .finally(() => {
        this.worker = undefined;
        // A demand can arrive after the loop observed empty but before this continuation runs.
        if (!this.failure && (this.queued.size || this.demandRequested)) this.start();
      });
  }

  private async run(): Promise<void> {
    while (true) {
      if (!this.queued.size) {
        this.demandRequested = false;
        for (const id of (await this.refill?.()) ?? []) {
          if (this.queued.size >= MAX_QUEUED) break;
          if (!this.deps.isDeleting(id)) this.queued.add(id);
        }
      }
      const agentId = this.queued.values().next().value;
      if (!agentId) return;
      this.queued.delete(agentId);
      if (this.deps.isDeleting(agentId)) continue;
      try {
        await this.observer?.(agentId, "recovering");
        if (!this.deps.isDeleting(agentId)) await this.deps.recover(agentId);
      } catch (error) {
        // Only a confirmed lifecycle fence suppresses status; arbitrary corruption does not.
        if (this.deps.isDeleting(agentId) || error instanceof SessionDeletedError) continue;
        try {
          await this.observer?.(agentId, "error");
        } catch (statusError) {
          if (!this.deps.isDeleting(agentId) && !(statusError instanceof SessionDeletedError))
            throw statusError;
        }
      }
    }
  }
}
