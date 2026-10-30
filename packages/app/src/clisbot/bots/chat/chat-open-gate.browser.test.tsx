import React, { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pressable, Text } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from "expo-router/react-navigation";
import { createManualSchedule, createRetainingStack } from "@/test/retaining-stack";
import { ChatOpenGate } from "./chat-open-gate";
import { forgetChatOpenPreviews, rememberChatOpenPreview } from "./open-preview";

const Stack = createRetainingStack();
const CHAT = { serverId: "host-1", chatId: "chat-1", title: "Design review" };

let bodyRenders = 0;
let manual = createManualSchedule();

/** Stands in for the chat route's content: any render of it in the press's commit is the bug. */
function ChatBody() {
  bodyRenders += 1;
  return <Text testID="chat-body">transcript</Text>;
}

interface ChatParams extends ParamListBase {
  chat: { serverId: string; chatId: string };
}
const back = <Text testID="chat-back">Back</Text>;

function ChatRoute({ route }: { route: RouteProp<ChatParams, "chat"> }) {
  return (
    <ChatOpenGate
      serverId={route.params.serverId}
      chatId={route.params.chatId}
      enabled
      navigation={back}
      schedule={manual.schedule}
    >
      <ChatBody />
    </ChatOpenGate>
  );
}

/** The Chats row: remembers what it showed, then pushes the chat, as `useBotSidebarActions` does. */
function ChatsList() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const open = useCallback(() => {
    rememberChatOpenPreview(CHAT);
    navigation.navigate("chat", { serverId: CHAT.serverId, chatId: CHAT.chatId });
  }, [navigation]);
  return (
    <Pressable testID="chat-row" onPress={open}>
      <Text>{CHAT.title}</Text>
    </Pressable>
  );
}

const navigation = createNavigationContainerRef<ParamListBase>();
let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root.render(
      <NavigationContainer ref={navigation}>
        <Stack.Navigator initialRouteName="chats">
          <Stack.Screen name="chats" component={ChatsList} />
          <Stack.Screen name="chat" component={ChatRoute} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
  });
}

function find(testID: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testID}"]`);
}

function pressRow() {
  act(() => (find("chat-row") as HTMLElement).click());
}

beforeEach(() => {
  bodyRenders = 0;
  manual = createManualSchedule();
  forgetChatOpenPreviews();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("opening a chat from a Chats row", () => {
  it("shows the chat's shell with the row's title in the press's own commit", () => {
    mount();
    pressRow();
    expect(find("chat-open-shell")?.textContent).toContain("Design review");
    expect(find("chat-body")).toBeNull();
    expect(bodyRenders).toBe(0);
    expect(manual.queued).toBe(1);
  });

  it("renders the chat in the scheduled task and keeps it", () => {
    mount();
    pressRow();
    act(() => manual.runAll());
    expect(find("chat-open-shell")).toBeNull();
    expect(find("chat-body")).not.toBeNull();
    expect(bodyRenders).toBe(1);
  });

  it("opens again in the press's commit after Back", () => {
    mount();
    pressRow();
    act(() => manual.runAll());
    act(() => navigation.goBack());
    bodyRenders = 0;
    pressRow();
    expect(find("chat-open-shell")?.textContent).toContain("Design review");
    expect(bodyRenders).toBe(0);
    act(() => manual.runAll());
    expect(find("chat-body")).not.toBeNull();
    expect(bodyRenders).toBe(1);
  });
});
