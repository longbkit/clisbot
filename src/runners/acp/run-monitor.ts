// Bridges one ACP prompt turn onto the runner contract's monitor callbacks:
// throttled running updates from push events, max-runtime detachment, and a
// truthful completion or adapter-loss failure. The structured events also
// stream through onEvent for capability-aware channel rendering.

import { sleep } from "../../infra/process.ts";
import type { RunMonitorParams } from "../contract/runner-backend.ts";
import { AcpAdapterProcessError } from "./adapter-process.ts";
import { describeStopReason } from "./events.ts";
import type { AcpSession } from "./session.ts";

const PROMPTLESS_SETTLE_POLL_INTERVAL_MS = 250;

export async function monitorAcpRun(params: RunMonitorParams & { session: AcpSession }) {
  const { session } = params;
  if (!params.prompt) {
    await waitForPromptlessSettle(params, session);
    return;
  }

  const updates = new ThrottledRunningUpdates(params, session);
  const detachTimer = startDetachTimer(params, session);
  const adapterLost = watchAdapterExit(session);
  session.onEvent((event) => {
    void params.onEvent?.(event);
  });
  session.onTurnChanged(() => updates.schedule());

  try {
    const promptTurn = session.prompt(params.prompt);
    // If the adapter-loss branch wins the race, the losing prompt promise may
    // still reject later; keep that from becoming an unhandled rejection.
    void promptTurn.catch(() => undefined);
    // The prompt is a JSON-RPC request: once sent it is truthfully submitted.
    await params.onPromptSubmitted?.();
    const outcome = await Promise.race([promptTurn, adapterLost.promise]).catch(
      async (error) => {
        throw await classifyPromptFailure(session, error);
      },
    );
    const stopNote = describeStopReason(outcome.stopReason);
    const snapshot = [outcome.turnText, stopNote].filter(Boolean).join("\n\n");
    await params.onCompleted({
      snapshot,
      fullSnapshot: session.transcript,
      initialSnapshot: params.initialSnapshot,
    });
  } finally {
    session.onEvent(null);
    session.onTurnChanged(null);
    updates.stop();
    detachTimer.stop();
    adapterLost.stop();
  }
}

const ADAPTER_EXIT_OBSERVATION_WINDOW_MS = 250;
const ADAPTER_EXIT_OBSERVATION_POLL_MS = 25;

// A dying adapter can reject the in-flight JSON-RPC request (stream closed)
// before the child-exit event is observed. Give the exit state a short window
// so adapter deaths classify truthfully as adapter loss instead of surfacing
// as opaque stream errors.
async function classifyPromptFailure(session: AcpSession, error: unknown) {
  if (error instanceof AcpAdapterProcessError) {
    return error;
  }
  const deadline = Date.now() + ADAPTER_EXIT_OBSERVATION_WINDOW_MS;
  while (session.alive && Date.now() < deadline) {
    await sleep(ADAPTER_EXIT_OBSERVATION_POLL_MS);
  }
  if (!session.alive) {
    return session.buildAdapterLostError(
      `exited while the prompt was running: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

// A rehydrated ACP run has no prompt to submit; wait for any active turn to
// settle, then complete with the live transcript.
async function waitForPromptlessSettle(params: RunMonitorParams, session: AcpSession) {
  while (session.alive && session.hasActiveTurn) {
    await sleep(PROMPTLESS_SETTLE_POLL_INTERVAL_MS);
  }
  if (!session.alive) {
    throw session.buildAdapterLostError("exited while the run was being observed");
  }
  await params.onCompleted({
    snapshot: session.transcript,
    fullSnapshot: session.transcript,
    initialSnapshot: params.initialSnapshot,
  });
}

class ThrottledRunningUpdates {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastSnapshot = "";
  private lastFlushAt = 0;

  constructor(
    private readonly params: RunMonitorParams,
    private readonly session: AcpSession,
  ) {}

  // Leading-edge throttle: the first change flushes immediately so short
  // turns still stream, later changes coalesce into one update per interval.
  schedule() {
    if (this.stopped || this.timer) {
      return;
    }
    const intervalMs = this.params.resolved.stream.updateIntervalMs;
    const waitMs = Math.max(0, this.lastFlushAt + intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, waitMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async flush() {
    if (this.stopped) {
      return;
    }
    this.lastFlushAt = Date.now();
    const snapshot = this.session.currentTurnText;
    if (!snapshot || snapshot === this.lastSnapshot) {
      return;
    }
    this.lastSnapshot = snapshot;
    await this.params.onRunning({
      snapshot,
      fullSnapshot: this.session.transcript,
      initialSnapshot: this.params.initialSnapshot,
    });
  }
}

function startDetachTimer(params: RunMonitorParams, session: AcpSession) {
  const elapsedMs = Date.now() - params.startedAt;
  const remainingMs = params.resolved.stream.maxRuntimeMs - elapsedMs;
  if (params.detachedAlready || remainingMs <= 0) {
    return { stop: () => undefined };
  }
  const timer = setTimeout(() => {
    void params.onDetached({
      snapshot: session.currentTurnText,
      fullSnapshot: session.transcript,
      initialSnapshot: params.initialSnapshot,
    });
  }, remainingMs);
  return {
    stop: () => clearTimeout(timer),
  };
}

function watchAdapterExit(session: AcpSession) {
  let settled = false;
  let rejectFn: ((error: Error) => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });
  // Keep the race from surfacing an unhandled rejection when the prompt wins.
  void promise.catch(() => undefined);
  session.onAdapterExit(() => {
    if (!settled) {
      settled = true;
      rejectFn?.(session.buildAdapterLostError("exited while the prompt was running"));
    }
  });
  return {
    promise,
    stop: () => {
      settled = true;
    },
  };
}
