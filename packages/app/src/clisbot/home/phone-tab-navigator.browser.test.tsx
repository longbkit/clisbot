import React, {
  act,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pressable, Text, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type ParamListBase,
} from "expo-router/react-navigation";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHeldWhileInactive } from "@/hooks/use-held-while-inactive";
import {
  createPhoneTabNavigator,
  type PhoneTabBarProps,
  type ScheduleIdle,
} from "./phone-tab-navigator";

const TAB_NAMES = ["home", "chats", "work"] as const;
type TabName = (typeof TAB_NAMES)[number];

/** One fake Host store every tab reads; `publish` is one Host update. */
const store = {
  value: 0,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  publish() {
    store.value += 1;
    for (const notify of store.listeners) notify();
  },
};

let log: string[] = [];
/** What each press's commit showed, recorded by the tab bar's layout effect. */
let pressCommits: PressCommit[] = [];
interface PressCommit {
  shown: string[];
  bodyRenders: Record<string, number>;
}
let mounts: Record<string, number> = {};
let unmounts: Record<string, number> = {};
let bodyRenders: Record<string, number> = {};

/** The production shape: an owner subscribes and holds its input while hidden; a memo body renders. */
const Body = memo(function Body({ name, value }: { name: TabName; value: number }) {
  bodyRenders[name] = (bodyRenders[name] ?? 0) + 1;
  const active = useRetainedPanelActive();
  log.push(`${name}:${active ? "active" : "hidden"}`);
  return <Text testID={`body-${name}`}>{`${name}:${value}`}</Text>;
});

function makeScreen(name: TabName) {
  return function TabScreen() {
    const active = useRetainedPanelActive();
    const value = useHeldWhileInactive(
      useSyncExternalStore(store.subscribe, () => store.value),
      active,
    );
    useEffect(() => {
      mounts[name] = (mounts[name] ?? 0) + 1;
      return () => {
        unmounts[name] = (unmounts[name] ?? 0) + 1;
      };
    }, []);
    return <Body name={name} value={value} />;
  };
}
const screens = Object.fromEntries(TAB_NAMES.map((name) => [name, makeScreen(name)]));

function TabBar({ state, navigation }: PhoneTabBarProps) {
  useLayoutEffect(() => {
    pressCommits.push({
      shown: TAB_NAMES.filter((name) => shown(name)),
      bodyRenders: { ...bodyRenders },
    });
  }, [state.index]);
  return (
    <View>
      {state.routes.map((route, index) => (
        <TabButton
          key={route.key}
          name={route.name}
          selected={state.index === index}
          navigate={navigation.navigate}
        />
      ))}
    </View>
  );
}

function TabButton(props: { name: string; selected: boolean; navigate: (name: string) => void }) {
  const { name, selected, navigate } = props;
  const select = useCallback(() => navigate(name), [name, navigate]);
  return (
    <Pressable testID={`tab-${name}`} aria-selected={selected} onPress={select}>
      <Text>{name}</Text>
    </Pressable>
  );
}

function renderTabBar(props: PhoneTabBarProps) {
  return <TabBar {...props} />;
}

const Tabs = createPhoneTabNavigator();
const navigation = createNavigationContainerRef<ParamListBase>();
let container: HTMLDivElement;

/** Idle slots the test runs by hand; nothing runs until it does. */
function createManualIdle() {
  const queued = new Set<() => void>();
  const schedule: ScheduleIdle = (run) => {
    queued.add(run);
    return () => queued.delete(run);
  };
  return {
    schedule,
    get queued() {
      return queued.size;
    },
    runNext: () => {
      const [run] = queued;
      if (!run) throw new Error("no idle slot queued");
      queued.delete(run);
      act(() => run());
    },
  };
}
let idle = createManualIdle();
let root: Root;

function mountTabs() {
  act(() => {
    root.render(
      <NavigationContainer ref={navigation}>
        <Tabs.Navigator tabBar={renderTabBar} scheduleIdle={idle.schedule}>
          {TAB_NAMES.map((name) => (
            <Tabs.Screen key={name} name={name} component={screens[name]!} />
          ))}
        </Tabs.Navigator>
      </NavigationContainer>,
    );
  });
}

function press(name: TabName) {
  const tab = container.querySelector(`[data-testid="tab-${name}"]`) as HTMLElement;
  act(() => tab.click());
}

function shown(name: TabName): boolean {
  const body = container.querySelector(`[data-testid="body-${name}"]`) as HTMLElement | null;
  return body !== null && body.checkVisibility();
}

beforeEach(() => {
  log = [];
  mounts = {};
  unmounts = {};
  bodyRenders = {};
  pressCommits = [];
  idle = createManualIdle();
  store.value = 0;
  container = document.createElement("div");
  container.style.height = "600px";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("phone tab navigator", () => {
  it("mounts a tab on its first visit and never unmounts a visited tab", () => {
    mountTabs();
    expect(mounts).toEqual({ home: 1 });
    press("chats");
    press("work");
    press("home");
    press("chats");
    press("work");
    expect(mounts).toEqual({ home: 1, chats: 1, work: 1 });
    expect(unmounts).toEqual({});
  });

  it("shows the target in the press's commit as it last rendered, then activates it", () => {
    mountTabs();
    press("chats");
    press("home");
    act(() => store.publish());
    log = [];
    pressCommits = [];
    const before = bodyRenders.chats;
    // No timers, frames or settlement: the press's own commit shows the target.
    press("chats");
    // That commit shows the target without rendering its body.
    expect(pressCommits[0]?.shown).toEqual(["chats"]);
    expect(pressCommits[0]?.bodyRenders.chats).toBe(before);
    // The deferred render after it activates the target with the latest value.
    expect(shown("chats")).toBe(true);
    expect(shown("home")).toBe(false);
    expect(log).toEqual(["home:hidden", "chats:active"]);
    expect(container.querySelector('[data-testid="body-chats"]')?.textContent).toBe("chats:1");
    expect(
      container.querySelector('[data-testid="tab-chats"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("pre-mounts the unvisited tabs hidden, one per idle slot, after the first paint", () => {
    mountTabs();
    expect(mounts).toEqual({ home: 1 });
    idle.runNext();
    expect(mounts).toEqual({ home: 1, chats: 1 });
    idle.runNext();
    expect(mounts).toEqual({ home: 1, chats: 1, work: 1 });
    expect(idle.queued).toBe(0);
    expect(shown("home")).toBe(true);
    expect(shown("chats")).toBe(false);
    expect(shown("work")).toBe(false);
    expect(log).toEqual(["home:active", "chats:hidden", "work:hidden"]);
  });

  it("makes a pre-mounted tab's first visit a visibility flip, not a mount", () => {
    mountTabs();
    idle.runNext();
    idle.runNext();
    pressCommits = [];
    press("work");
    expect(mounts).toEqual({ home: 1, chats: 1, work: 1 });
    expect(pressCommits[0]?.shown).toEqual(["work"]);
    expect(pressCommits[0]?.bodyRenders.work).toBe(1);
    expect(shown("work")).toBe(true);
    expect(log.at(-1)).toBe("work:active");
  });

  it("stops pre-mounting once every tab has been visited", () => {
    mountTabs();
    press("chats");
    press("work");
    expect(idle.queued).toBe(0);
  });

  it("renders hidden tabs zero times on store updates and refreshes them when shown", () => {
    mountTabs();
    press("chats");
    press("work");
    bodyRenders = {};
    act(() => store.publish());
    act(() => store.publish());
    expect(bodyRenders).toEqual({ work: 2 });
    press("home");
    expect(container.querySelector('[data-testid="body-home"]')?.textContent).toBe("home:2");
  });

  it("keeps a hidden tab's own state across switches", () => {
    mountTabs();
    press("chats");
    const before = container.querySelector('[data-testid="body-chats"]');
    press("home");
    press("chats");
    expect(container.querySelector('[data-testid="body-chats"]')).toBe(before);
  });
});
