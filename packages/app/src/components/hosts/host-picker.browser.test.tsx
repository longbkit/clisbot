import React, { useRef } from "react";
import { Text, View } from "react-native";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { use as registerI18nextPlugin } from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/i18n/resources/en";
import { HostPicker } from "./host-picker";

beforeAll(async () => {
  await registerI18nextPlugin(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  const { StyleSheet } = await import("react-native");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function"
          ? (styles as (theme: typeof lightTheme) => T)(lightTheme)
          : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    UnistylesRuntime: { breakpoint: window.innerWidth < 500 ? "xs" : "lg" },
    useUnistyles: () => ({
      theme: lightTheme,
      rt: { breakpoint: window.innerWidth < 500 ? "xs" : "lg" },
    }),
  };
});
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeSnapshot: () => null,
  useHostRuntimeConnectionStatus: () => "online",
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useLocalDaemonServerId: () => null }));
vi.mock("@/clisbot/hub/settings/hosts-settings-label", () => ({
  HostsConnectionCount: () => null,
}));

const MANY_HOSTS = Array.from({ length: 15 }, (_, index) => ({
  serverId: `host-${index + 1}`,
  label: `Host ${index + 1}`,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hostOptionTestID = (serverId: string) => `picker-host-${serverId}`;

function Picker({ onAddHost }: { onAddHost: () => void }) {
  const anchorRef = useRef<View | null>(null);
  return (
    <HostPicker
      hosts={MANY_HOSTS}
      value="host-1"
      onSelect={vi.fn()}
      open
      onOpenChange={vi.fn()}
      anchorRef={anchorRef}
      includeAllHost
      includeAddHost
      onAddHost={onAddHost}
      searchable
      addHostTestID="picker-add-host"
      hostOptionTestID={hostOptionTestID}
    >
      <View ref={anchorRef}>
        <Text>trigger</Text>
      </View>
    </HostPicker>
  );
}

function scrollContainerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  throw new Error("The Host rows are not inside a scrolling list");
}

// The phone sheet does not present in this harness; the Playwright Host picker spec covers it.
it("keeps Add host outside the scrolling Host list, once, even with many Hosts", async () => {
  vi.stubGlobal("React", React);
  await page.viewport(1200, 600);
  const onAddHost = vi.fn();
  render(<Picker onAddHost={onAddHost} />);

  const lastHost = await screen.findByTestId("picker-host-host-15");
  const list = scrollContainerOf(lastHost);
  const addHost = screen.getByTestId("picker-add-host");
  expect(screen.getAllByText("Add host")).toHaveLength(1);
  expect(list.contains(addHost)).toBe(false);
  const listBox = list.getBoundingClientRect();
  expect(addHost.getBoundingClientRect().top).toBeGreaterThanOrEqual(listBox.bottom);
  expect(addHost.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);

  await userEvent.click(addHost);
  expect(onAddHost).toHaveBeenCalledTimes(1);
});
