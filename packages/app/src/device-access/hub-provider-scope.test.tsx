// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HubAccountProvider, useHubAccount } from "@/clisbot/hub/account-provider";

const state = vi.hoisted(() => ({
  registry: {
    profiles: [{ hubId: "home", publicKey: "home-key", label: "Home" }],
    activeId: "home" as string | null,
  },
  request: vi.fn(),
  close: vi.fn(),
  trace: [] as { origin: string | null; account: string | null; manage: boolean }[],
}));
vi.mock("expo-linking", () => ({ useURL: () => null }));
vi.mock("expo-router", () => ({ useRouter: () => ({ setParams: vi.fn() }) }));
vi.mock("@/clisbot/hub/config", () => ({ getHubConfiguration: () => null }));
vi.mock("./hub-profiles", () => ({ useHubProfiles: () => state.registry }));
vi.mock("./hub-transport", () => ({
  PairedHubTransport: class {
    readonly signInKind = "password";
    constructor(private profile: { hubId: string }) {}
    request(path: string) {
      return state.request(this.profile.hubId, path);
    }
    close() {
      state.close(this.profile.hubId);
    }
  },
}));

function active(hubId: string, owner: boolean) {
  return {
    status: "active",
    account: { id: `${hubId}-account`, name: hubId, email: `${hubId}@example.test` },
    memberships: [],
    organization: { id: `${hubId}-org`, name: hubId, slug: hubId },
    membership: { id: `${hubId}-membership`, role: owner ? "owner" : "member" },
    capabilities: {
      view: true,
      manageMembers: owner,
      manageOwners: owner,
      manageResources: owner,
    },
    isInstanceOperator: owner,
    team: { members: [] },
    canCreateOrganization: false,
  };
}
function Probe() {
  const hub = useHubAccount();
  const value = {
    origin: hub.origin,
    account: hub.signedIn?.account.id ?? null,
    manage: hub.connection?.canManageDevices ?? false,
  };
  state.trace.push(value);
  return <div data-testid="scope">{JSON.stringify(value)}</div>;
}
afterEach(cleanup);

test("a late owner response from the previous Hub cannot appear under the newly selected Hub", async () => {
  vi.stubGlobal("React", React);
  let finishHome!: (response: Response) => void;
  state.trace = [];
  state.request.mockImplementation((hubId: string, path: string) => {
    if (path.endsWith("/capabilities"))
      return Promise.resolve(
        Response.json({
          hubId,
          paired: true,
          loginRequired: true,
          accountAuthentication: "signedIn",
          canManageDevices: hubId === "home",
          canConfigureLogin: hubId === "home",
        }),
      );
    return hubId === "home"
      ? new Promise<Response>((resolve) => (finishHome = resolve))
      : Promise.resolve(Response.json(active("work", false)));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <Probe />
      </HubAccountProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith("home", "/api/auth/clisbot/state"),
  );
  state.registry = {
    profiles: [...state.registry.profiles, { hubId: "work", publicKey: "work-key", label: "Work" }],
    activeId: "work",
  };
  view.rerender(tree());
  await waitFor(() => expect(view.getByTestId("scope").textContent).toContain("work-account"));
  await act(async () => finishHome(Response.json(active("home", true))));
  await waitFor(() =>
    expect(client.getQueryData(["clisbot", "hub", "hub://home", "account", null])).toMatchObject({
      status: "active",
    }),
  );
  expect(view.getByTestId("scope").textContent).toContain("work-account");
  expect(state.trace.filter((value) => value.origin === "hub://work")).not.toContainEqual(
    expect.objectContaining({ account: "home-account" }),
  );
  expect(
    state.trace.filter((value) => value.origin === "hub://work").every((value) => !value.manage),
  ).toBe(true);
  expect(state.close).toHaveBeenCalledWith("home");
});
