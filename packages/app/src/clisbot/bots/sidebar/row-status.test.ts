import { expect, it } from "vitest";
import type { Agent, SessionState } from "@/stores/session-store";
import { selectChatStatusBucket } from "./row-status";
function source(changes: Partial<Agent>[] = []) {
  return {
    agents: new Map(
      changes.map((change, i) => [
        String(i),
        {
          status: "idle",
          turn: { phase: "idle" },
          pendingPermissions: [],
          requiresAttention: false,
          ...change,
        } as Agent,
      ]),
    ),
    messageSubmissions: new Map(),
  } as SessionState;
}
it("DM and group badges share session permission/error/running/unread precedence", () => {
  const s = source([
    {
      status: "running",
      turn: { phase: "open", turnId: "turn", startedAt: new Date(), cancellationRequestId: null },
    },
    { status: "error" },
    { pendingPermissions: [{ id: "approval", provider: "mock", name: "Approval", kind: "tool" }] },
    { requiresAttention: true, attentionReason: "finished" },
  ]);
  expect(selectChatStatusBucket(s, ["0"])).toBe("running");
  expect(selectChatStatusBucket(s, ["0", "1", "2", "3"])).toBe("needs_input");
  expect(selectChatStatusBucket(s, ["0", "1", "3"])).toBe("failed");
  expect(selectChatStatusBucket(s, ["3"])).toBe("attention");
  expect(selectChatStatusBucket(undefined, ["missing"])).toBe("done");
});
