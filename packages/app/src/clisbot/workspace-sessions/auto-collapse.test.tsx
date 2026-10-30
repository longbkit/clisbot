// @vitest-environment jsdom
import React, { memo } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("expo-router", () => {
  const params = {};
  return { useLocalSearchParams: () => params };
});
vi.mock("@/clisbot/home/use-chat-list-departure", () => ({ useIsChatListDeparting: () => false }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const { WorkspaceSessionsAutoCollapseProvider, useIsSidebarOnWorkspaceRoute } =
  await import("./auto-collapse");
const { RouteSourceProvider } = await import("@/navigation/route-source");
const { createTestRouteSource } = await import("@/test/route-source");

/** The router's current path; every navigation publishes a new one. */
let route = createTestRouteSource();

afterEach(() => {
  cleanup();
  route = createTestRouteSource();
});

const renders = { list: 0 };
const seen: boolean[] = [];

/** Stands in for the Work list below the provider: it reads the route flag, nothing else. */
const List = memo(function List() {
  renders.list += 1;
  seen.push(useIsSidebarOnWorkspaceRoute());
  return null;
});

it("re-renders the list only when the workspace route flag changes, not on every navigation", () => {
  render(
    <RouteSourceProvider source={route.source}>
      <WorkspaceSessionsAutoCollapseProvider>
        <List />
      </WorkspaceSessionsAutoCollapseProvider>
    </RouteSourceProvider>,
  );
  renders.list = 0;
  seen.length = 0;
  act(() => route.navigate("/chat"));
  act(() => route.navigate("/work"));
  act(() => route.navigate("/settings/hosts"));
  expect(renders.list).toBe(0);
  act(() => route.navigate("/h/srv/workspace/ws-1"));
  act(() => route.navigate("/h/srv/workspace/ws-2"));
  expect(seen).toEqual([true]);
  act(() => route.navigate("/work"));
  expect(seen).toEqual([true, false]);
});
