import { describe, expect, it, vi } from "vitest";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import type { AgentPermissionResponse } from "./agent-sdk-types.js";
import { PendingEventBudget } from "./session-storage/pending-event-budget.js";
import { PermissionResponseAdmission } from "./permission-response-journal.js";
function harness() {
  const records = new Map<string, AgentPermissionResponseRecord>();
  const writes: AgentPermissionResponseRecord[] = [];
  const journal = {
    readPermissionResponse: async (_: string, id: string) => records.get(id) ?? null,
    appendPermissionResponse: vi.fn(async (_: string, record: AgentPermissionResponseRecord) => {
      records.set(record.id, structuredClone(record));
      writes.push(structuredClone(record));
    }),
  };
  return {
    records,
    writes,
    journal,
    admission: new PermissionResponseAdmission(journal),
  };
}
const request = {
  id: "reused-provider-id",
  kind: "tool" as const,
  provider: "codex" as const,
  name: "Tool",
};
const actor = { kind: "user" as const, id: "A" };
function params() {
  return {
    agentId: "agent",
    requestId: request.id,
    responseId: "response-1",
    response: { behavior: "allow" as const },
    respondedBy: actor,
    getPendingRequest: () => request,
    forward: vi.fn(async () => undefined),
    applied: vi.fn(async () => undefined),
  };
}
describe("durable permission admission", () => {
  it("durably records pending before forwarding and applied only after acknowledgement", async () => {
    const h = harness();
    const p = params();
    p.forward.mockImplementation(async () => {
      expect(h.records.get(p.responseId)?.status).toBe("pending");
    });
    await h.admission.respond(p);
    expect(h.writes.map((record) => record.status)).toEqual(["pending", "applied"]);
    expect(p.applied).toHaveBeenCalledOnce();
  });
  it("does not forward when pending cannot be saved", async () => {
    const h = harness();
    const p = params();
    h.journal.appendPermissionResponse.mockRejectedValue(new Error("ENOSPC"));
    await expect(h.admission.respond(p)).rejects.toThrow("ENOSPC");
    expect(p.forward).not.toHaveBeenCalled();
  });
  it("retains the actor snapshot if its source changes while the provider acknowledges", async () => {
    const h = harness();
    const p = params();
    const mutableActor = { ...actor, displayName: "At admission" };
    p.forward.mockImplementation(async () => {
      mutableActor.displayName = "After admission";
    });
    await h.admission.respond({ ...p, respondedBy: mutableActor });
    expect(h.writes.map((record) => record.respondedBy?.displayName)).toEqual([
      "At admission",
      "At admission",
    ]);
  });
  it("forwards the exact admitted response despite queued caller and adapter mutations", async () => {
    const h = harness();
    const p = params();
    const response = { behavior: "allow" as const, updatedInput: { answer: "admitted" } };
    const respondedBy = { ...actor, displayName: "Admitted actor" };
    const liveRequest = { ...request, metadata: { toolCallId: "tool-original" } };
    const forward = vi.fn(async (recorded: AgentPermissionResponse) => {
      if (recorded.behavior !== "allow" || !recorded.updatedInput)
        throw new Error("Expected the admitted answer");
      expect(recorded.updatedInput.answer).toBe("admitted");
      recorded.updatedInput.answer = "adapter mutation";
      liveRequest.metadata.toolCallId = "tool-changed";
    });
    const result = h.admission.respond({
      ...p,
      response,
      respondedBy,
      getPendingRequest: () => liveRequest,
      forward,
    });
    response.updatedInput.answer = "caller mutation";
    respondedBy.displayName = "Caller mutation";
    liveRequest.metadata.toolCallId = "caller mutation";
    await result;
    expect(h.writes).toHaveLength(2);
    for (const record of h.writes) {
      expect(record.response).toEqual({ behavior: "allow", updatedInput: { answer: "admitted" } });
      expect(record.respondedBy?.displayName).toBe("Admitted actor");
      expect(record.request.metadata?.toolCallId).toBe("tool-original");
    }
  });
  it("keeps ambiguous errors pending and never replays pending after restart", async () => {
    const h = harness();
    const p = params();
    p.forward.mockRejectedValue(new Error("connection lost"));
    await expect(h.admission.respond(p)).rejects.toThrow("connection lost");
    expect(h.records.get(p.responseId)?.status).toBe("pending");
    await new PermissionResponseAdmission(h.journal).respond(p);
    expect(p.forward).toHaveBeenCalledOnce();
    expect(p.applied).not.toHaveBeenCalled();
    await expect(h.admission.respond({ ...p, responseId: "competitor" })).rejects.toThrow(
      "already has an accepted response",
    );
  });
  it("rejects retries changing actor or response", async () => {
    const h = harness();
    const p = params();
    await h.admission.respond(p);
    await expect(h.admission.respond({ ...p, respondedBy: { ...actor, id: "B" } })).rejects.toThrow(
      "different response or actor",
    );
    await expect(h.admission.respond({ ...p, response: { behavior: "deny" } })).rejects.toThrow(
      "different response or actor",
    );
    expect(p.forward).toHaveBeenCalledOnce();
  });
  it("does not apply an old decision to a provider request reused during the pending write", async () => {
    const h = harness();
    const p = params();
    let currentRequest = { ...request };
    const append = h.journal.appendPermissionResponse.getMockImplementation()!;
    h.journal.appendPermissionResponse.mockImplementation(async (agentId, record) => {
      await append(agentId, record);
      if (record.status === "pending") currentRequest = { ...request };
    });
    await expect(
      h.admission.respond({ ...p, getPendingRequest: () => currentRequest }),
    ).rejects.toThrow("Permission request changed");
    expect(p.forward).not.toHaveBeenCalled();
    expect(p.applied).not.toHaveBeenCalled();
    expect(h.records.get(p.responseId)?.status).toBe("failed");
    h.journal.appendPermissionResponse.mockImplementation(append);
    await h.admission.respond({
      ...p,
      responseId: "new-request-decision",
      getPendingRequest: () => currentRequest,
    });
    expect(p.forward).toHaveBeenCalledOnce();
  });
  it("rejects a queued competitor when the provider reuses the request ID after the first decision", async () => {
    const h = harness();
    const p = params();
    let currentRequest = { ...request };
    const getPendingRequest = () => currentRequest;
    p.forward.mockImplementation(async () => {
      currentRequest = { ...request };
    });
    const first = h.admission.respond({ ...p, getPendingRequest });
    const competitor = h.admission.respond({ ...p, responseId: "queued", getPendingRequest });
    await first;
    await expect(competitor).rejects.toThrow(
      "Permission request changed before response admission",
    );
    expect(p.forward).toHaveBeenCalledOnce();
    expect(h.records.has("queued")).toBe(false);
  });
  it("serializes competitors against current live request and allows reused provider IDs later", async () => {
    const h = harness();
    const p = params();
    let pending = true;
    let currentRequest = request;
    const getPendingRequest = () => (pending ? currentRequest : undefined);
    p.forward.mockImplementation(async () => {
      pending = false;
    });
    const one = h.admission.respond({ ...p, getPendingRequest });
    const two = h.admission.respond({
      ...p,
      getPendingRequest,
      responseId: "response-2",
    });
    await one;
    await expect(two).rejects.toThrow("no longer pending");
    pending = true;
    currentRequest = { ...request };
    await h.admission.respond({
      ...p,
      getPendingRequest,
      responseId: "response-3",
    });
    expect(p.forward).toHaveBeenCalledTimes(2);
  });
});

it("rejects a response to an older provider request generation before any durable admission", async () => {
  const h = harness();
  const p = {
    ...params(),
    requestGeneration: "previous",
    getPendingRequest: () => ({ ...request, metadata: { paseoPermissionGeneration: "current" } }),
  };
  await expect(h.admission.respond(p)).rejects.toThrow("generation changed");
  expect(h.writes).toHaveLength(0);
  expect(p.forward).not.toHaveBeenCalled();
});

it("bounds held permission snapshots before cloning and releases every reservation", async () => {
  const h = harness();
  const budget = new PendingEventBudget({
    sessionBytes: 1024 * 1024,
    totalBytes: 3 * 1024 * 1024,
    sessionEvents: 2,
    totalEvents: 3,
  });
  const admission = new PermissionResponseAdmission(h.journal, budget);
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const p = { ...params(), forward: vi.fn(() => blocked) };
  const first = admission.respond(p);
  const queued = admission.respond({ ...p, responseId: "queued" });
  const queuedResult = expect(queued).rejects.toThrow("already has an accepted response");
  const clone = vi.spyOn(globalThis, "structuredClone");
  const before = clone.mock.calls.length;
  expect(() => admission.respond({ ...p, responseId: "overflow" })).toThrow("count limit");
  expect(clone).toHaveBeenCalledTimes(before);
  clone.mockRestore();
  const requestB = { ...request };
  const other = admission.respond({
    ...p,
    agentId: "B",
    responseId: "B",
    getPendingRequest: () => requestB,
  });
  expect(() => admission.respond({ ...p, agentId: "C", responseId: "C" })).toThrow("count limit");
  expect(budget.pendingEvents).toBe(3);
  unblock();
  await Promise.all([first, queuedResult, other]);
  expect(budget.pendingBytes).toBe(0);
  expect(budget.pendingEvents).toBe(0);
  await admission.respond(p);
  expect(budget.pendingEvents).toBe(0);
  const failed = {
    ...p,
    agentId: "failed",
    responseId: "failed",
    getPendingRequest: () => ({ ...request }),
    forward: vi.fn(async () => {
      throw new Error("uncertain delivery");
    }),
  };
  const failureRequest = { ...request };
  failed.getPendingRequest = () => failureRequest;
  await expect(admission.respond(failed)).rejects.toThrow("uncertain delivery");
  expect(h.records.get("failed")?.status).toBe("pending");
  expect(budget.pendingBytes).toBe(0);
  expect(budget.pendingEvents).toBe(0);
});

it("releases a permission reservation when snapshot cloning fails", () => {
  const h = harness();
  const budget = new PendingEventBudget();
  const admission = new PermissionResponseAdmission(h.journal, budget);
  const clone = vi.spyOn(globalThis, "structuredClone").mockImplementation(() => {
    throw new Error("cannot clone");
  });
  try {
    expect(() => admission.respond(params())).toThrow("cannot clone");
    expect(budget.pendingBytes).toBe(0);
    expect(budget.pendingEvents).toBe(0);
  } finally {
    clone.mockRestore();
  }
});
