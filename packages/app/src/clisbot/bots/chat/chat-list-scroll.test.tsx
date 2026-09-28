// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FlatListProps, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
const state = vi.hoisted(() => ({
  props: {} as FlatListProps<unknown>,
  scroll: vi.fn(),
  drag: vi.fn(),
  dismiss: { onScroll: vi.fn(), onScrollBeginDrag: vi.fn(), onScrollEndDrag: vi.fn() },
}));
vi.mock("react-native", () => ({
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
vi.mock("./chat-rows", () => ({
  ChatBotRow: "div",
  ChatSystemRow: "div",
  ChatUserRow: "div",
  botIdentity: vi.fn(),
}));
import { ChatList } from "./chat-list";
afterEach(cleanup);
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
