// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedHostRow } from "./managed-host-row";
import { hubResourceQueryKey } from "../query-keys";

const adapters = vi.hoisted(() => ({
  remove: vi.fn(),
  rename: vi.fn(),
  confirm: vi.fn(),
  canManage: true,
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.test",
    signedIn: {
      account: { id: "owner" },
      organization: { id: "org" },
      capabilities: { manageResources: adapters.canManage },
    },
    api: () => ({ delete: adapters.remove, put: adapters.rename }),
  }),
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: adapters.confirm }));
vi.mock("./rename-host-dialog", () => ({
  RenameHostDialog: ({
    onSave,
    onClose,
  }: {
    onSave(name: string): Promise<void>;
    onClose(): void;
  }) => (
    <div role="dialog" aria-label="Rename Host">
      <button
        onClick={() => {
          void onSave("Shared Name").then(onClose);
        }}
      >
        Save renamed Host
      </button>
      <button onClick={onClose}>Cancel rename</button>
    </div>
  ),
}));
const daemon = {
  id: "daemon-1",
  slug: "Workstation",
  status: "active" as const,
  presence: "connected" as const,
  connectedAt: null,
  lastSeenAt: "2026-09-05T00:00:00Z",
  canManage: true,
  connectionOffer: null,
  managedAccessMode: "off" as const,
};
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("React", React);
  client = new QueryClient();
  adapters.canManage = true;
  adapters.remove.mockReset();
  adapters.rename.mockReset();
  adapters.confirm.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
function renderRow(rowDaemon: React.ComponentProps<typeof ManagedHostRow>["daemon"] = daemon) {
  return render(
    <QueryClientProvider client={client}>
      <ManagedHostRow daemon={rowDaemon} bordered={false} />
    </QueryClientProvider>,
  );
}

it.each(["offline", "connected", "future_presence"] as const)(
  "explains a %s enrolled Host with no connection details in Configuration",
  (presence) => {
    renderRow({ ...daemon, presence });
    expect(screen.getByText(`${presence} · Administrator`)).toBeDefined();
    expect(screen.getByText(/then refresh Hosts\./u)).toBeDefined();
    expect(screen.queryByText("Registering")).toBeNull();
    expect(adapters.remove).not.toHaveBeenCalled();
  },
);

it("requires confirmation and keeps a canceled disconnect actionable", async () => {
  adapters.confirm.mockResolvedValue(false);
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Disconnect" }).hasAttribute("disabled")).toBe(false),
  );
  expect(adapters.remove).not.toHaveBeenCalled();
});

it("retains a failed disconnect for retry and never replays a successful removal", async () => {
  adapters.confirm.mockResolvedValue(true);
  adapters.remove
    .mockRejectedValueOnce(new Error("Host disconnect failed"))
    .mockResolvedValueOnce(undefined);
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect((await screen.findByText("Host disconnect failed")).textContent).toBe(
    "Host disconnect failed",
  );
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  const done = await screen.findByRole("button", { name: "Disconnected" });
  expect(done.hasAttribute("disabled")).toBe(true);
  fireEvent.click(done);
  expect(adapters.remove).toHaveBeenCalledTimes(2);
  expect(adapters.remove).toHaveBeenLastCalledWith("daemons/daemon-1");
});

it("does not offer enrollment management to a Member with only daemon access", () => {
  adapters.canManage = false;
  renderRow();
  expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
});

it("does not disconnect after leaving the account while confirmation is open", async () => {
  let confirm!: (value: boolean) => void;
  adapters.confirm.mockReturnValue(
    new Promise<boolean>((resolve) => {
      confirm = resolve;
    }),
  );
  const view = renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
  view.unmount();
  confirm(true);
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(adapters.remove).not.toHaveBeenCalled();
});

it("offers shared name management using Hub authority even without daemon administration", () => {
  renderRow({ ...daemon, canManage: false });
  expect(screen.getByRole("button", { name: "Rename" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
});

it("renames the shared Host and refreshes only its account-scoped projections", async () => {
  const key = hubResourceQueryKey(
    { origin: "https://hub.test", organizationId: "org", accountId: "owner" },
    "daemons",
  );
  client.setQueryData(key, { daemons: [daemon] });
  adapters.rename.mockResolvedValue({ id: daemon.id, slug: "shared-name" });
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
  expect(adapters.rename).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.click(screen.getByRole("button", { name: "Save renamed Host" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(adapters.rename).toHaveBeenCalledWith(
    "daemons/daemon-1",
    { slug: "Shared Name" },
    expect.anything(),
  );
  expect(client.getQueryData(key)).toEqual({ daemons: [{ ...daemon, slug: "shared-name" }] });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
