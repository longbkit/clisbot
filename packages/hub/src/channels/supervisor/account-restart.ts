// Bring a channel account back after its transport dies on its own. The
// supervisor otherwise restarts an account only when a configuration save runs
// `reconcile()`, so a Slack socket or a poll loop that exited stayed down until
// somebody edited something.

/** First retry delay; doubles per consecutive failure up to the ceiling. */
export const ACCOUNT_RESTART_INITIAL_MS = 5_000;
export const ACCOUNT_RESTART_MAX_MS = 300_000;
/** A transport that lived this long was healthy: its next failure starts over. */
export const ACCOUNT_RESTART_HEALTHY_MS = 60_000;

export interface AccountRestartOptions {
  /** Start the account again. Resolves `false` when the start failed and should be retried. */
  restart: (channel: string, accountId: string) => Promise<boolean>;
  log: (message: string, detail: Record<string, unknown>) => void;
  now?: () => number;
}

interface RestartEntry {
  attempts: number;
  lastStartedAt: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class AccountRestartScheduler {
  private readonly entries = new Map<string, RestartEntry>();

  constructor(private readonly options: AccountRestartOptions) {}

  /** The account's transport is up (a start succeeded). */
  noteStarted(key: string): void {
    const entry = this.entry(key);
    entry.lastStartedAt = this.now();
  }

  /** The account's transport died without being asked to: retry with backoff. */
  schedule(key: string, channel: string, accountId: string): void {
    const entry = this.entry(key);
    if (entry.timer !== undefined) return;
    const livedMs = entry.lastStartedAt === undefined ? 0 : this.now() - entry.lastStartedAt;
    if (livedMs >= ACCOUNT_RESTART_HEALTHY_MS) entry.attempts = 0;
    const delayMs = Math.min(
      ACCOUNT_RESTART_INITIAL_MS * 2 ** entry.attempts,
      ACCOUNT_RESTART_MAX_MS,
    );
    entry.attempts += 1;
    this.options.log("channel account restart scheduled", { channel, account: accountId, delayMs });
    const timer = setTimeout(() => {
      entry.timer = undefined;
      void this.fire(key, channel, accountId);
    }, delayMs);
    timer.unref?.();
    entry.timer = timer;
  }

  /** The account was stopped or replaced on purpose: forget it. */
  cancel(key: string): void {
    const entry = this.entries.get(key);
    if (entry?.timer !== undefined) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  stop(): void {
    for (const key of this.entries.keys()) this.cancel(key);
  }

  private async fire(key: string, channel: string, accountId: string): Promise<void> {
    if (!this.entries.has(key)) return;
    const started = await this.options.restart(channel, accountId).catch(() => false);
    // A start that fails has no monitor to report it, so the retry is ours.
    if (!started && this.entries.has(key)) this.schedule(key, channel, accountId);
  }

  private entry(key: string): RestartEntry {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const created: RestartEntry = { attempts: 0, lastStartedAt: undefined, timer: undefined };
    this.entries.set(key, created);
    return created;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
