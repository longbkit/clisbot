import { expect, test, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { resolveChatSendAction } from "./chat-send-action";

const fixture = vi.hoisted(() => ({ supported: false, rule: "steer" }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: { host: { serverInfo: { features: { hostInputQueue: fixture.supported } } } },
    }),
  },
  selectAgentTurnPresentation: () => ({ isActive: true, turnId: "turn" }),
}));
const chat = (whenBusy: "steer" | "queue"): ChatPayload =>
  ({
    participants: [{ agentId: "agent" }],
    rules: { interaction: { whenBusy } },
  }) as ChatPayload;

test("old Chat wire leaves ordinary sends to legacy Chat owner and never adds strict fields", () => {
  fixture.supported = false;
  expect(resolveChatSendAction({ serverId: "host", chat: chat("queue") })).toEqual({
    activeTurnBehavior: undefined,
    steerTarget: undefined,
  });
  expect(
    resolveChatSendAction({ serverId: "host", chat: chat("steer"), behavior: "steer" }),
  ).toEqual({ activeTurnBehavior: undefined, steerTarget: undefined });
  expect(() =>
    resolveChatSendAction({ serverId: "host", chat: chat("queue"), behavior: "steer" }),
  ).toThrow("Steer is unavailable");
});

test("capable Chat retains exact active target Steer", () => {
  fixture.supported = true;
  expect(
    resolveChatSendAction({ serverId: "host", chat: chat("queue"), behavior: "steer" }),
  ).toEqual({ activeTurnBehavior: "steer", steerTarget: { agentId: "agent", turnId: "turn" } });
});
