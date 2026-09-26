import { describe, expect, it } from "vitest";
import { buildHostBotRoute, buildHostChatRoute, parseChatRouteFromPathname } from "./routes";

describe("bots routes", () => {
  it("encodes ids like the other host leaves", () => {
    expect(buildHostChatRoute("host-a", "chat 1/x")).toBe("/h/host-a/chat/chat%201%2Fx");
    expect(buildHostBotRoute("host a", "bot-1")).toBe("/h/host%20a/bot/bot-1");
  });

  it("falls back to the root when an id is missing", () => {
    expect(buildHostChatRoute("", "chat-1")).toBe("/");
    expect(buildHostChatRoute("host-a", "  ")).toBe("/");
    expect(buildHostBotRoute("host-a", "")).toBe("/");
  });

  it("round-trips a chat route through the parser", () => {
    const route = buildHostChatRoute("host a", "chat 1/x");
    expect(parseChatRouteFromPathname(route)).toEqual({ serverId: "host a", chatId: "chat 1/x" });
    expect(parseChatRouteFromPathname(`${route}?open=1#top`)).toEqual({
      serverId: "host a",
      chatId: "chat 1/x",
    });
  });

  it("ignores other host leaves", () => {
    expect(parseChatRouteFromPathname("/h/host-a/bot/bot-1")).toBeNull();
    expect(parseChatRouteFromPathname("/h/host-a/workspace/ws-1")).toBeNull();
    expect(parseChatRouteFromPathname("/h/host-a/chat/")).toBeNull();
    expect(parseChatRouteFromPathname(null)).toBeNull();
  });
});
