import {
  PendingEventBudget,
  pendingSessionEvents,
} from "./session-storage/pending-event-budget.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AgentPermissionRequest, AgentPermissionResponse } from "./agent-sdk-types.js";
import type {
  AgentPermissionResponseRecord,
  SessionActor,
  SessionChannelReference,
} from "@getpaseo/protocol/session-authorship";

export interface PermissionResponseJournal {
  readPermissionResponse(
    agentId: string,
    id: string,
  ): Promise<AgentPermissionResponseRecord | null>;
  appendPermissionResponse(
    agentId: string,
    record: AgentPermissionResponseRecord,
    identity?: { channel?: SessionChannelReference },
  ): Promise<void>;
}

/** Serializes admission against the current live request, never a reusable provider request ID. */
export class PermissionResponseAdmission {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly acceptedRequests = new WeakSet<AgentPermissionRequest>();
  constructor(
    private readonly journal: PermissionResponseJournal,
    private readonly budget: PendingEventBudget = pendingSessionEvents,
  ) {}

  respond<Result>(input: {
    agentId: string;
    requestId: string;
    responseId?: string;
    requestGeneration?: string;
    timestamp?: string;
    toolCallId?: string;
    toolCallCursor?: AgentPermissionResponseRecord["toolCallCursor"];
    response: AgentPermissionResponse;
    respondedBy?: SessionActor;
    channel?: SessionChannelReference;
    getPendingRequest(): AgentPermissionRequest | undefined;
    forward(response: AgentPermissionResponse): Promise<Result>;
    applied(record: AgentPermissionResponseRecord): Promise<void>;
  }): Promise<Result | undefined> {
    const params = { ...input };
    const observedRequest = params.getPendingRequest();
    // Reserve before cloning or retaining the caller's snapshots in queued closures.
    const release = this.budget.reserve(params.agentId, {
      request: observedRequest,
      response: params.response,
      actor: params.respondedBy,
      channel: params.channel,
      toolCallCursor: params.toolCallCursor,
    });
    let snapshot: {
      identity: { channel?: SessionChannelReference };
      response: AgentPermissionResponse;
      respondedBy?: SessionActor;
      requestSnapshot?: AgentPermissionRequest;
      toolCallCursor?: AgentPermissionResponseRecord["toolCallCursor"];
    };
    try {
      snapshot = structuredClone({
        identity: { channel: params.channel },
        response: params.response,
        respondedBy: params.respondedBy,
        requestSnapshot: observedRequest,
        toolCallCursor: params.toolCallCursor,
      });
    } catch (error) {
      release();
      throw error;
    }
    const { identity, response, respondedBy, requestSnapshot } = snapshot;
    const toolCallId =
      params.toolCallId ??
      (typeof requestSnapshot?.metadata?.toolCallId === "string"
        ? requestSnapshot.metadata.toolCallId
        : undefined);
    const timestamp = params.timestamp ?? new Date().toISOString();
    const previous = this.tails.get(params.agentId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        // COMPAT(agentSessionStorage): unreleased Fusion; retain generated UUID fallback until supported clients explicitly negotiate stable response IDs (review 2027-03-11).
        const id = params.responseId ?? randomUUID();
        const existing = await this.journal.readPermissionResponse(params.agentId, id);
        if (existing) {
          if (
            (params.requestGeneration !== undefined &&
              existing.request.metadata?.paseoPermissionGeneration !== params.requestGeneration) ||
            existing.request.id !== params.requestId ||
            !isDeepStrictEqual(existing.response, response) ||
            !isDeepStrictEqual(existing.respondedBy, respondedBy)
          ) {
            throw new Error(
              "Permission response ID already belongs to a different response or actor",
            );
          }
          // Pending means unconfirmed, including after restart. Never automatically forward again.
          return undefined;
        }
        const request = params.getPendingRequest();
        if (!request) throw new Error("Permission request is no longer pending");
        if (
          params.requestGeneration !== undefined &&
          request.metadata?.paseoPermissionGeneration !== params.requestGeneration
        )
          throw new Error("Permission request generation changed before response admission");
        if (request !== observedRequest || !requestSnapshot) {
          throw new Error("Permission request changed before response admission");
        }
        if (this.acceptedRequests.has(request))
          throw new Error("Permission request already has an accepted response");
        const record: AgentPermissionResponseRecord = {
          id,
          timestamp,
          respondedBy,
          request: requestSnapshot,
          response,
          status: "pending",
          ...(snapshot.toolCallCursor ? { toolCallCursor: snapshot.toolCallCursor } : {}),
          ...(toolCallId ? { toolCallId } : {}),
        };
        await this.journal.appendPermissionResponse(params.agentId, record, identity);
        this.acceptedRequests.add(request);
        // The provider may resolve/reuse its ID while the durable write is in flight.
        // We have not forwarded anything yet, so this failure is known, not ambiguous.
        if (params.getPendingRequest() !== request) {
          const error = "Permission request changed before response could be forwarded";
          await this.journal.appendPermissionResponse(params.agentId, {
            ...record,
            status: "failed",
            error,
          });
          throw new Error(error);
        }
        // A thrown transport/adapter error does not prove non-delivery. Keep pending.
        const result = await params.forward(structuredClone(record.response));
        const applied = { ...record, status: "applied" as const };
        await this.journal.appendPermissionResponse(params.agentId, applied);
        await params.applied(applied);
        return result;
      });
    this.tails.set(params.agentId, task);
    void task
      .finally(() => {
        release();
        if (this.tails.get(params.agentId) === task) this.tails.delete(params.agentId);
      })
      .catch(() => undefined);
    return task;
  }
}
