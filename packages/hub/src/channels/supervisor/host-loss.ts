// When a dropped daemon socket counts as "the Host went away".
//
// The socket closes on every network hiccup and the client reconnects on its
// own (`daemon/ws-client.ts` schedules one immediately). Telling every active
// conversation the machine went away for a two-second flap is wrong twice
// over: the notice is untrue, and `hostLost` also ends every running turn, so
// a message held behind a turn that is STILL RUNNING is flushed and steers
// into it. So a drop waits out a short grace, and a reconnect inside it says
// nothing at all.
//
// The grace is not a reconnect timeout: a socket that stays down past it is
// reported once, and the notice is not repeated until it comes back.

/** How long a dropped socket may be down before its conversations are told. */
export const HOST_LOSS_GRACE_MS = 5_000;

export interface HostLossNotifierDeps {
  graceMs?: number | undefined;
  /** Tell the conversations that had a running turn. Called at most once per
   * disconnection, and never for a socket that came back inside the grace. */
  notify: () => Promise<void>;
  setTimer?: ((run: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((timer: unknown) => void) | undefined;
}

/** One account's socket-state-to-notice policy. */
export class HostLossNotifier {
  private readonly deps: HostLossNotifierDeps;
  private pending: unknown;
  /** True once this disconnection was reported: nothing more to say until the
   * socket comes back. */
  private reported = false;

  constructor(deps: HostLossNotifierDeps) {
    this.deps = deps;
  }

  /** The socket dropped. Arms the grace; a second drop while armed changes
   * nothing (the client is already reconnecting). */
  disconnected(): void {
    if (this.pending !== undefined || this.reported) return;
    const run = () => {
      this.pending = undefined;
      this.reported = true;
      void this.deps.notify();
    };
    const setTimer = this.deps.setTimer ?? defaultSetTimer;
    this.pending = setTimer(run, this.deps.graceMs ?? HOST_LOSS_GRACE_MS);
  }

  /** The socket is back. A turn that survived the gap keeps running, and its
   * conversation is never told anything. */
  connected(): void {
    this.cancel();
    this.reported = false;
  }

  /** The account is stopping: drop the armed grace with it. */
  stop(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.pending === undefined) return;
    (this.deps.clearTimer ?? defaultClearTimer)(this.pending);
    this.pending = undefined;
  }
}

function defaultSetTimer(run: () => void, ms: number): unknown {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return timer;
}

function defaultClearTimer(timer: unknown): void {
  clearTimeout(timer as ReturnType<typeof setTimeout>);
}
