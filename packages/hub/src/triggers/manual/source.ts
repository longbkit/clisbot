import { isDatabaseUnavailableError } from "../../db/errors.js";
import type { Database } from "../../db/types.js";
import { reportFailure } from "../../failures/index.js";
import { logger } from "../../logger.js";
import type { TriggerDispatchOutcome, TriggerHandler, TriggerSource } from "../index.js";
import { parseManualTriggerPayload } from "./parse.js";
import type { ManualTriggerInput } from "./schema.js";

interface ManualTriggerState {
  database: Database;
  handler: TriggerHandler | undefined;
}

const manualTriggerStates = new WeakMap<TriggerSource, ManualTriggerState>();

export function createManualTriggerSource(database: Database): TriggerSource {
  const state: ManualTriggerState = { database, handler: undefined };
  const source: TriggerSource = {
    async start(nextHandler: TriggerHandler): Promise<void> {
      state.handler = nextHandler;
    },
    async stop(): Promise<void> {
      state.handler = undefined;
    },
  };

  manualTriggerStates.set(source, state);

  return source;
}

export async function handleManualTriggerRequest(
  request: Request,
  source: TriggerSource,
  _entrypoint: "trigger" | "smoke",
): Promise<Response> {
  const state = manualTriggerStates.get(source);

  if (state === undefined) {
    throw new Error("manual trigger routes require a manual trigger source");
  }
  return handleManualRequest(request, source);
}

export async function dispatchManualTrigger(
  source: TriggerSource,
  trigger: ManualTriggerInput,
): Promise<TriggerDispatchOutcome | void> {
  const state = manualTriggerStates.get(source);
  if (state === undefined) throw new Error("manual_runtime_unavailable");
  const persisted = await state.database.persistManualEvent({
    ...trigger,
    connectionId: trigger.connectionId ?? null,
    resourceId: trigger.resourceId ?? null,
  });
  if (persisted.status === "duplicate") {
    logger.info(
      {
        source: trigger.source,
        deliveryId: trigger.deliveryId,
        receiptId: persisted.providerEventReceiptId,
        outcome: "duplicate",
      },
      "manual event intake completed",
    );
    return { providerEventReceiptId: persisted.providerEventReceiptId };
  }
  if (state.handler === undefined) {
    await state.database.markProviderEventDropped(
      persisted.event.providerEventReceiptId,
      "configuration_unavailable",
    );
    logger.info(
      {
        source: trigger.source,
        deliveryId: trigger.deliveryId,
        receiptId: persisted.event.providerEventReceiptId,
        outcome: "dropped",
        reason: "configuration_unavailable",
      },
      "manual event intake completed",
    );
    return { providerEventReceiptId: persisted.event.providerEventReceiptId };
  }
  logger.info(
    {
      source: trigger.source,
      deliveryId: trigger.deliveryId,
      receiptId: persisted.event.providerEventReceiptId,
      outcome: "accepted",
    },
    "manual event intake completed",
  );
  return state.handler(persisted.event);
}

async function handleManualRequest(request: Request, source: TriggerSource): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    reportFailure(
      error,
      { operation: "manual-trigger.parse", component: "triggers", status: 400 },
      { status: 400 },
    );
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseManualTriggerPayload(body);

  if (typeof parsed === "string") {
    reportFailure(
      Object.assign(new Error("Manual trigger payload rejected"), { code: "invalid_request" }),
      { operation: "manual-trigger.validate", component: "triggers", status: 400 },
      { status: 400 },
    );
    return Response.json({ error: parsed }, { status: 400 });
  }

  const trigger = parsed;

  try {
    await dispatchManualTrigger(source, trigger);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      reportFailure(
        error,
        { operation: "manual-trigger.persist", component: "triggers", status: 503 },
        { status: 503 },
      );
      return Response.json({ error: "database_unavailable" }, { status: 503 });
    }

    throw error;
  }

  return Response.json({ status: "accepted", deliveryId: trigger.deliveryId }, { status: 200 });
}
