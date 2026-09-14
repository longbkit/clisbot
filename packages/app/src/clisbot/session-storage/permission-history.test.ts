import { describe, expect, it } from "vitest";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import {
  mergePermissionHistory,
  permissionActivityLabel,
  permissionBelongsToTool,
} from "./permission-history";
const pending: AgentPermissionResponseRecord = {
  id: "response-a",
  timestamp: "2026-09-11T00:00:00Z",
  status: "pending",
  toolCallId: "tool-a",
  respondedBy: { kind: "user", id: "original", displayName: "Original name" },
  request: { id: "provider-request", provider: "codex", name: "shell", kind: "tool" },
  response: { behavior: "allow" },
};
describe("permission history snapshots", () => {
  it("does not regress live applied status when an older fetched pending record arrives", () => {
    const applied = { ...pending, status: "applied" as const };
    expect(mergePermissionHistory([applied], [pending])).toEqual([applied]);
    expect(mergePermissionHistory([pending], [applied, pending])).toEqual([applied]);
    expect(permissionActivityLabel(applied)).toBe("Allowed");
  });
  it("keeps failed decisions terminal and separate attempts independent", () => {
    const failed = { ...pending, status: "failed" as const, error: "Request replaced" };
    const later = {
      ...pending,
      id: "response-b",
      timestamp: "2026-09-11T00:00:01Z",
      response: { behavior: "deny" as const },
    };
    const result = mergePermissionHistory([failed], [pending, later]);
    expect(result).toEqual([later, failed]);
    expect(result[1].respondedBy).toEqual(pending.respondedBy);
    expect(permissionActivityLabel(failed)).toBe("Permission response failed");
  });
});

it("requires exact epoch and source ownership when a tool ID is reused", () => {
  const record: AgentPermissionResponseRecord = {
    id: "response",
    timestamp: "2026-09-12",
    status: "applied",
    toolCallId: "reused",
    toolCallCursor: { epoch: "old", seq: 2 },
    request: { id: "request", provider: "codex", name: "shell", kind: "tool" },
    response: { behavior: "allow" },
  };
  expect(
    permissionBelongsToTool(record, "reused", {
      epoch: "old",
      sourceSeqRanges: [
        { startSeq: 2, endSeq: 2 },
        { startSeq: 100, endSeq: 100 },
      ],
    }),
  ).toBe(true);
  expect(
    permissionBelongsToTool(record, "reused", {
      epoch: "new",
      sourceSeqRanges: [{ startSeq: 2, endSeq: 2 }],
    }),
  ).toBe(false);
  expect(
    permissionBelongsToTool(record, "reused", {
      epoch: "old",
      sourceSeqRanges: [
        { startSeq: 1, endSeq: 1 },
        { startSeq: 100, endSeq: 100 },
      ],
    }),
  ).toBe(false);
  expect(permissionBelongsToTool(record, "reused", { epoch: "old", sourceSeqRanges: [] })).toBe(
    false,
  );
  expect(
    permissionBelongsToTool({ ...record, toolCallCursor: undefined }, "reused", {
      epoch: "old",
      sourceSeqRanges: [{ startSeq: 2, endSeq: 2 }],
    }),
  ).toBe(false);
});
