// @vitest-environment jsdom
// "Connect to a channel…" in the two menus that list a Bot's own actions: the sidebar row's and
// the open DM's Chat options. Both open Channels on that Bot.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { useSidebarPinMenu } from "../sidebar/use-section-actions";
import type { BotPayload } from "../data/contracts";
import { useChatResourceMenu } from "./use-chat-options-actions";

const env = vi.hoisted(() => ({
  canConnect: vi.fn((serverId: string) => serverId === "server-mac"),
  openConnect: vi.fn(),
  push: vi.fn(),
  onBeforeNavigate: vi.fn(),
}));
vi.mock("./use-connect-channel", () => ({
  useCanConnectBotToChannel: () => env.canConnect,
  useOpenConnectBotToChannel: () => env.openConnect,
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("../data/runtime", () => ({ refreshBotsAndChatsNow: vi.fn() }));
vi.mock("./use-archive-chat", () => ({ useArchiveChat: () => vi.fn() }));
vi.mock("../sidebar/pins", () => ({
  useResourcePins: () => ({ pins: [], toggle: vi.fn(), isPinned: () => false }),
}));

beforeEach(() => {
  env.canConnect.mockClear();
  env.openConnect.mockReset();
  env.push.mockReset();
  env.onBeforeNavigate.mockReset();
});

const anchor = { x: 0, y: 0, width: 10, height: 10 };

describe("sidebar Bot row menu", () => {
  function openBotMenu(serverId: string) {
    const { result } = renderHook(() => useSidebarPinMenu(env.onBeforeNavigate));
    act(() =>
      result.current.onBotMenu({ serverId, botId: "bot_luna", canConfigure: true }, anchor),
    );
    return result;
  }

  it("offers Connect to a channel… and opens Channels on the Bot", () => {
    const menu = openBotMenu("server-mac");
    expect(menu.current.actions.map((action) => action.id)).toEqual([
      "pin",
      "bot-settings",
      "connect-channel",
    ]);
    act(() => menu.current.selectAction("connect-channel"));
    expect(env.onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(env.openConnect).toHaveBeenCalledWith("server-mac", "bot_luna");
    expect(menu.current.menu).toBeNull();
  });

  it("leaves it out when the Bot cannot run on a Route there", () => {
    const menu = openBotMenu("server-laptop");
    expect(menu.current.actions.map((action) => action.id)).toEqual(["pin", "bot-settings"]);
  });
});

describe("Chat options of a DM", () => {
  const bot = { id: "bot_luna", canConfigure: false } as BotPayload;
  function chat(kind: "direct" | "group"): ChatPayload {
    return {
      id: "chat-1",
      kind,
      participants: [{ botId: "bot_luna" }],
    } as unknown as ChatPayload;
  }
  function menu(serverId: string, group: boolean) {
    const close = vi.fn();
    const { result } = renderHook(() =>
      useChatResourceMenu({
        serverId,
        chat: chat(group ? "group" : "direct"),
        bots: [bot],
        group,
        close,
        openGroupSettings: vi.fn(),
        archive: vi.fn(async () => undefined),
      }),
    );
    return { result, close };
  }

  it("offers Connect to a channel… for the DM's Bot and opens Channels on it", () => {
    const { result, close } = menu("server-mac", false);
    expect(result.current.actions.map((action) => action.id)).toEqual([
      "pin",
      "connect-channel",
      "archive",
    ]);
    act(() => result.current.runAction("connect-channel"));
    expect(close).toHaveBeenCalledTimes(1);
    expect(env.openConnect).toHaveBeenCalledWith("server-mac", "bot_luna");
  });

  it("does not offer it in a group or on a Host the Hub cannot route to", () => {
    expect(menu("server-mac", true).result.current.actions.map((a) => a.id)).not.toContain(
      "connect-channel",
    );
    expect(menu("server-laptop", false).result.current.actions.map((a) => a.id)).not.toContain(
      "connect-channel",
    );
  });
});
