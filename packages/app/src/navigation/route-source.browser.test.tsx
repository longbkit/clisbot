import React, { act, memo, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Text, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useIsFocused,
  type NavigationState,
  type ParamListBase,
  type PartialState,
  type RouteProp,
} from "expo-router/react-navigation";
import { createPhoneTabNavigator, type PhoneTabBarProps } from "@/clisbot/home/phone-tab-navigator";
import { ChatOpenGate } from "@/clisbot/bots/chat/chat-open-gate";
import { createManualSchedule, createRetainingStack } from "@/test/retaining-stack";
import { createTestRouteSource } from "@/test/route-source";
import { RouteSourceProvider, useRoutePath } from "./route-source";
import { useFocusedChatKey, useIsOnWorkspaceRoute } from "./route-facts";

/**
 * The phone's shape: a root stack holding the retained tabs, with a chat and a session pushed
 * on top. The route source publishes from the container's state change, as Expo Router's store
 * does, so route readers update in their own commit after the push.
 */
const HOME_ROWS = 40;
let renders: Record<string, number> = {};
let pushCommits: PushCommit[] = [];
interface PushCommit {
  route: string;
  shellShown: boolean;
  renders: Record<string, number>;
}

function count(name: string) {
  renders[name] = (renders[name] ?? 0) + 1;
}

/** Publishes from the container's state change, as Expo Router's store does. */
function createContainerRouteSource() {
  const { source, navigate } = createTestRouteSource("/open-project");
  return {
    source,
    publish(state: NavigationState | PartialState<NavigationState> | undefined) {
      navigate(pathnameOf(state));
    },
  };
}

function pathnameOf(state: NavigationState | PartialState<NavigationState> | undefined): string {
  const focused = state?.routes[state.index ?? 0];
  if (!focused) return "/";
  if (focused.name === "chat-route") return "/h/host-1/chat/chat-1";
  if (focused.name === "session-route") return "/h/host-1/workspace/ws-1";
  const tabs = focused.state;
  const tab = tabs?.routes[tabs.index ?? 0]?.name ?? "open-project";
  return `/${tab}`;
}

const HomeRow = memo(function HomeRow({ index }: { index: number }) {
  count("homeRow");
  return <Text>{`row ${index}`}</Text>;
});

const ROW_INDEXES = Array.from({ length: HOME_ROWS }, (_, index) => index);

// Each tab route renders memoized content, as the production tab routes do.
const HomeBody = memo(function HomeBody() {
  count("homeBody");
  return (
    <View>
      {ROW_INDEXES.map((index) => (
        <HomeRow key={index} index={index} />
      ))}
    </View>
  );
});

/** Chats marks the open chat's row: it reads the open chat's key, not the pathname. */
const ChatsBody = memo(function ChatsBody() {
  count("chatsBody");
  const open = useFocusedChatKey();
  return <ChatsRow open={open === "host-1:chat-1"} />;
});

const ChatsRow = memo(function ChatsRow({ open }: { open: boolean }) {
  count("chatsRow");
  return (
    <Text testID="chats-row" aria-selected={open}>
      chat-1
    </Text>
  );
});

/** Work collapses sessions off a workspace route: it reads that one fact. */
const WorkBody = memo(function WorkBody() {
  count("workBody");
  const onWorkspace = useIsOnWorkspaceRoute();
  return <Text testID="work-body">{onWorkspace ? "workspace" : "list"}</Text>;
});

function HomeTab() {
  return <HomeBody />;
}
function ChatsTab() {
  return <ChatsBody />;
}
function WorkTab() {
  return <WorkBody />;
}

function TabBar({ state }: PhoneTabBarProps) {
  count("tabBar");
  return <Text>{state.routes[state.index]!.name}</Text>;
}

function renderTabBar(props: PhoneTabBarProps) {
  return <TabBar {...props} />;
}

const Tabs = createPhoneTabNavigator();
const noIdle = () => () => undefined;

/**
 * The `(tabs)` layout. A push blurs it and a pop focuses it again; something in it that reads
 * focus (the breakpoint remount does) re-renders the navigator on both.
 */
function TabsScreen() {
  useIsFocused();
  return (
    <Tabs.Navigator tabBar={renderTabBar} scheduleIdle={noIdle}>
      <Tabs.Screen name="open-project" component={HomeTab} />
      <Tabs.Screen name="chat" component={ChatsTab} />
      <Tabs.Screen name="work" component={WorkTab} />
    </Tabs.Navigator>
  );
}

let manual = createManualSchedule();
const back = <Text>Back</Text>;

function ChatScreen({ route }: { route: RouteProp<ParamListBase, "chat-route"> }) {
  const params = route.params as { serverId: string; chatId: string };
  useLayoutEffect(() => {
    pushCommits.push({
      route: "chat",
      shellShown: find("chat-open-shell") !== null,
      renders: { ...renders },
    });
  }, []);
  return (
    <ChatOpenGate
      serverId={params.serverId}
      chatId={params.chatId}
      enabled
      navigation={back}
      schedule={manual.schedule}
    >
      <Text testID="chat-body">transcript</Text>
    </ChatOpenGate>
  );
}

function SessionScreen() {
  return <Text testID="session-body">session</Text>;
}

const Stack = createRetainingStack();
const navigation = createNavigationContainerRef<ParamListBase>();
let routes = createContainerRouteSource();
let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root.render(
      <RouteSourceProvider source={routes.source}>
        <NavigationContainer ref={navigation} onStateChange={routes.publish}>
          <Stack.Navigator initialRouteName="(tabs)">
            <Stack.Screen name="(tabs)" component={TabsScreen} />
            <Stack.Screen name="chat-route" component={ChatScreen} />
            <Stack.Screen name="session-route" component={SessionScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </RouteSourceProvider>,
    );
  });
  // Visit every tab, as the idle pre-mount does once startup settles, and come back to Chats.
  for (const tab of ["chat", "work", "chat"]) act(() => navigation.navigate(tab));
}

function find(testID: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testID}"]`);
}

function pushChat() {
  act(() => navigation.navigate("chat-route", { serverId: "host-1", chatId: "chat-1" }));
}

beforeEach(() => {
  renders = {};
  pushCommits = [];
  manual = createManualSchedule();
  routes = createContainerRouteSource();
  container = document.createElement("div");
  container.style.height = "600px";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("route reads across a push and a pop above the phone tabs", () => {
  it("renders no Home row, hidden tab body or tab bar when a chat is pushed and popped", () => {
    mount();
    renders = {};
    pushChat();
    act(() => manual.runAll());
    act(() => navigation.goBack());
    // Only the Chats row whose selection really changed renders, once for open and once for closed.
    expect(renders).toEqual({ chatsBody: 2, chatsRow: 2 });
  });

  it("renders nothing under the tabs when a session is pushed, except what reads that fact", () => {
    mount();
    renders = {};
    act(() => navigation.navigate("session-route"));
    act(() => navigation.goBack());
    expect(renders).toEqual({ workBody: 2 });
  });

  it("puts the chat shell in the push's commit, before any tab renders", () => {
    mount();
    renders = {};
    pushChat();
    expect(pushCommits).toEqual([{ route: "chat", shellShown: true, renders: {} }]);
    expect(find("chat-body")).toBeNull();
  });

  it("re-renders a pathname reader on every navigation, which a selected fact avoids", () => {
    let pathReads = 0;
    function PathReader() {
      pathReads += 1;
      useRoutePath(identity);
      return null;
    }
    act(() => {
      root.render(
        <RouteSourceProvider source={routes.source}>
          <PathReader />
        </RouteSourceProvider>,
      );
    });
    pathReads = 0;
    act(() => routes.publish(tabsState("work")));
    act(() => routes.publish(tabsState("chat")));
    expect(pathReads).toBe(2);
  });
});

function identity(pathname: string) {
  return pathname;
}

function tabsState(tab: string): PartialState<NavigationState> {
  return {
    index: 0,
    routes: [{ name: "(tabs)", state: { index: 0, routes: [{ name: tab }] } }],
  };
}
