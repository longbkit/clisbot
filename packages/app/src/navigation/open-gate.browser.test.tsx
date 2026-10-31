import React, { act, useCallback, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pressable, Text } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from "expo-router/react-navigation";
import { createManualSchedule, createRetainingStack } from "@/test/retaining-stack";
import { OpenGate } from "./open-gate";

const Stack = createRetainingStack();

let screenRenders = 0;
let manual = createManualSchedule();

/** Stands in for the workspace screen: any render of it before the first frame is the bug. */
function SessionScreen() {
  screenRenders += 1;
  return <Text testID="session-body">session</Text>;
}

let gateEnabled = true;
const shell = <Text testID="session-shell">shell</Text>;

function WorkspaceRoute(): ReactNode {
  return (
    <OpenGate enabled={gateEnabled} shell={shell} schedule={manual.schedule}>
      <SessionScreen />
    </OpenGate>
  );
}

function WorkList() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const open = useCallback(() => navigation.navigate("workspace"), [navigation]);
  return (
    <Pressable testID="session-row" onPress={open}>
      <Text>Fix Android image upload</Text>
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
        <Stack.Navigator initialRouteName="tabs">
          <Stack.Screen name="tabs" component={WorkList} />
          <Stack.Screen name="workspace" component={WorkspaceRoute} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
  });
}

function find(testID: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testID}"]`);
}

function pressRow() {
  act(() => (find("session-row") as HTMLElement).click());
}

beforeEach(() => {
  screenRenders = 0;
  gateEnabled = true;
  manual = createManualSchedule();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("opening a session from a list row", () => {
  it("shows the shell in the press's own commit without rendering the session screen", () => {
    mount();
    pressRow();
    expect(find("session-shell")).not.toBeNull();
    expect(find("session-body")).toBeNull();
    expect(screenRenders).toBe(0);
    expect(manual.queued).toBe(1);
  });

  it("renders the session screen in the scheduled task and keeps it mounted", () => {
    mount();
    pressRow();
    act(() => manual.runAll());
    expect(find("session-shell")).toBeNull();
    expect(find("session-body")).not.toBeNull();
    expect(screenRenders).toBe(1);
    expect(manual.queued).toBe(0);
  });

  it("renders the session screen in the press's commit where the shell is off", () => {
    gateEnabled = false;
    mount();
    pressRow();
    expect(find("session-shell")).toBeNull();
    expect(find("session-body")).not.toBeNull();
    expect(manual.queued).toBe(0);
  });

  it("never renders the session screen when Back comes before its task", () => {
    mount();
    pressRow();
    act(() => navigation.goBack());
    expect(manual.queued).toBe(0);
    act(() => manual.runAll());
    expect(screenRenders).toBe(0);
  });
});
