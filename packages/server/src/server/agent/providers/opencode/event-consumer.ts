import {
  createOpencodeClient,
  type GlobalEvent,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

export type OpenCodeEventSourceInput = GlobalEvent | { type: "server-exited"; error: Error };

export interface OpenCodeEventSource {
  ready(): Promise<void>;
  subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void;
  diagnostics?(): OpenCodeEventStreamDiagnostics;
}

export interface OpenCodeEventStreamDiagnostics {
  attempt: number;
  phase: "first-record" | "stream";
  elapsedMs: number;
  lastOutcome?: "ended" | "error" | "watchdog";
  lastError?: string;
}

export interface OpenCodeEventConsumerTiming {
  arm(delayMs: number, callback: () => void): () => void;
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface OpenCodeEventConsumerOptions {
  serverUrl: string;
  processExit: Promise<Error>;
  logger: Pick<Logger, "debug" | "warn">;
  createClient?: (baseUrl: string) => OpencodeClient;
  timing?: OpenCodeEventConsumerTiming;
}

/** A healthy server writes `server.connected` as soon as the stream opens. */
const FIRST_RECORD_DEADLINE_MS = 5_000;
const STREAM_WATCHDOG_MS = 30_000;
const MAX_BACKOFF_MS = 5_000;
const FAILURE_WARNING_ATTEMPT = 4;

type OpenCodeEventStreamPhase = "first-record" | "stream";
type OpenCodeConnectionOutcome = "ended" | "error" | "watchdog";

interface OpenCodeConnectionResult {
  delivered: boolean;
  phase: OpenCodeEventStreamPhase;
  outcome: OpenCodeConnectionOutcome;
  error?: unknown;
}

interface OpenCodeConnectionState {
  delivered: boolean;
  phase: OpenCodeEventStreamPhase;
  sseError?: unknown;
}

export type RaceResult<T> = { settled: true; value: T } | { settled: false };

/**
 * Bounds one connection attempt. Its stop listeners fire when the deadline expires or the consumer
 * stops, whether or not the in-flight request ever observes its abort. Exported for tests.
 */
export class OpenCodeConnectionDeadline {
  expired: { phase: OpenCodeEventStreamPhase; error: Error } | null = null;
  private stopped = false;
  private readonly stopListeners = new Set<() => void>();
  private cancelTimer: () => void = () => undefined;

  constructor(
    private readonly timing: OpenCodeEventConsumerTiming,
    private readonly onExpire: (error: Error) => void,
  ) {}

  /** Stop listeners still registered; each read removes its own once it settles. */
  get pendingStopListeners(): number {
    return this.stopListeners.size;
  }

  arm(delayMs: number, phase: OpenCodeEventStreamPhase): void {
    this.cancelTimer();
    this.cancelTimer = this.timing.arm(delayMs, () => {
      const error = new Error(`OpenCode event stream ${phase} watchdog expired`);
      this.expired = { phase, error };
      this.onExpire(error);
      this.stop();
    });
  }

  onStop(listener: () => void): () => void {
    if (this.stopped) {
      listener();
      return () => undefined;
    }
    this.stopListeners.add(listener);
    return () => this.stopListeners.delete(listener);
  }

  stop(): void {
    this.cancelTimer();
    if (this.stopped) return;
    this.stopped = true;
    for (const listener of this.stopListeners) listener();
    this.stopListeners.clear();
  }

  dispose(): void {
    this.cancelTimer();
  }
}

const systemTiming: OpenCodeEventConsumerTiming = {
  arm(delayMs, callback) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
  wait(delayMs, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const handle = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(handle);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
};

export class OpenCodeEventConsumer implements OpenCodeEventSource {
  private readonly listeners = new Set<(input: OpenCodeEventSourceInput) => void>();
  private readonly client: OpencodeClient;
  private readonly logger: Pick<Logger, "debug" | "warn">;
  private readonly timing: OpenCodeEventConsumerTiming;
  private readonly startedAt = Date.now();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private connectionAbort = new AbortController();
  private connectionTask: Promise<void>;
  private attempt = 0;
  private phase: OpenCodeEventStreamPhase = "first-record";
  private lastOutcome?: OpenCodeConnectionOutcome;
  private lastError?: string;
  private connected = false;
  private closed = false;

  constructor(options: OpenCodeEventConsumerOptions) {
    this.client =
      options.createClient?.(options.serverUrl) ??
      createOpencodeClient({ baseUrl: options.serverUrl });
    this.logger = options.logger;
    this.timing = options.timing ?? systemTiming;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => undefined);
    this.connectionTask = this.consume(options.processExit);
    void this.connectionTask.catch(() => undefined);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  diagnostics(): OpenCodeEventStreamDiagnostics {
    return {
      attempt: this.attempt,
      phase: this.phase,
      elapsedMs: Date.now() - this.startedAt,
      ...(this.lastOutcome === undefined ? {} : { lastOutcome: this.lastOutcome }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    const error = new Error("OpenCode event source closed");
    this.rejectReady(error);
    this.connectionAbort.abort(error);
    await this.connectionTask.catch(() => undefined);
  }

  private async consume(processExit: Promise<Error>): Promise<void> {
    void processExit.then((error) => this.exit(error));
    let reconnectAttempt = 0;
    while (!this.closed) {
      this.attempt += 1;
      this.phase = "first-record";
      const result = await this.consumeConnection(this.connectionAbort.signal);
      if (this.closed) return;
      this.lastOutcome = result.outcome;
      this.lastError = result.error === undefined ? undefined : errorMessage(result.error);
      reconnectAttempt = result.delivered ? 0 : reconnectAttempt + 1;
      const delayMs = Math.min(100 * 2 ** Math.max(0, reconnectAttempt - 1), MAX_BACKOFF_MS);
      this.logConnectionFailure(result, this.attempt, reconnectAttempt, delayMs);
      await this.timing.wait(delayMs, this.connectionAbort.signal).catch(() => undefined);
    }
  }

  private async consumeConnection(signal: AbortSignal): Promise<OpenCodeConnectionResult> {
    const requestAbort = new AbortController();
    const connection: OpenCodeConnectionState = { delivered: false, phase: "first-record" };
    // The deadline ends the attempt on its own. Aborting the request is best effort: an abort
    // that never reaches a hung fetch must not keep the consumer waiting on it.
    const deadline = new OpenCodeConnectionDeadline(this.timing, (error) =>
      requestAbort.abort(error),
    );
    const stop = () => {
      requestAbort.abort(signal.reason);
      deadline.stop();
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    deadline.arm(FIRST_RECORD_DEADLINE_MS, "first-record");
    try {
      const request = this.client.global.event({
        signal: requestAbort.signal,
        sseMaxRetryAttempts: 0,
        onSseError: (error) => {
          connection.sseError = error;
        },
      });
      const opened = await raceStopped(request, deadline);
      if (!opened.settled) return connectionResult(connection, deadline);
      return await this.readConnection(opened.value.stream[Symbol.asyncIterator](), {
        connection,
        deadline,
      });
    } catch (error) {
      return connectionResult(connection, deadline, error);
    } finally {
      deadline.dispose();
      signal.removeEventListener("abort", stop);
      requestAbort.abort();
    }
  }

  private async readConnection(
    iterator: AsyncIterator<GlobalEvent>,
    attempt: { connection: OpenCodeConnectionState; deadline: OpenCodeConnectionDeadline },
  ): Promise<OpenCodeConnectionResult> {
    const { connection, deadline } = attempt;
    while (true) {
      const next = await raceStopped(iterator.next(), deadline);
      if (!next.settled || this.closed) {
        // Never await a read that may be hung; the iterator finishes on its own if it can.
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
        return connectionResult(connection, deadline);
      }
      if (next.value.done) return connectionResult(connection, deadline);
      deadline.arm(STREAM_WATCHDOG_MS, "stream");
      connection.delivered = true;
      connection.phase = "stream";
      this.phase = "stream";
      this.handleRecord(next.value.value);
    }
  }

  private handleRecord(event: GlobalEvent): void {
    if (!this.connected && event.payload.type === "server.connected") {
      this.connected = true;
      this.resolveReady();
      return;
    }
    this.logPluginFailure(event);
    this.publish(event);
  }

  private logPluginFailure(event: GlobalEvent): void {
    if (event.payload.type !== "session.error") return;
    const error = event.payload.properties.error;
    if (!containsPluginError(error)) return;
    this.logger.warn(
      {
        directory: event.directory,
        sessionId: event.payload.properties.sessionID,
        error,
      },
      "OpenCode plugin failed",
    );
  }

  private logConnectionFailure(
    result: OpenCodeConnectionResult,
    attempt: number,
    consecutiveFailures: number,
    retryDelayMs: number,
  ): void {
    const elapsedMs = Date.now() - this.startedAt;
    const details = {
      ...(result.error === undefined ? {} : { err: result.error }),
      phase: result.phase,
      outcome: result.outcome,
      attempt,
      consecutiveFailures,
      elapsedMs,
      retryDelayMs,
      everReady: this.connected,
    };
    const log =
      result.outcome === "watchdog" ||
      this.connected ||
      consecutiveFailures >= FAILURE_WARNING_ATTEMPT
        ? this.logger.warn.bind(this.logger)
        : this.logger.debug.bind(this.logger);
    log(details, "OpenCode event stream connection failed; retrying");
  }

  private exit(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.connectionAbort.abort(error);
    if (!this.connected) this.rejectReady(error);
    this.publish({ type: "server-exited", error });
    this.listeners.clear();
  }

  private publish(input: OpenCodeEventSourceInput): void {
    for (const listener of this.listeners) {
      try {
        listener(input);
      } catch {
        // A session callback cannot tear down the generation-owned transport.
      }
    }
  }
}

/**
 * Races one read against the attempt's deadline. The stop listener lives only as long as the read,
 * so a healthy stream of many records holds no reaction per record. Exported for tests.
 */
export function raceStopped<T>(
  work: Promise<T>,
  deadline: Pick<OpenCodeConnectionDeadline, "onStop">,
): Promise<RaceResult<T>> {
  return new Promise<RaceResult<T>>((resolve, reject) => {
    const removeListener = deadline.onStop(() => resolve({ settled: false }));
    // A losing read may still reject later; that rejection belongs to an abandoned attempt.
    work.then(
      (value) => {
        removeListener();
        resolve({ settled: true, value });
        return undefined;
      },
      (error: unknown) => {
        removeListener();
        reject(error);
      },
    );
  });
}

function connectionResult(
  connection: OpenCodeConnectionState,
  deadline: OpenCodeConnectionDeadline,
  thrown?: unknown,
): OpenCodeConnectionResult {
  const { expired } = deadline;
  const error = expired?.error ?? thrown ?? connection.sseError;
  let outcome: OpenCodeConnectionOutcome = "ended";
  if (expired) outcome = "watchdog";
  else if (error !== undefined) outcome = "error";
  return {
    delivered: connection.delivered,
    phase: expired?.phase ?? connection.phase,
    outcome,
    ...(error === undefined ? {} : { error }),
  };
}

/** Includes the cause, where Node's fetch keeps the real reason (ECONNREFUSED, headers timeout). */
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const code = "code" in cause && typeof cause.code === "string" ? `${cause.code}: ` : "";
  return `${error.message} (${code}${cause.message})`;
}

function containsPluginError(error: unknown): boolean {
  try {
    return JSON.stringify(error).toLowerCase().includes("plugin");
  } catch {
    return false;
  }
}

export type OpenCodeEventConsumerFactory = (
  options: Pick<OpenCodeEventConsumerOptions, "serverUrl" | "processExit" | "logger">,
) => OpenCodeEventConsumer;
