import { expect, test } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { clientChatBusy } from "./readiness";
const chat = (kind: "direct" | "group", discussionActive?: boolean) =>
  ({
    kind,
    discussionActive,
    participants: [{ agentId: "a" }, { agentId: "b" }],
  }) as ChatPayload;
const idle = () => ({ known: true, active: false, permission: false });
test("actual old group missing discussion authority cannot treat between-speaker gap as idle", () => {
  expect(clientChatBusy(chat("group"), idle)).toBeNull();
  expect(clientChatBusy(chat("group", true), idle)).toBe(true);
  expect(clientChatBusy(chat("group", false), idle)).toBe(false);
});
test("old DM idle is known only after directory ownership; permission and unknown participant hold", () => {
  expect(clientChatBusy(chat("direct"), idle)).toBe(false);
  expect(clientChatBusy(chat("direct"), () => ({ ...idle(), known: false }))).toBeNull();
  expect(clientChatBusy(chat("direct"), () => ({ ...idle(), permission: true }))).toBe(true);
});
