// COMPAT(clisbot-channels): targeted tests for the wire narrowing at the plane
// boundary (`plane/stream.ts`): the root relay events, the approval events, and
// the subagent frames (`agent.provider_subagents.update`) — including that an
// unrecognised frame narrows to `undefined` rather than leaking a partial shape.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  asPermissionRequest,
  asPermissionResolved,
  asRelayedEvent,
  asSubagentEvent,
  ROOT_SCOPE,
  type SubagentStreamEvent,
} from "./stream.js";

describe("asRelayedEvent", () => {
  it("narrows the root timeline / completion / close events", () => {
    assert.deepEqual(asRelayedEvent({ type: "timeline", turnId: "t1", item: { type: "todo" } }), {
      kind: "timeline",
      turnId: "t1",
      item: { type: "todo" },
    });
    assert.deepEqual(asRelayedEvent({ type: "turn_completed", turnId: "t1" }), {
      kind: "turn_completed",
      turnId: "t1",
    });
    assert.deepEqual(asRelayedEvent({ type: "turn_failed", turnId: "t1" }), {
      kind: "turn_closed",
      turnId: "t1",
    });
    assert.deepEqual(asRelayedEvent({ type: "turn_canceled", turnId: "t1" }), {
      kind: "turn_closed",
      turnId: "t1",
    });
  });

  it("narrows turn_started onto the turn-open signal (the typing seam)", () => {
    assert.deepEqual(asRelayedEvent({ type: "turn_started", turnId: "t1" }), {
      kind: "turn_started",
      turnId: "t1",
    });
    // No turnId on the wire is still a turn-open signal, keyed by "".
    assert.deepEqual(asRelayedEvent({ type: "turn_started" }), {
      kind: "turn_started",
      turnId: "",
    });
  });

  it("narrows unknown event types to undefined", () => {
    assert.equal(asRelayedEvent({ type: "attention_required" }), undefined);
    assert.equal(asRelayedEvent(null), undefined);
  });
});

describe("asPermissionRequest / asPermissionResolved", () => {
  it("narrows the permission events, and nothing else", () => {
    const request = asPermissionRequest({
      type: "permission_requested",
      request: { id: "r1", provider: "codex", name: "Edit" },
    });
    assert.equal(request?.id, "r1");
    assert.equal(asPermissionRequest({ type: "timeline", request: { id: "r1" } }), undefined);
    assert.equal(asPermissionResolved({ type: "permission_resolved", requestId: "r1" }), "r1");
    assert.equal(asPermissionResolved({ type: "permission_resolved" }), undefined);
  });
});

describe("asSubagentEvent", () => {
  it("narrows an upsert frame, remembering the label from title (falling back to description)", () => {
    assert.deepEqual(
      asSubagentEvent({
        type: "agent.provider_subagents.update",
        payload: {
          kind: "upsert",
          subagent: {
            id: "sub-1",
            parentAgentId: "agent-1",
            title: "Research",
            description: "dig into X",
            status: "running",
          },
        },
      }),
      {
        kind: "upsert",
        parentAgentId: "agent-1",
        subagentId: "sub-1",
        label: "Research",
        status: "running",
      },
    );
    const unlabeled = asSubagentEvent({
      type: "agent.provider_subagents.update",
      payload: {
        kind: "upsert",
        subagent: {
          id: "sub-2",
          parentAgentId: "agent-1",
          title: null,
          description: "dig into Y",
          status: "completed",
        },
      },
    });
    assert.deepEqual(unlabeled, {
      kind: "upsert",
      parentAgentId: "agent-1",
      subagentId: "sub-2",
      label: "dig into Y",
      status: "completed",
    });
    assert.deepEqual(
      asSubagentEvent({
        type: "agent.provider_subagents.update",
        payload: {
          kind: "upsert",
          subagent: {
            id: "sub-3",
            parentAgentId: "agent-1",
            title: null,
            description: null,
            status: "running",
          },
        },
      }),
      {
        kind: "upsert",
        parentAgentId: "agent-1",
        subagentId: "sub-3",
        label: null,
        status: "running",
      },
      "no title or description: the label is null",
    );
  });

  it("narrows a timeline frame into the root item union + subagent scope", () => {
    const event: SubagentStreamEvent | undefined = asSubagentEvent({
      type: "agent.provider_subagents.update",
      payload: {
        kind: "timeline",
        parentAgentId: "agent-1",
        subagentId: "sub-1",
        provider: "codex",
        item: { type: "assistant_message", messageId: "m1", text: "hello" },
        timestamp: "2026-08-27T00:00:00.000Z",
        seq: 7,
        epoch: "e1",
      },
    });
    assert.deepEqual(event, {
      kind: "timeline",
      parentAgentId: "agent-1",
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m1", text: "hello" },
    });
  });

  it("narrows a remove frame", () => {
    assert.deepEqual(
      asSubagentEvent({
        type: "agent.provider_subagents.update",
        payload: { kind: "remove", parentAgentId: "agent-1", subagentId: "sub-1" },
      }),
      {
        kind: "remove",
        parentAgentId: "agent-1",
        subagentId: "sub-1",
      },
    );
  });

  it("narrows non-subagent or malformed frames to undefined", () => {
    assert.equal(asSubagentEvent({ type: "agent_stream", payload: { kind: "upsert" } }), undefined);
    assert.equal(
      asSubagentEvent({
        type: "agent.provider_subagents.update",
        payload: { kind: "timeline", parentAgentId: "agent-1", subagentId: "sub-1", item: null },
      }),
      undefined,
    );
    assert.equal(
      asSubagentEvent({
        type: "agent.provider_subagents.update",
        payload: { kind: "unknown-kind" },
      }),
      undefined,
    );
    assert.equal(asSubagentEvent(null), undefined);
  });
});

describe("scope constants", () => {
  it("exports the root scope as a stable singleton", () => {
    assert.deepEqual(ROOT_SCOPE, { kind: "root" });
  });
});
