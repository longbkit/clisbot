import { expect, test, vi } from "vitest";
import { CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { StoredAgentRecord } from "../../agent/agent-storage.js";
import { routeChatSpokenInput } from "./spoken-input.js";
function storage(labels: Record<string, string>) {
  return { get: async () => ({ labels }) as StoredAgentRecord };
}
test("ordinary agents retain the existing direct spoken path", async () => {
  const session = { sendSpokenInput: vi.fn() };
  expect(await routeChatSpokenInput(storage({}), session, "agent", "Hello")).toBe(false);
  expect(session.sendSpokenInput).not.toHaveBeenCalled();
});
test("bound voice routes exactly once and denied/disabled Chat never falls back", async () => {
  const bound = storage({ [CHAT_ID_LABEL]: "chat" });
  const sendSpokenInput = vi.fn(async () => {});
  expect(await routeChatSpokenInput(bound, { sendSpokenInput }, "agent", "Hello")).toBe(true);
  expect(sendSpokenInput).toHaveBeenCalledExactlyOnceWith("chat", "agent", "Hello");
  sendSpokenInput.mockRejectedValueOnce(new Error("denied"));
  await expect(routeChatSpokenInput(bound, { sendSpokenInput }, "agent", "Hello")).rejects.toThrow(
    "denied",
  );
  await expect(routeChatSpokenInput(bound, null, "agent", "Hello")).rejects.toThrow("unavailable");
});
