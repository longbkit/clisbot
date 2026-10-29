// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubAccountProvider, useHubAccount } from "./account-provider";
import { HubAccountRequestError } from "@/device-access/hub-account-error";
import { hubClientAuthorizationContinuation } from "./account-entry-route";
import { useReaderMemory } from "./reader-memory";
import { useReaderAccounts, useRememberVerifiedReaders } from "@/clisbot/navigation/reader";

const INVITATION_URL =
  "https://hub.example.test/settings/hub/account?invitation=invite&client_id=clisbot-client&redirect_uri=clisbot%3A%2F%2Fhub-auth%2Fcallback&state=pkce-state&code_challenge=challenge";
const testState = vi.hoisted(() => ({
  url: "",
  request: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  clearOffline: vi.fn(async (_origin: string) => undefined),
  sessionChanged: undefined as (() => void) | undefined,
  setParams: vi.fn(),
  configured: true,
  google: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("expo-linking", () => ({ useURL: () => testState.url }));
vi.mock("@/clisbot/offline-storage/hub", () => ({
  clearHubOfflineData: (origin: string) => testState.clearOffline(origin),
}));
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
    signIn: (...input: unknown[]) => testState.signIn(...input),
    signOut: () => testState.signOut(),
    subscribeSessionChange: (listener: () => void) => {
      testState.sessionChanged = listener;
      return () => {
        testState.sessionChanged = undefined;
      };
    },
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
  testState.url = INVITATION_URL;
  testState.configured = true;
  testState.google = undefined;
  testState.sessionChanged = undefined;
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

/**
 * The real controller, a real QueryClient and a faked transport: what a sign-out does to the
 * reader the app remembers (hub/reader-memory.ts), driven only by the controller's own actions.
 */
describe("the reader across an explicit sign-out", () => {
  const ORIGIN = "https://hub.example.test";
  const STATE_PATH = "/api/auth/clisbot/state";
  const as = (id: string) => ({
    ...active("org"),
    account: { ...account, id },
    membership: { id: `m-${id}`, role: "member" },
  });
  const server = {
    answer: () => Promise.resolve(Response.json(as("a"))) as Promise<Response>,
    readerA: () => Promise.resolve(Response.json(as("a"))) as Promise<Response>,
  };
  const failing = () => Promise.resolve(Response.json({ error: "down" }, { status: 503 }));
  const memory = () => useReaderMemory.getState();
  const deferred = () => {
    let release!: (response: Response) => void;
    const promise = new Promise<Response>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  async function signedInAsA() {
    testState.url = "https://hub.example.test/settings/hub/account";
    server.answer = server.readerA;
    testState.request.mockImplementation(async (path: string) =>
      path === STATE_PATH ? server.answer() : Response.json({}),
    );
    testState.signOut.mockResolvedValue(undefined);
    testState.signIn.mockResolvedValue(undefined);
    useReaderMemory.setState({ readers: {}, signedOut: {}, signOutGeneration: {} });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(
      () => {
        useRememberVerifiedReaders();
        return { hub: useHubAccount(), readers: useReaderAccounts() };
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <HubAccountProvider>{children}</HubAccountProvider>
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(view.result.current.readers.map((r) => r.id)).toEqual(["a"]));
    return view;
  }
  const readerIds = (view: Awaited<ReturnType<typeof signedInAsA>>) =>
    view.result.current.readers.map((reader) => reader.id);

  async function signedOutWhileRefreshFails() {
    const view = await signedInAsA();
    server.answer = failing;
    await act(() => view.result.current.hub.signOut());
    return view;
  }

  it("clears what this Hub's Hosts left on the device when signing out", async () => {
    testState.clearOffline.mockClear();
    await signedOutWhileRefreshFails();
    expect(testState.clearOffline).toHaveBeenCalledWith(ORIGIN);
  });

  it("keeps the sign-out when the refresh after it fails and the query still holds the account", async () => {
    const view = await signedOutWhileRefreshFails();
    expect(view.result.current.hub.signedIn?.account.id).toBe("a");
    expect(memory().signedOut[ORIGIN]).toEqual({ accountId: "a" });
    expect(readerIds(view)).toEqual([]);
  });

  it("opens it when the same account signs in again and the Hub answers with it", async () => {
    const view = await signedOutWhileRefreshFails();
    server.answer = server.readerA;
    await act(() => view.result.current.hub.signIn({ email: "a@x.test", password: "secret" }));
    await waitFor(() => expect(memory().signedOut[ORIGIN]).toBeUndefined());
    await waitFor(() => expect(readerIds(view)).toEqual(["a"]));
  });

  it("keeps it when the sign-in fails", async () => {
    const view = await signedOutWhileRefreshFails();
    testState.signIn.mockRejectedValue(new Error("wrong password"));
    await act(async () => {
      await expect(
        view.result.current.hub.signIn({ email: "a@x.test", password: "nope" }),
      ).rejects.toThrow("wrong password");
    });
    expect(memory().signedOut[ORIGIN]).toBeDefined();
    expect(readerIds(view)).toEqual([]);
  });

  it("keeps it when the sign-in succeeds but the account cannot be read afterwards", async () => {
    const view = await signedOutWhileRefreshFails();
    server.answer = failing;
    await act(() => view.result.current.hub.signIn({ email: "a@x.test", password: "secret" }));
    expect(memory().signedOut[ORIGIN]).toBeDefined();
    expect(readerIds(view)).toEqual([]);
  });

  it("is not reopened by a session-change read that began before the sign-out", async () => {
    const view = await signedInAsA();
    const early = deferred();
    server.answer = () => early.promise;
    await act(async () => testState.sessionChanged?.());
    server.answer = failing;
    await act(() => view.result.current.hub.signOut());
    // The read that began before the sign-out now answers, still with the account.
    await act(async () => early.release(Response.json(as("a"))));
    expect(memory().signedOut[ORIGIN]).toBeDefined();
    expect(readerIds(view)).toEqual([]);
  });

  it("is not reopened by an action that began before the sign-out and ends after it", async () => {
    const view = await signedInAsA();
    const slow = deferred();
    testState.request.mockImplementation(async (path: string) =>
      path === "/api/auth/change-password" ? slow.promise : server.answer(),
    );
    let finished!: Promise<unknown>;
    await act(async () => {
      finished = view.result.current.hub.changePassword({ currentPassword: "a", newPassword: "b" });
    });
    server.answer = failing;
    await act(() => view.result.current.hub.signOut());
    // The Hub still reports the account when the old action reads it back.
    server.answer = server.readerA;
    await act(async () => {
      slow.release(Response.json({}));
      await finished;
    });
    expect(memory().signedOut[ORIGIN]).toBeDefined();
    expect(readerIds(view)).toEqual([]);
  });

  it("is not reopened by an unrelated action whose read-back fails", async () => {
    const view = await signedOutWhileRefreshFails();
    await act(() =>
      view.result.current.hub.changePassword({ currentPassword: "a", newPassword: "b" }),
    );
    expect(memory().signedOut[ORIGIN]).toBeDefined();
    expect(readerIds(view)).toEqual([]);
  });

  it("is opened by a completed self-registration that the Hub then confirms", async () => {
    const view = await signedOutWhileRefreshFails();
    server.answer = server.readerA;
    testState.request.mockImplementation(async (path: string) =>
      path === "/api/auth/clisbot/registration/complete"
        ? Response.json({ status: "registered" })
        : server.answer(),
    );
    await act(() =>
      view.result.current.hub.completeRegistration({ token: "t", name: "A", password: "secret" }),
    );
    await waitFor(() => expect(memory().signedOut[ORIGIN]).toBeUndefined());
    await waitFor(() => expect(readerIds(view)).toEqual(["a"]));
  });
});
