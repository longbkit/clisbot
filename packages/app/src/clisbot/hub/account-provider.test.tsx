// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubAccountProvider, useHubAccount } from "./account-provider";
import { HubAccountRequestError } from "@/device-access/hub-account-error";
import { hubClientAuthorizationContinuation } from "./account-entry-route";

const testState = vi.hoisted(() => ({
  url: "https://hub.example.test/settings/hub/account?invitation=invite&client_id=clisbot-client&redirect_uri=clisbot%3A%2F%2Fhub-auth%2Fcallback&state=pkce-state&code_challenge=challenge",
  request: vi.fn(),
  setParams: vi.fn(),
  configured: true,
  google: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("expo-linking", () => ({ useURL: () => testState.url }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: testState.setParams }),
}));
vi.mock("./config", () => ({
  getHubConfiguration: () => (testState.configured ? { origin: "https://hub.example.test" } : null),
}));
vi.mock("./transport/create", () => ({
  createHubTransport: () => ({
    signInKind: "password",
    request: testState.request,
    signInWithGoogle: testState.google,
  }),
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
    organization: {
      id: organizationId,
      name: "Organization",
      slug: organizationId,
    },
    membership: { id: "membership", role: "member" },
    capabilities: {
      view: true,
      manageMembers: false,
      manageOwners: false,
      manageResources: false,
    },
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  testState.configured = true;
  testState.google = undefined;
});
afterEach(cleanup);

it("daemon-only clients do not advertise Hub sign-in or start disabled account requests", async () => {
  testState.configured = false;
  const { result } = setup();
  await act(async () => Promise.resolve());
  expect(result.current.enabled).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(result.current.signedIn).toBeNull();
  expect(testState.request).not.toHaveBeenCalled();
});

describe("invitation consumption", () => {
  it("consumes only a successful invitation and waits for fresh membership before OAuth resumes", async () => {
    let accepted = false;
    let finishAccountRead!: (response: Response) => void;
    testState.request.mockImplementation(async (path: string) => {
      if (path === "/api/auth/clisbot/accept-invitation") {
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
    expect(testState.setParams).toHaveBeenCalledExactlyOnceWith({
      invitation: undefined,
    });
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
      path === "/api/auth/clisbot/accept-invitation"
        ? Response.json({ error: "unavailable" }, { status: 400 })
        : Response.json(pendingInvitation),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.state?.status).toBe("organizationRequired"));
    await act(async () => {
      await expect(result.current.acceptInvitation("invite")).rejects.toThrow();
    });
    expect(testState.setParams).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      invitation: { id: "invite" },
    });
    expect(result.current.error).toContain("400");
  });
});

describe("email self-registration", () => {
  const signedOut = {
    status: "signedOut",
    registration: "domain_self_registration",
    googleSignIn: true,
    emailSelfRegistration: true,
  };

  it("asks the Hub for a sign-up link and reports each outcome", async () => {
    const statuses = [202, 403, 429, 503];
    testState.request.mockImplementation(async (path: string) =>
      path === "/api/auth/clisbot/registration/start"
        ? Response.json({}, { status: statuses.shift() ?? 500 })
        : Response.json(signedOut),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.state?.status).toBe("signedOut"));
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      outcomes.push(await result.current.startRegistration("ada@acme.test"));
    }
    expect(outcomes).toEqual(["sent", "domainNotAllowed", "rateLimited", "unavailable"]);
    expect(result.current.state).toMatchObject({ googleSignIn: true });
  });
});

it("an unavailable owner approval preserves pairing while reporting approved setup recovery", async () => {
  testState.request.mockImplementation(async (path: string) =>
    path === "/api/auth/clisbot/claim-instance"
      ? Response.json({ error: "owner_setup_approval_required" }, { status: 403 })
      : Response.json({ status: "instanceSetupRequired" }),
  );
  const { result } = setup();
  await waitFor(() => expect(result.current.state?.status).toBe("instanceSetupRequired"));
  await act(async () => {
    await expect(
      result.current.claimInstance({
        email: "owner@example.test",
        password: "long enough password",
      }),
    ).rejects.toThrow("new setup QR or link");
  });
  expect(result.current.state?.status).toBe("instanceSetupRequired");
  expect(result.current.error).toContain("approval is unavailable");
});

it("owner setup claimed elsewhere refreshes into ordinary account sign-in instead of retaining the create-owner form", async () => {
  let claimed = false;
  testState.request.mockImplementation(async (path: string) => {
    if (path === "/api/auth/clisbot/claim-instance") {
      claimed = true;
      return Response.json({ state: "unavailable" });
    }
    return Response.json(
      claimed
        ? { status: "signedOut", registration: "invite_only" }
        : { status: "instanceSetupRequired" },
    );
  });
  const { result } = setup();
  await waitFor(() => expect(result.current.state?.status).toBe("instanceSetupRequired"));
  await act(async () => {
    await expect(
      result.current.claimInstance({
        email: "owner@example.test",
        password: "long enough password",
      }),
    ).rejects.toThrow("sign in with an approved account");
  });
  await waitFor(() => expect(result.current.state?.status).toBe("signedOut"));
});

it("Google owner setup claimed elsewhere uses the same account-entry recovery", async () => {
  let claimed = false;
  testState.google = async () => {
    claimed = true;
    throw new HubAccountRequestError("owner_setup_unavailable", 409);
  };
  testState.request.mockImplementation(async () =>
    Response.json(
      claimed
        ? { status: "signedOut", registration: "invite_only" }
        : { status: "instanceSetupRequired", googleSignIn: true },
    ),
  );
  const { result } = setup();
  await waitFor(() => expect(result.current.state?.status).toBe("instanceSetupRequired"));
  await act(async () => {
    await expect(result.current.signInWithGoogle?.({ claimInstance: true })).rejects.toThrow(
      "sign in with an approved account",
    );
  });
  await waitFor(() => expect(result.current.state?.status).toBe("signedOut"));
});
