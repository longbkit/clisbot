// `messagesSentPerMinute`: new messages the bot posts are delayed until every
// scope they count in has room. Answers are never dropped. Order is kept per
// destination THREAD: posts to one thread go one at a time, in order, while
// other threads of the same channel wait only for room in the scopes they share
// (the Conversation scope counts every thread of a channel together). While a
// thread waits, only its newest progress line is kept, and a queued answer goes
// out ahead of it. Typing, reactions and in-place edits are not messages and
// are not paced; streaming drafts use the vertical's own draft path and are not
// paced either. Delayed sends live in memory: an account restart loses them.
//
// Every write, paced or not, runs under the Hub's write deadline: a vertical
// whose post hangs releases its thread's turn and fails like any other error.
// docs/features/channels/conversation-flow.md#outbound

import { setTimeout as delay } from "node:timers/promises";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { inWindow, limitScopes, RATE_WINDOW_MS, type LimitScope } from "./limit-scopes.js";
import {
  HUB_WRITE_DEADLINE_MS,
  outboundFailure,
  type OutboundFailure,
} from "./outbound-failure.js";
import type {
  MediaPostParams,
  MediaPostResult,
  OutboundPostParams,
  OutboundPostResult,
  PlaneLogger,
  PostFn,
} from "./types.js";

/** Enough passes for three scopes to settle on one send time. */
const MAX_SETTLE_PASSES = 8;

interface OutboundPacerDeps {
  account: CompiledChannelAccount;
  logger: PlaneLogger;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The write deadline; tests shorten it. */
  writeTimeoutMs?: number;
  /** The account's lifetime. When it aborts, waiting writes fail as `canceled`
   * (nothing was sent) and no queued write goes out through a stopped vertical. */
  abortSignal?: AbortSignal;
}

/** Where a write lands: its conversation, and the thread inside it. */
type Destination = Pick<OutboundPostParams, "to" | "threadId">;

type Priority = "answer" | "progress";

/** One write waiting in its thread's lane. Both methods settle the caller. */
interface LaneEntry {
  priority: Priority;
  /** Run the write under the deadline. Never rejects: the caller gets the outcome. */
  send(): Promise<void>;
  /** A newer progress line took this one's place: settle without writing. */
  supersede(): void;
  /** The account stopped before this write's turn: settle without writing. */
  cancel(): void;
}

/** The failed result both send kinds share (both result types accept it). */
type WriteFailure = OutboundPostResult & MediaPostResult;

function writeFailed(failure: OutboundFailure, error: string): WriteFailure {
  return { ok: false, error, failure };
}

function canceled(): WriteFailure {
  return writeFailed(
    outboundFailure("canceled"),
    "the account stopped before the message was sent",
  );
}

export class OutboundPacer {
  private readonly deps: OutboundPacerDeps;
  /** Booked send times per scope, ascending; some may be in the future. */
  private readonly sends = new Map<string, number[]>();
  /** The Route that last served each conversation. */
  private readonly routes = new Map<string, CompiledRoute>();
  /** Writes still waiting, per destination thread. A lane exists while it drains. */
  private readonly lanes = new Map<string, LaneEntry[]>();

  constructor(deps: OutboundPacerDeps) {
    this.deps = deps;
    deps.abortSignal?.addEventListener("abort", () => this.cancelWaiting(), { once: true });
  }

  /** Remember which Route serves a conversation, for its Route-scope limit. */
  noteRoute(conversationId: string, route: CompiledRoute): void {
    this.routes.set(conversationId, route);
  }

  /** Wrap a text send: it waits for its turn and holds it until the send finishes. */
  paced(send: PostFn): PostFn {
    return (params) => {
      const priority = params.priority === "progress" ? "progress" : "answer";
      return this.submit(params, priority, () => send(params));
    };
  }

  /** Wrap a media send. A file is an answer: never dropped, never coalesced. */
  pacedMedia<Params extends MediaPostParams>(
    send: (params: Params) => Promise<MediaPostResult>,
  ): (params: Params) => Promise<MediaPostResult> {
    return (params) => this.submit(params, "answer", () => send(params));
  }

  private submit<Result>(
    destination: Destination,
    priority: Priority,
    write: () => Promise<Result | WriteFailure>,
  ): Promise<Result | WriteFailure> {
    if (this.stopped()) return Promise.resolve(canceled());
    if (this.scopes(destination.to).length === 0) return this.withDeadline(destination, write);
    return new Promise((resolve, reject) => {
      this.enqueue(destination, {
        priority,
        send: () => this.withDeadline(destination, write).then(resolve, reject),
        supersede: () =>
          resolve(
            writeFailed(outboundFailure("superseded"), "superseded by a newer progress message"),
          ),
        cancel: () => resolve(canceled()),
      });
    });
  }

  private enqueue(destination: Destination, entry: LaneEntry): void {
    const key = laneKey(destination);
    const lane = this.lanes.get(key);
    if (lane === undefined) {
      this.lanes.set(key, [entry]);
      void this.drain(key, destination.to);
      return;
    }
    if (entry.priority === "progress") supersedeProgress(lane);
    lane.push(entry);
  }

  /** Send the lane's writes one at a time, each in the next slot its scopes allow.
   * Which write takes a slot is decided when the slot comes: an answer that
   * arrived while the thread waited goes before the progress line. */
  private async drain(key: string, conversationId: string): Promise<void> {
    const lane = this.lanes.get(key) ?? [];
    while (lane.length > 0) {
      const scopes = this.scopes(conversationId);
      await this.sleepUntil(this.reserve(scopes), conversationId, scopes);
      // Stopped while asleep: `cancelWaiting` already settled the lane.
      if (this.stopped()) return;
      await takeNext(lane).send();
    }
    this.lanes.delete(key);
  }

  /** The account stopped: settle every waiting write without sending it. */
  private cancelWaiting(): void {
    for (const lane of this.lanes.values()) {
      for (const entry of lane.splice(0)) entry.cancel();
    }
    this.lanes.clear();
  }

  private stopped(): boolean {
    return this.deps.abortSignal?.aborted === true;
  }

  /** Run one write, or give up on it at the deadline. A write that finishes
   * later is ignored: its outcome is already reported as a timeout. */
  private async withDeadline<Result>(
    destination: Destination,
    write: () => Promise<Result | WriteFailure>,
  ): Promise<Result | WriteFailure> {
    const timeoutMs = this.deps.writeTimeoutMs ?? HUB_WRITE_DEADLINE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<WriteFailure>((resolve) => {
      timer = setTimeout(() => {
        this.deps.logger.warn("channel write timed out", {
          channel: this.deps.account.channel,
          account: this.deps.account.accountId,
          to: destination.to,
          threadId: destination.threadId,
          timeoutMs,
        });
        resolve(writeFailed(outboundFailure("timeout"), `no answer within ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([write(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private scopes(conversationId: string): LimitScope[] {
    return limitScopes({
      account: this.deps.account,
      route: this.routes.get(conversationId),
      conversationId,
    }).filter(({ limits }) => limits.messagesSentPerMinute !== undefined);
  }

  /** The earliest time every scope has room, booked in each scope before anyone waits. */
  private reserve(scopes: readonly LimitScope[]): number {
    const now = this.now();
    let at = now;
    if (scopes.length === 0) return at;
    for (let pass = 0; pass < MAX_SETTLE_PASSES; pass += 1) {
      const next = Math.max(...scopes.map((scope) => this.earliestIn(scope, at, now)));
      if (next === at) break;
      at = next;
    }
    for (const scope of scopes) {
      const booked = [...this.booked(scope, now), at].sort((left, right) => left - right);
      this.sends.set(scope.key, booked);
    }
    return at;
  }

  /** The earliest time at or after `at` a send fits every window of this scope. */
  private earliestIn(scope: LimitScope, at: number, now: number): number {
    const limit = scope.limits.messagesSentPerMinute!;
    const booked = this.booked(scope, now);
    const candidates = [at, ...booked.map((time) => time + RATE_WINDOW_MS)]
      .filter((time) => time >= at)
      .sort((left, right) => left - right);
    return candidates.find((time) => fits(booked, time, limit)) ?? at;
  }

  /** Bookings that still count: inside the window ending now, or later. */
  private booked(scope: LimitScope, now: number): number[] {
    const booked = inWindow(this.sends.get(scope.key), now);
    if (booked.length === 0) this.sends.delete(scope.key);
    return booked;
  }

  private async sleepUntil(
    at: number,
    conversationId: string,
    scopes: readonly LimitScope[],
  ): Promise<void> {
    const delayMs = at - this.now();
    if (delayMs <= 0) return;
    this.deps.logger.info?.("channel outbound paced", {
      channel: this.deps.account.channel,
      account: this.deps.account.accountId,
      conversationId,
      delayMs,
      scopes: scopes.map(({ label }) => label),
    });
    await (this.deps.sleep ?? defaultSleep)(delayMs, this.deps.abortSignal);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

function laneKey(destination: Destination): string {
  return JSON.stringify([destination.to, destination.threadId ?? null]);
}

/** Drop every progress line still waiting: a newer one replaces it. */
function supersedeProgress(lane: LaneEntry[]): void {
  for (let index = lane.length - 1; index >= 0; index -= 1) {
    const entry = lane[index]!;
    if (entry.priority !== "progress") continue;
    lane.splice(index, 1);
    entry.supersede();
  }
}

/** The first waiting answer, else the (single, newest) progress line. */
function takeNext(lane: LaneEntry[]): LaneEntry {
  const answer = lane.findIndex((entry) => entry.priority === "answer");
  return lane.splice(Math.max(0, answer), 1)[0]!;
}

/** A send at `time` keeps every window that contains it at or under `limit`. */
function fits(booked: readonly number[], time: number, limit: number): boolean {
  const windowEnds = [time, ...booked.filter((end) => end > time && end < time + RATE_WINDOW_MS)];
  return windowEnds.every(
    (end) => booked.filter((sent) => sent > end - RATE_WINDOW_MS && sent <= end).length < limit,
  );
}

/** Wakes early when the account stops, so a stopped pacer holds no timer. */
async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { ref: false, ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  }
}
