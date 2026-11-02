import { describe, expect, it } from "vitest";
import { classifyDeliveryError, HostUnreachableError } from "./model";
import { mergeChatOutboxLines } from "./chat-lines";
import type { OutboxEntry } from "./model";

describe("classifyDeliveryError", () => {
  it.each([
    new Error("agent_request_key_conflict"),
    new Error("Message m1 already exists with different text or attachments"),
    new Error("Message attachment retry conflicts with the accepted files"),
    Object.assign(new Error("held"), { code: "already_accepted" }),
  ])("treats an id the Host already holds as sent: %s", (error) => {
    expect(classifyDeliveryError(error, "unreachable")).toEqual({ kind: "sent" });
  });

  it.each([
    new HostUnreachableError(),
    Object.assign(new Error("lost"), { name: "DaemonConnectionError" }),
    Object.assign(new Error("timeout"), { code: "DAEMON_REQUEST_TIMEOUT" }),
  ])("waits for the Host when the outcome is unknown: %s", (error) => {
    expect(classifyDeliveryError(error, "Host unreachable")).toEqual({
      kind: "failed",
      failure: { reason: "host_unreachable", message: "Host unreachable", autoRetry: true },
    });
  });

  it("leaves a refusal for the user to retry", () => {
    expect(classifyDeliveryError(new Error("Agent archived"), "x")).toEqual({
      kind: "failed",
      failure: { reason: "refused", message: "Agent archived", autoRetry: false },
    });
  });
});

function chatEntry(id: string, createdAt: number): OutboxEntry {
  return {
    clientMessageId: id,
    target: { kind: "chat", serverId: "s", chatId: "c" },
    text: `text ${id}`,
    attachments: [],
    createdAt,
    status: "sending",
  };
}

describe("mergeChatOutboxLines", () => {
  const line = {
    id: "l1",
    seq: 7,
    at: "2026-11-02T00:00:00.000Z",
    sender: { kind: "user" as const },
    text: "old",
  };

  it("appends unsent lines after the transcript in send order", () => {
    const merged = mergeChatOutboxLines([line], [chatEntry("b", 2), chatEntry("a", 1)]);
    expect(merged.map((item) => [item.id, item.seq])).toEqual([
      ["l1", 7],
      ["a", 8],
      ["b", 9],
    ]);
  });

  it("drops a local line once the transcript has a line with its id", () => {
    const merged = mergeChatOutboxLines([line, { ...line, id: "a", seq: 8 }], [chatEntry("a", 1)]);
    expect(merged.map((item) => item.id)).toEqual(["l1", "a"]);
  });
});
