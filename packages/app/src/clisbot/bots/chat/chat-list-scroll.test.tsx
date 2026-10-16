// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlatListProps, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { ChatRenderRow } from "./render-model";
const state = vi.hoisted(() => ({
  platform: { OS: "web" },
  props: {} as FlatListProps<unknown>,
  scroll: vi.fn(),
  drag: vi.fn(),
  dismiss: { onScroll: vi.fn(), onScrollBeginDrag: vi.fn(), onScrollEndDrag: vi.fn() },
}));
vi.mock("react-native", () => ({
  Platform: state.platform,
  FlatList: (props: FlatListProps<unknown>) => {
    state.props = props;
    return null;
  },
  View: "div",
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/constants/layout", () => ({ MAX_CONTENT_WIDTH: 820 }));
vi.mock("./use-chat-scroll-position", () => ({
  useChatScrollPosition: () => ({ onScroll: state.scroll, onScrollBeginDrag: state.drag }),
}));
vi.mock("./use-chat-keyboard-dismiss", () => ({ useChatKeyboardDismiss: () => state.dismiss }));
vi.mock("./bot-workspace-context", () => ({ BotWorkspaceContext: "div" }));
vi.mock("./chat-live-row", () => ({ ChatLiveRow: "div" }));
vi.mock("@/clisbot/heartbeats/use-chat-turn-heartbeats", () => ({
  useChatTurnHeartbeats: () => new Map(),
}));
vi.mock("./chat-rows", () => ({
  ChatBotRow: "div",
  ChatSystemRow: "div",
  ChatUserRow: "div",
  botIdentity: vi.fn(),
}));
import { ChatList } from "./chat-list";
afterEach(cleanup);
it.each(["android", "ios", "web"])("keeps the existing list and data owner on %s", (platform) => {
  state.platform.OS = platform;
  const rows: ChatRenderRow[] = [
    {
      kind: "live",
      key: "live",
      botId: "bot",
      agentId: "agent",
      items: [],
      permissions: [],
      inProgress: true,
      opensGroup: true,
    },
  ];
  // Row construction/viewport filling is exercised separately against installed
  // VirtualizedList; this assertion only protects the platform and owner wiring.
  render(<ChatList rows={rows} bots={new Map()} serverId="host" />);
  expect(state.props.initialNumToRender).toBe(platform === "web" ? undefined : 2);
  expect(state.props.maxToRenderPerBatch).toBe(platform === "web" ? undefined : 2);
  expect(state.props.data?.[0]).toBe(rows[0]);
  expect(state.props.inverted).toBe(true);
  expect(state.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  state.platform.OS = "web";
});
it("forwards native scroll lifecycle to keyboard dismissal without losing reading-position tracking", () => {
  render(<ChatList rows={[]} bots={new Map()} serverId="host" />);
  const event = {
    nativeEvent: { contentOffset: { y: 100 } },
  } as NativeSyntheticEvent<NativeScrollEvent>;
  state.props.onScrollBeginDrag?.(event);
  state.props.onScroll?.(event);
  state.props.onScrollEndDrag?.(event);
  expect(state.drag).toHaveBeenCalledOnce();
  expect(state.scroll).toHaveBeenCalledWith(event);
  expect(state.dismiss.onScrollBeginDrag).toHaveBeenCalledWith(event);
  expect(state.dismiss.onScroll).toHaveBeenCalledWith(event);
  expect(state.dismiss.onScrollEndDrag).toHaveBeenCalledWith(event);
  expect(state.props.scrollEventThrottle).toBe(16);
});
