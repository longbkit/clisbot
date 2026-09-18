// `messagesSentPerMinute`: new messages the bot posts are delayed until every
// scope they count in has room. Nothing is dropped, and messages to one
// conversation go out one at a time, in order. Other conversations are not
// held up by it. Typing, reactions and in-place edits are not messages and are
// not paced; streaming drafts use the vertical's own draft path and are not
// paced either. Delayed sends live in memory: an account restart loses them.
// docs/audits/2026-09-18-channel-chat-authority-and-limits.md#limits

import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { inWindow, limitScopes, RATE_WINDOW_MS, type LimitScope } from "./limit-scopes.js";
import type { PlaneLogger } from "./types.js";

/** Enough passes for three scopes to settle on one send time. */
const MAX_SETTLE_PASSES = 8;

interface OutboundPacerDeps {
  account: CompiledChannelAccount;
  logger: PlaneLogger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class OutboundPacer {
  private readonly deps: OutboundPacerDeps;
  /** Booked send times per scope, ascending; some may be in the future. */
  private readonly sends = new Map<string, number[]>();
  /** The Route that last served each conversation. */
  private readonly routes = new Map<string, CompiledRoute>();
  /** The last send queued per conversation, so one conversation stays in order. */
  private readonly tails = new Map<string, Promise<void>>();

  constructor(deps: OutboundPacerDeps) {
    this.deps = deps;
  }

  /** Remember which Route serves a conversation, for its Route-scope limit. */
  noteRoute(conversationId: string, route: CompiledRoute): void {
    this.routes.set(conversationId, route);
  }

  /** Wrap a send so it waits for its turn and holds it until the send finishes. */
  paced<Params extends { to: string }, Result>(
    send: (params: Params) => Promise<Result>,
  ): (params: Params) => Promise<Result> {
    return (params) => this.inTurn(params.to, () => send(params));
  }

  private async inTurn<Result>(conversationId: string, send: () => Promise<Result>) {
    const scopes = this.scopes(conversationId);
    if (scopes.length === 0) return send();
    const previous = this.tails.get(conversationId) ?? Promise.resolve();
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => turn);
    this.tails.set(conversationId, tail);
    await previous;
    try {
      await this.sleepUntil(this.reserve(scopes), conversationId, scopes);
      return await send();
    } finally {
      release();
      if (this.tails.get(conversationId) === tail) this.tails.delete(conversationId);
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
    await (this.deps.sleep ?? defaultSleep)(delayMs);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/** A send at `time` keeps every window that contains it at or under `limit`. */
function fits(booked: readonly number[], time: number, limit: number): boolean {
  const windowEnds = [time, ...booked.filter((end) => end > time && end < time + RATE_WINDOW_MS)];
  return windowEnds.every(
    (end) => booked.filter((sent) => sent > end - RATE_WINDOW_MS && sent <= end).length < limit,
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
