/**
 * Bounds on the Hub requests that confirm a lease before a notification's content is sent:
 * at most `concurrency` in flight and `maxQueued` waiting for this daemon. A request that waited
 * `maxWaitMs` is not sent: every notification that wanted it has given up on it by then.
 */
export interface LeaseVerifierLimits {
  concurrency: number;
  maxQueued: number;
  maxWaitMs: number;
}

export const DEFAULT_LEASE_VERIFIER_LIMITS: LeaseVerifierLimits = {
  concurrency: 8,
  maxQueued: 256,
  maxWaitMs: 4_000,
};

/** The Hub had no free slot for this lease; the notification sends it nothing it must not see. */
export class LeaseVerificationUnavailableError extends Error {
  constructor(reason: "queue_full" | "waited_too_long") {
    super(`Lease verification unavailable (${reason})`);
    this.name = "LeaseVerificationUnavailableError";
  }
}

/**
 * Asks the Hub about leases with bounded load. Notifications asking about the same lease while
 * a request is in flight or waiting share it, so many notifications cost one request per lease;
 * nothing is kept once it settles, so the next notification asks again.
 */
export class LeaseVerifier<Answer> {
  private readonly pending = new Map<string, Promise<Answer>>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;

  constructor(
    private readonly limits: LeaseVerifierLimits = DEFAULT_LEASE_VERIFIER_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  verify(leaseId: string, request: (leaseId: string) => Promise<Answer>): Promise<Answer> {
    const shared = this.pending.get(leaseId);
    if (shared) return shared;
    const verification = this.run(() => request(leaseId)).finally(() =>
      this.pending.delete(leaseId),
    );
    this.pending.set(leaseId, verification);
    return verification;
  }

  private async run(request: () => Promise<Answer>): Promise<Answer> {
    if (this.active < this.limits.concurrency) this.active += 1;
    else if (this.waiting.length >= this.limits.maxQueued)
      throw new LeaseVerificationUnavailableError("queue_full");
    else {
      const queuedAt = this.now();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
      if (this.now() - queuedAt >= this.limits.maxWaitMs) {
        this.release();
        throw new LeaseVerificationUnavailableError("waited_too_long");
      }
    }
    try {
      return await request();
    } finally {
      this.release();
    }
  }

  // A freed slot passes straight to the next waiter, so a newcomer can never take it in between.
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}
