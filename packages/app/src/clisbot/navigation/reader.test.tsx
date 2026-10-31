// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";

const hub = vi.hoisted(() => ({ accounts: [] as unknown[] }));
vi.mock("@/clisbot/hub/account-provider", () => ({ useHubAccounts: () => hub.accounts }));

const { useReaderMemory } = await import("@/clisbot/hub/reader-memory");
const { resolveOwnership } = await import("./ownership");
const { useReaderAccounts, useRememberVerifiedReaders } = await import("./reader");

const ORIGIN = "https://hub.example";
const account = (id: string | null) => ({
  origin: ORIGIN,
  connectionOrigin: ORIGIN,
  state: id ? { status: "active" } : { status: "signedOut" },
  signedIn: id ? { account: { id }, membership: { id: `m-${id}` } } : null,
});
const unreadable = { origin: ORIGIN, connectionOrigin: ORIGIN, state: null, signedIn: null };
const authoredBy = (id: string): SessionActor => ({ kind: "user", id, hubOrigin: ORIGIN });

/** What the Hub controller does around the account query. */
const controller = {
  signOut: (id: string) => useReaderMemory.getState().forget(ORIGIN, id),
  signedInAgain: () => useReaderMemory.getState().acknowledgeSignIn(ORIGIN),
};

function mount() {
  const view = renderHook(() => {
    useRememberVerifiedReaders();
    return useReaderAccounts();
  });
  const set = (...accounts: unknown[]) =>
    act(async () => {
      hub.accounts = accounts;
      view.rerender();
    });
  const ownerOf = (id: string) =>
    resolveOwnership({ hostKind: "hub", createdBy: authoredBy(id), accounts: view.result.current });
  return { ...view, set, ownerOf };
}

beforeEach(() => {
  useReaderMemory.setState({ readers: {}, signedOut: {} });
  hub.accounts = [];
});

describe("a reader after an explicit sign-out", () => {
  it("is gone at once, even while the account query still says signed in", async () => {
    const view = mount();
    await view.set(account("u-a"));
    expect(view.ownerOf("u-a")).toBe("mine");
    await act(async () => controller.signOut("u-a"));
    // The account data has not changed: a refetch is still in flight, or it failed.
    expect(view.result.current).toEqual([]);
    expect(view.ownerOf("u-a")).toBe("unknown");
    // A late answer arrives as a new object but says the same thing.
    await view.set(account("u-a"));
    expect(view.ownerOf("u-a")).toBe("unknown");
    await view.set(unreadable);
    expect(view.ownerOf("u-a")).toBe("unknown");
  });

  it("stays gone through a refresh that failed, with nothing else to confirm it", async () => {
    const view = mount();
    await view.set(account("u-a"));
    await act(async () => controller.signOut("u-a"));
    await view.set(unreadable);
    await view.set(account("u-a"));
    expect(view.result.current).toEqual([]);
  });
});

describe("signing in again after an explicit sign-out", () => {
  it("accepts another account without any signed-out answer in between", async () => {
    const view = mount();
    await view.set(account("u-a"));
    await act(async () => controller.signOut("u-a"));
    await view.set(unreadable);
    // The query goes straight from active A to active B.
    await view.set(account("u-b"));
    expect(view.ownerOf("u-b")).toBe("mine");
    expect(view.ownerOf("u-a")).toBe("others");
    expect(Object.keys(useReaderMemory.getState().readers)).toEqual([ORIGIN]);
    expect(useReaderMemory.getState().readers[ORIGIN]?.id).toBe("u-b");
  });

  it("accepts the same account once its sign-in is explicitly completed", async () => {
    const view = mount();
    await view.set(account("u-a"));
    await act(async () => controller.signOut("u-a"));
    await view.set(account("u-a"));
    expect(view.ownerOf("u-a")).toBe("unknown");
    await act(async () => controller.signedInAgain());
    expect(view.ownerOf("u-a")).toBe("mine");
    expect(useReaderMemory.getState().readers[ORIGIN]?.id).toBe("u-a");
  });

  it("accepts the same account after the Hub itself answered signed out", async () => {
    const view = mount();
    await view.set(account("u-a"));
    await act(async () => controller.signOut("u-a"));
    await view.set(account(null));
    await view.set(account("u-a"));
    expect(view.ownerOf("u-a")).toBe("mine");
  });
});
