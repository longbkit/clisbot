import { createHash } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { reportFailure } from "../../../../failures/index.js";
import { logger } from "../../../../logger.js";
import type { TriggerHandler, TriggerSource } from "../../../index.js";
import {
  intakeSlackEvent,
  SlackEventIntakeValidationError,
  type SlackEventIntakeOptions,
} from "./intake.js";
import {
  openSlackSocket,
  SlackSocketConnectionError,
  type OpenSlackSocketResult,
} from "./connection.js";
import {
  parseSlackSocketFrame,
  slackSocketFrame,
  slackSocketAck,
  SlackSocketDisconnectSchema,
  SlackSocketEnvelopeSchema,
} from "./socket-protocol.js";

const MAX_FRAME_BYTES = 1_048_576;

export type SlackDeliveryStatus =
  | { state: "connecting" | "reconnecting" | "connected" }
  | {
      state: "actionNeeded";
      reason: "appTokenRejected" | "socketModeOff" | "appIdentityMismatch";
    }
  | { state: "stopped" };

export interface SlackSocketSource extends TriggerSource {
  status(): SlackDeliveryStatus;
  retry(): Promise<void>;
}

export interface SlackSocketSourceOptions extends SlackEventIntakeOptions {
  appToken: string;
  apiUrl?: string;
  random?: () => number;
  timeoutMs?: number;
}

export function createSlackSocketSource(options: SlackSocketSourceOptions): SlackSocketSource {
  const handlers = new Set<TriggerHandler>();
  const random = options.random ?? Math.random;
  let status: SlackDeliveryStatus = { state: "stopped" };
  let stopped = true;
  let attempt = 0;
  let controller: AbortController | undefined;
  let current: OpenSlackSocketResult | undefined;
  let supervisor: Promise<void> | undefined;
  let wake: (() => void) | undefined;
  let frames = Promise.resolve();
  let failureOwned = false;
  let expectedClose = false;
  let terminalDisconnect: "socketModeOff" | undefined;
  let transientReported = false;
  let minimumDelay = 0;
  const scrubValues = () => [
    options.appToken,
    ...(options.apiUrl === undefined ? [] : [options.apiUrl]),
  ];

  const run = async () => {
    for (;;) {
      if (stopped) return;
      status = { state: attempt === 0 ? "connecting" : "reconnecting" };
      controller = new AbortController();
      try {
        const connection = await openSlackSocket({
          appToken: options.appToken,
          appId: options.appId,
          signal: controller.signal,
          ...(options.apiUrl === undefined ? {} : { apiUrl: options.apiUrl }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
        current = connection;
        failureOwned = false;
        expectedClose = false;
        terminalDisconnect = undefined;
        transientReported = false;
        attempt = 0;
        status = { state: "connected" };
        logger.info(
          { provider: "slack", operation: "slack.socket.connect", appId: options.appId },
          "Slack Socket Mode connected",
        );
        connection.socket.on("message", (data, binary) => {
          frames = frames
            .then(() => handleFrame(connection, data, binary))
            .catch((error: unknown) => {
              if (!failureOwned) {
                failureOwned = true;
                report(error, "slack.socket.handoff", "internal");
              }
              connection.socket.close();
            });
        });
        const closed = await connection.closed;
        current = undefined;
        if (stopped) return;
        if (terminalDisconnect !== undefined) {
          status = { state: "actionNeeded", reason: terminalDisconnect };
          if (!failureOwned)
            report(new Error("Slack Socket Mode is off"), "slack.socket.disconnect", "validation");
          return;
        }
        if (!expectedClose && !failureOwned) {
          report(
            Object.assign(new Error("Slack Socket Mode connection closed"), {
              closeCode: closed,
            }),
            "slack.socket.connect",
            "network",
          );
          transientReported = true;
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        if (error instanceof SlackSocketConnectionError && error.reason !== "transient") {
          status = { state: "actionNeeded", reason: error.reason };
          report(error, "slack.socket.authenticate", "authentication");
          return;
        }
        if (!transientReported) {
          transientReported = true;
          report(error, "slack.socket.connect", "network");
        }
        minimumDelay = error instanceof SlackSocketConnectionError ? error.retryAfterMs : 0;
      }
      attempt += 1;
      const delayMs = Math.max(
        minimumDelay,
        Math.floor(random() * Math.min(30_000, 1_000 * 2 ** (attempt - 1))),
      );
      minimumDelay = 0;
      await waitForRetry(delayMs);
    }
  };

  const startSupervisor = () => {
    supervisor = run().catch((error: unknown) => report(error, "slack.socket.loop", "internal"));
  };

  return {
    async start(handler) {
      handlers.add(handler);
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      startSupervisor();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      controller?.abort();
      wake?.();
      const connection = current;
      if (connection !== undefined) await connection.close(250, "shutdown");
      await supervisor;
      await frames;
      handlers.clear();
      status = { state: "stopped" };
    },
    status: () => status,
    async retry() {
      if (!stopped && status.state !== "actionNeeded") {
        wake?.();
        return;
      }
      if (stopped) return;
      attempt = 0;
      transientReported = false;
      startSupervisor();
    },
  };

  async function handleFrame(
    connection: OpenSlackSocketResult,
    data: RawData,
    binary: boolean,
  ): Promise<void> {
    const frame = slackSocketFrame(data);
    const bytes = frame.byteLength;
    if (binary || bytes > MAX_FRAME_BYTES) {
      reportInvalidFrame(bytes);
      return;
    }
    const value = parseSlackSocketFrame(frame);
    const disconnect = SlackSocketDisconnectSchema.safeParse(value);
    if (disconnect.success) {
      expectedClose = disconnect.data.reason !== "link_disabled";
      if (!expectedClose) terminalDisconnect = "socketModeOff";
      connection.socket.close(1000, disconnect.data.reason);
      return;
    }
    const envelope = SlackSocketEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      reportInvalidFrame(bytes);
      const envelopeId = boundedEnvelopeId(value);
      if (envelopeId !== undefined) await sendAck(connection.socket, envelopeId);
      return;
    }
    if (envelope.data.type === "events_api") {
      if (objectString(envelope.data.payload, "type") === "app_rate_limited") {
        logger.warn(
          {
            provider: "slack",
            operation: "slack.socket.rate_limited",
            teamId: objectString(envelope.data.payload, "team_id"),
          },
          "Slack is delaying events for a workspace",
        );
      } else {
        const signatureHash = createHash("sha256").update(envelope.data.envelope_id).digest("hex");
        try {
          await intakeSlackEvent(envelope.data.payload, signatureHash, handlers, options);
        } catch (error) {
          if (!(error instanceof SlackEventIntakeValidationError)) throw error;
          reportInvalidFrame(bytes);
        }
      }
    }
    if (!stopped) await sendAck(connection.socket, envelope.data.envelope_id);
  }

  async function sendAck(socket: WebSocket, envelopeId: string): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        socket.send(slackSocketAck(envelopeId), (error) => {
          if (error != null) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    } catch (error) {
      failureOwned = true;
      report(error, "slack.socket.ack", "network");
      socket.close();
    }
  }

  function waitForRetry(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref();
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = undefined;
    });
  }

  function report(
    error: unknown,
    operation: string,
    kind: "authentication" | "network" | "validation" | "internal",
  ): void {
    reportFailure(
      error,
      { operation, component: "triggers", provider: "slack" },
      { kind, scrubValues: scrubValues() },
    );
  }

  function reportInvalidFrame(byteCount: number): void {
    report(
      Object.assign(new Error("Slack sent an invalid event"), { frameBytes: byteCount }),
      "slack.socket.envelope.parse",
      "validation",
    );
  }
}

function boundedEnvelopeId(value: unknown): string | undefined {
  const id = objectString(value, "envelope_id");
  return id !== undefined && id.length <= 255 ? id : undefined;
}

function objectString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}
