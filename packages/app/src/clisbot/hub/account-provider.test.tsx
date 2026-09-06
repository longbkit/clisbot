// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubAccountProvider, useHubAccount } from "./account-provider";
import { hubClientAuthorizationContinuation } from "./account-entry-route";

const testState = vi.hoisted(() => ({
  url: "https://hub.example.test/settings/hub/account?invitation=invite&client_id=paseo-client&redirect_uri=paseo%3A%2F%2Fhub-auth%2Fcallback&state=pkce-state&code_challenge=challenge",
  request: vi.fn(),
  setParams: vi.fn(),
}));
vi.mock("expo-linking", () => ({ useURL: () => testState.url }));
vi.mock("expo-router", () => ({ useRouter: () => ({ setParams: testState.setParams }) }));
vi.mock("./config", () => ({
  getHubConfiguration: () => ({ origin: "https://hub.example.test" }),
}));
vi.mock("./transport/create", () => ({
  createHubTransport: () => ({ signInKind: "password", request: testState.request }),
}));
const account = { id: "member", name: "Member", email: "member@example.test" };
const invitation = {
  id: "invite",
  organization: { id: "new-org", name: "New organization" },
  inviterName: "Owner",
  role: "member",
  expiresAt: "2026-12-01T00:00:00Z",
};
function active(organizationId: string) {
  return {
    status: "active",
    account,
    memberships: [
      {
        id: organizationId,
        name: "Organization",
        slug: organizationId,
        membershipId: "membership",
        role: "member",
      },
    ],
    organization: { id: organizationId, name: "Organization", slug: organizationId },
    membership: { id: "membership", role: "member" },
    capabilities: { view: true, manageMembers: false, manageOwners: false, manageResources: false },
    isInstanceOperator: false,
    team: { members: [] },
    canCreateOrganization: false,
  };
}
const pendingInvitation = {
  status: "organizationRequired",
  account,
  memberships: [],
  canCreateOrganization: false,
  invitation,
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    ["clisbot", "hub", "https://hub.example.test", "account", null],
    active("previous-org"),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <HubAccountProvider>{children}</HubAccountProvider>
    </QueryClientProvider>
  );
  return { ...renderHook(() => useHubAccount(), { wrapper }), client };
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
});
afterEach(cleanup);

describe("invitation consumption", () => {
  it("consumes only a successful invitation and waits for fresh membership before OAuth resumes", async () => {
    let accepted = false;
    let finishAccountRead!: (response: Response) => void;
    testState.request.mockImplementation(async (path: string) => {
      if (path === "/api/auth/paseo/accept-invitation") {
        accepted = true;
        return Response.json({ accepted: true });
      }
      if (path.includes("?invitation="))
        return Response.json(
          accepted ? { ...active("new-org"), invitationUnavailable: true } : pendingInvitation,
        );
      return new Promise<Response>((resolve) => {
        finishAccountRead = resolve;
      });
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.state?.status).toBe("organizationRequired"));
    await act(() => result.current.acceptInvitation("invite"));
    expect(testState.setParams).toHaveBeenCalledExactlyOnceWith({ invitation: undefined });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.signedIn).toBeNull();
    await act(async () => finishAccountRead(Response.json(active("new-org"))));
    await waitFor(() => expect(result.current.signedIn?.organization.id).toBe("new-org"));
    const destination = hubClientAuthorizationContinuation({
      url: testState.url,
      origin: "https://hub.example.test",
      state: result.current.state,
    });
    expect(new URL(destination!).searchParams.get("state")).toBe("pkce-state");
    expect(new URL(destination!).searchParams.get("code_challenge")).toBe("challenge");
  });

  it("keeps invitation recovery context when acceptance fails", async () => {
    testState.request.mockImplementation(async (path: string) =>
      path === "/api/auth/paseo/accept-invitation"
        ? Response.json({ error: "unavailable" }, { status: 400 })
        : Response.json(pendingInvitation),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.state?.status).toBe("organizationRequired"));
    await act(async () => {
      await expect(result.current.acceptInvitation("invite")).rejects.toThrow();
    });
    expect(testState.setParams).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ invitation: { id: "invite" } });
    expect(result.current.error).toContain("400");
  });
});
