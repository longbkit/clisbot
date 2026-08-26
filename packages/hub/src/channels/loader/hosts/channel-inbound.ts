// The bound `openclaw/plugin-sdk/channel-inbound` seam module (plan §7,
// implementation doc §4.1). The loader's resolve/load hooks replace the main
// package's pure `channel-inbound` with a merged module whose SEAM exports are
// these functions: they take the channel's normalized inbound event and hand it
// to the Hub's per-account HostRuntime (`onInboundReply`), which drives the real
// agent + relay. The pure normalizers in the same subpath stay OpenClaw's
// (merged in via `export *` from the pinned main package, see hooks.ts).
//
// Failure domain rule (plan §14.5 / P13): a fault here must never throw into the
// channel. Every dispatch catches, logs through the runtime logger, and returns a
// benign no-dispatch `InboundReplyResult`. A missing runtime is a load-time
// fault the control plane will have surfaced; at call time we still fail closed
// (log + no-dispatch) rather than crash the channel's event loop.

import type { InboundReplyParams, InboundReplyResult } from "../host.js";
import { getChannelRuntime } from "../runtime-store.js";
import { getChannelSeamLogger } from "../seam-logger.js";

/** The benign result returned when nothing is dispatched (runtime missing, or
 * the runtime handler threw). Shape matches what OpenClaw's pipeline reads
 * (`dispatched` false; no `dispatchResult`). */
const NO_DISPATCH: InboundReplyResult = {
  dispatched: false,
};

function accountIdOf(params: InboundReplyParams): string {
  return typeof params.accountId === "string" ? params.accountId : "";
}

/** Resolve the channel account's runtime and run its `onInboundReply`, catching
 * everything. `op` is the caller's name for log attribution. */
async function dispatchToRuntime(
  params: InboundReplyParams,
  op: string,
): Promise<InboundReplyResult> {
  const accountId = accountIdOf(params);
  // TEMP DIAGNOSTIC (fast-loop, 2026-08-26): name every seam entry so a live
  // marker that never reaches the plane is bracketed — the vertical pipeline is
  // third-party and cannot be instrumented, so the seam is the one in-repo
  // point that says "the native pipeline handed us the event". Logged through
  // the process-wide sink (wired by the supervisor) so it is visible on BOTH
  // the runtime-found and runtime-miss paths. Remove once the live E2E is green.
  getChannelSeamLogger()?.info?.("channel-inbound seam entry", {
    channel: params.channel,
    accountId,
    op,
    ctxKeys: Object.keys(params.ctxPayload ?? {}),
  });
  const runtime = getChannelRuntime(params.channel, accountId);
  if (runtime === undefined) {
    // No runtime for this account: fail closed, and name it. The seam has no
    // runtime logger to route through, so it reports through the process-wide
    // sink the supervisor assigns (seam-logger.ts) — a miss that stays silent
    // would otherwise make a running-but-unwired account indistinguishable
    // from a dead one. With no sink assigned (a test without the supervisor)
    // the miss stays silent; the P13 contract is the no-dispatch result.
    getChannelSeamLogger()?.warn("channel-inbound no runtime for this account (op)", {
      channel: params.channel,
      accountId,
      op,
    });
    return { ...NO_DISPATCH };
  }
  const logger = runtime.logging.getChildLogger({ op });
  try {
    return await runtime.onInboundReply(params);
  } catch (error) {
    logger.warn(`channel-inbound dispatch fault (${op})`, {
      channel: params.channel,
      accountId,
      error: errorMessage(error),
    });
    return { ...NO_DISPATCH };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Primary seam: the channel's prepared inbound event → the Hub. The Hub returns
 * once the agent + relay have accepted the event. Never throws. */
export function dispatchChannelInboundReply(
  params: InboundReplyParams,
): Promise<InboundReplyResult> {
  return dispatchToRuntime(params, "dispatchChannelInboundReply");
}

/** Alternate inbound entry point OpenClaw's turn loop may use. Routed to the
 * same runtime seam as `dispatchChannelInboundReply`. */
export function runChannelInboundEvent(params: InboundReplyParams): Promise<InboundReplyResult> {
  return dispatchToRuntime(params, "runChannelInboundEvent");
}

/** Prepared-reply dispatch (a turn whose reply is already composed). Routed to
 * the same runtime seam. */
export function runPreparedInboundReply(params: InboundReplyParams): Promise<InboundReplyResult> {
  return dispatchToRuntime(params, "runPreparedInboundReply");
}

/** Config-driven dispatch with a settled dispatcher. Routed to the same runtime
 * seam. */
export function dispatchReplyFromConfigWithSettledDispatcher(
  params: InboundReplyParams,
): Promise<InboundReplyResult> {
  return dispatchToRuntime(params, "dispatchReplyFromConfigWithSettledDispatcher");
}
