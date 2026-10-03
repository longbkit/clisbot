// @vitest-environment jsdom
import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HubAccountProvider, useHubAccount } from "@/clisbot/hub/account-provider";

const state = vi.hoisted(() => ({
  registry: {
    profiles: [] as { hubId: string; publicKey: string; label: string }[],
    activeId: null as string | null,
  },
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));
vi.mock("expo-linking", () => ({ useURL: () => null }));
vi.mock("expo-router", () => ({ useRouter: () => ({ setParams: vi.fn() }) }));
vi.mock("@/clisbot/hub/config", () => ({ getHubConfiguration: () => null }));
vi.mock("./hub-profiles", () => ({ useHubProfiles: () => state.registry }));
vi.mock("./hub-transport", () => ({
  PairedHubTransport: class {
    readonly signInKind = "password";
    close() {}
  },
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: () => ({ data: undefined, isPending: false, refetch: vi.fn() }),
}));
function Probe() {
  const hub = useHubAccount();
  useEffect(() => {
    state.mounted();
    return state.unmounted;
  }, []);
  return <div data-testid="hub">{hub.origin ?? "unconfigured"}</div>;
}
afterEach(cleanup);

test("pairing and selecting Hub profiles preserves the mounted app and navigation tree", () => {
  vi.stubGlobal("React", React);
  const client = new QueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <Probe />
      </HubAccountProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  expect(view.getByTestId("hub").textContent).toBe("unconfigured");
  for (const hubId of ["first", "second"]) {
    state.registry = { profiles: [{ hubId, publicKey: "key", label: hubId }], activeId: hubId };
    view.rerender(tree());
    expect(view.getByTestId("hub").textContent).toBe(`hub://${hubId}`);
  }
  state.registry = { profiles: [], activeId: null };
  view.rerender(tree());
  expect(view.getByTestId("hub").textContent).toBe("unconfigured");
  expect(state.mounted).toHaveBeenCalledTimes(1);
  expect(state.unmounted).not.toHaveBeenCalled();
});
