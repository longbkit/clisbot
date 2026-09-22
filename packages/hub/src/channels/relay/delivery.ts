// One relay post, record-before-post (relay/index.ts): record the ledger row,
// post, then confirm it or settle the failure. Final answers that certainly
// did not land go to the bounded retry (final-retry.ts); everything else is
// closed. The ledger writes themselves are retried briefly: a row that cannot
// be recorded means the answer is not posted, and a row that cannot be settled
// stays `recorded` forever, so either is logged as an error, not dropped quietly.
import type { ChannelStore } from "../../db/channels.js";
import type { DeliveryLedgerKey } from "../../db/channel-delivery-retries.js";
import { routeFingerprint, routePosition } from "../bindings/stored-route.js";
import type {
  OutboundPostParams,
  OutboundPostResult,
  PlaneClock,
  PlaneLogger,
  PostFn,
  StreamContext,
} from "../plane/types.js";
import type { StreamingFinalizeTransport } from "../streaming/index.js";
import { closeUnretriedDelivery, settleFailedFinalAnswer } from "./final-retry.js";

/** What a relay post carries: answer text, or a status line (progress / tool). */
export type OutputKind = "assistant" | "progress" | "tool";

/** Waits before each ledger-write attempt: three tries within about a second. */
const LEDGER_WRITE_DELAYS_MS = [0, 250, 1_000];

export interface RelayDeliveryDeps {
  store: ChannelStore;
  post: PostFn;
  logger: PlaneLogger;
  clock: PlaneClock;
}

export interface RelayPostRequest {
  context: StreamContext;
  key: DeliveryLedgerKey;
  location: Pick<OutboundPostParams, "to" | "threadId">;
  text: string;
  outputKind: OutputKind;
  transport?: StreamingFinalizeTransport | undefined;
}

/** Record, post, and confirm or settle one relay post. */
export async function deliverRelayPost(
  deps: RelayDeliveryDeps,
  request: RelayPostRequest,
): Promise<void> {
  const { context, key } = request;
  const recorded = await recordRow(deps, request);
  if (recorded === undefined || !recorded.created) return; // replay/restart: already handled
  const outputAttemptId = await context.outputDelivery?.begin();
  if (context.outputDelivery !== undefined && outputAttemptId === undefined) {
    await ledgerWrite(deps, request, "settle", () =>
      deps.store.failDelivery({ ...key, failureReason: "workflow output limit reached" }),
    );
    return;
  }
  deps.logger.info?.("relay post started", { ...logFields(request) });
  const result = await (request.transport ?? deps.post)(postParams(request));
  if (result.ok) {
    await confirmPosted(deps, request, result);
    if (outputAttemptId !== undefined) await context.outputDelivery?.complete(outputAttemptId);
    return;
  }
  if (outputAttemptId !== undefined) await context.outputDelivery?.fail(outputAttemptId);
  const next = await ledgerWrite(deps, request, "settle", () =>
    settleFailedPost(deps, request, { attempts: recorded.record.attempts, result }),
  );
  deps.logger.warn("relay post failed", {
    ...logFields(request),
    error: result.error,
    failure: result.failure?.kind,
    next,
  });
}

/**
 * Record the row before the post. A retried insert that finds the row already
 * there cannot tell its own lost commit from a replay racing it, so it does
 * not post (a double post is worse than a lost one) and says so as an error.
 */
async function recordRow(deps: RelayDeliveryDeps, request: RelayPostRequest) {
  let tries = 0;
  const recorded = await ledgerWrite(deps, request, "record", () => {
    tries += 1;
    return deps.store.recordDelivery({ ...request.key, channel: request.context.channel });
  });
  if (recorded !== undefined && !recorded.created && tries > 1) {
    (deps.logger.error ?? deps.logger.warn)("relay ledger record found its row after a retry", {
      ...logFields(request),
      status: recorded.record.status,
      consequence:
        "an earlier try may have committed; the message was not posted, to avoid a double post",
    });
  }
  return recorded;
}

function postParams(request: RelayPostRequest): OutboundPostParams {
  const { context, location } = request;
  return {
    channel: context.channel,
    accountId: context.accountId,
    to: location.to,
    ...(location.threadId !== undefined ? { threadId: location.threadId } : {}),
    text: request.text,
    ...(request.outputKind === "assistant" ? {} : { priority: "progress" as const }),
  };
}

async function confirmPosted(
  deps: RelayDeliveryDeps,
  request: RelayPostRequest,
  result: OutboundPostResult,
): Promise<void> {
  const externalMessageId = result.externalMessageId ?? "";
  await ledgerWrite(deps, request, "confirm", () =>
    deps.store.confirmDelivery({ ...request.key, externalMessageId, postedAt: new Date() }),
  );
  deps.logger.info?.("relay post completed", { ...logFields(request), externalMessageId });
}

/**
 * Final answers are retried from the ledger; progress and tool lines are
 * not. A Workflow's output is excluded: its output budget counts each post
 * once, at the turn that made it, and a later retry could not be counted.
 */
async function settleFailedPost(
  deps: RelayDeliveryDeps,
  request: RelayPostRequest,
  failed: { attempts: number; result: OutboundPostResult },
): Promise<"dropped" | "retry-scheduled" | "given-up"> {
  const { context, key, location } = request;
  if (request.outputKind !== "assistant" || context.outputDelivery !== undefined) {
    await closeUnretriedDelivery(deps.store, key, failed.result);
    return "dropped";
  }
  return settleFailedFinalAnswer({
    store: deps.store,
    scope: {
      organizationId: key.organizationId,
      channel: context.channel,
      accountId: key.accountId,
    },
    key,
    attempts: failed.attempts,
    payload: {
      to: location.to,
      threadId: location.threadId ?? null,
      text: request.text,
      routePosition: routePosition(context.account, context.route),
      routeFingerprint: routeFingerprint(context.route),
      senderIdentity: context.initiator,
    },
    result: failed.result,
    now: deps.clock.now(),
  });
}

type LedgerStep = "record" | "confirm" | "settle";

/** What is lost when a ledger step cannot be written at all. */
const LEDGER_STEP_CONSEQUENCE: Record<LedgerStep, string> = {
  record: "the message was not posted",
  confirm: "the message was posted; its row stays recorded and is never posted again",
  settle: "the failed post is not recorded; its row stays recorded and is never posted again",
};

/** Run one ledger write, retrying briefly; after the last try, log what was lost. */
async function ledgerWrite<T>(
  deps: RelayDeliveryDeps,
  request: RelayPostRequest,
  step: LedgerStep,
  write: () => Promise<T>,
): Promise<T | undefined> {
  let lastError: unknown;
  for (const delayMs of LEDGER_WRITE_DELAYS_MS) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await write();
    } catch (error) {
      lastError = error;
    }
  }
  const log = deps.logger.error ?? deps.logger.warn;
  log("relay ledger write failed", {
    ...logFields(request),
    step,
    consequence: LEDGER_STEP_CONSEQUENCE[step],
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return undefined;
}

function logFields(request: RelayPostRequest) {
  const { context, key, outputKind } = request;
  return {
    channel: context.channel,
    accountId: context.accountId,
    agentId: context.agentId,
    eventTurnId: key.eventTurnId,
    sequence: key.sequence,
    outputKind,
  };
}
