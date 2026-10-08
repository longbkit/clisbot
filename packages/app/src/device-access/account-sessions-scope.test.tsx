// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { AccountSessions } from "./account-sessions";

// The assertions read the English copy.
beforeEach(() => i18n.changeLanguage("en"));

const fixture = vi.hoisted(() => ({
  hub: {
    origin: "hub://a",
    state: { status: "organizationRequired", account: { id: "person" } },
    signOut: vi.fn(),
  },
  registry: { activeId: "a", profiles: [{ hubId: "a" }, { hubId: "b" }] },
  request: vi.fn<(hubId: string, path: string, input?: { method?: string }) => Promise<Response>>(),
  confirm: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccount: () => fixture.hub,
}));
vi.mock("./hub-profiles", () => ({ useHubProfiles: () => fixture.registry }));
vi.mock("./hub-transport", () => ({
  PairedHubTransport: class {
    constructor(private profile: { hubId: string }) {}
    request(path: string, input?: { method?: string }) {
      return fixture.request(this.profile.hubId, path, input);
    }
    close() {}
  },
}));
vi.mock("@/clisbot/hub/transport/create", () => ({
  createHubTransport: () => null,
}));
vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: () => fixture.confirm(),
}));
vi.mock("@/components/settings", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("./hub-ui", () => ({
  HubLaptopIcon: () => null,
  hubMutedIconProps: {},
  HubStatusBadge: () => null,
  HubContextNote: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function response(label: string): Response {
  return {
    ok: true,
    json: async () => ({
      currentSessionId: "current",
      sessions: [
        {
          id: label,
          label,
          createdAt: 1,
          updatedAt: 2,
          expiresAt: 999999,
          isCurrent: false,
        },
      ],
    }),
  } as Response;
}
function selectSecondHub() {
  fixture.hub.origin = "hub://b";
  fixture.registry.activeId = "b";
}
beforeEach(() => {
  fixture.hub.origin = "hub://a";
  fixture.hub.state.account.id = "person";
  fixture.registry.activeId = "a";
  fixture.request.mockReset();
  fixture.confirm.mockReset();
  fixture.hub.signOut.mockReset();
});
afterEach(cleanup);

it("does not display a late old-Hub refresh in the newly selected Hub", async () => {
  const old = deferred<Response>();
  fixture.request.mockImplementation(async (hubId) =>
    hubId === "a" ? old.promise : response("Work device"),
  );
  const ui = render(<AccountSessions />);
  selectSecondHub();
  ui.rerender(<AccountSessions />);
  await waitFor(() => expect(screen.getByText("Work device")).toBeTruthy());
  await act(async () => {
    old.resolve(response("Personal device"));
    await old.promise;
  });
  expect(screen.queryByText("Personal device")).toBeNull();
  expect(screen.getByText("Work device")).toBeTruthy();
});

it("does not publish an old-Hub failure after changing Hub", async () => {
  const old = deferred<Response>();
  fixture.request.mockImplementation(async (hubId) =>
    hubId === "a" ? old.promise : response("Work device"),
  );
  const ui = render(<AccountSessions />);
  selectSecondHub();
  ui.rerender(<AccountSessions />);
  await waitFor(() => expect(screen.getByText("Work device")).toBeTruthy());
  await act(async () => {
    old.reject(new Error("Old Hub failure"));
    await old.promise.catch(() => undefined);
  });
  expect(screen.queryByText("Old Hub failure")).toBeNull();
});

it("does not execute a session-revoke confirmation that outlives its Hub scope", async () => {
  const confirmation = deferred<boolean>();
  fixture.confirm.mockReturnValue(confirmation.promise);
  fixture.request.mockImplementation(async (hubId) =>
    response(hubId === "a" ? "Personal device" : "Work device"),
  );
  const ui = render(<AccountSessions />);
  await waitFor(() => expect(screen.getByText("Personal device")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  selectSecondHub();
  ui.rerender(<AccountSessions />);
  await waitFor(() => expect(screen.getByText("Work device")).toBeTruthy());
  await act(async () => {
    confirmation.resolve(true);
    await confirmation.promise;
  });
  expect(fixture.request.mock.calls.some(([, , input]) => input?.method === "DELETE")).toBe(false);
  expect(fixture.hub.signOut).not.toHaveBeenCalled();
});

it("clears another account's sessions on the same Hub before new data arrives", async () => {
  const next = deferred<Response>();
  fixture.request.mockImplementation(async () =>
    fixture.hub.state.account.id === "person" ? response("First account device") : next.promise,
  );
  const ui = render(<AccountSessions />);
  await waitFor(() => expect(screen.getByText("First account device")).toBeTruthy());
  fixture.hub.state.account.id = "different-person";
  ui.rerender(<AccountSessions />);
  expect(screen.queryByText("First account device")).toBeNull();
  await act(async () => {
    next.resolve(response("Second account device"));
    await next.promise;
  });
  expect(screen.getByText("Second account device")).toBeTruthy();
});
