// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { HostReadinessCard } from "./host-readiness";

const state = vi.hoisted(() => ({
  status: "error" as string,
  local: false,
  push: vi.fn(),
  removeHost: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
}));
vi.mock("@/contexts/toast-api-context", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeConnectionStatus: () => state.status,
  useHostRuntimeLastError: () => "Device credential unavailable; pair this Host again",
  useHostMutations: () => ({ removeHost: state.removeHost }),
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useIsLocalDaemon: () => state.local }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: state.confirm }));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: [], isLoading: false }),
}));

beforeEach(() => i18n.changeLanguage("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.status = "error";
  state.local = false;
});

test("a Host that cannot connect shows its ID and can be removed after confirming", async () => {
  render(<HostReadinessCard serverId="srv_old" label="My Mac" />);
  expect(screen.getByText("ID srv_old")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(state.push).toHaveBeenCalledWith("/settings/hosts/srv_old");

  fireEvent.click(screen.getByRole("button", { name: "Remove host" }));
  await waitFor(() => expect(state.removeHost).toHaveBeenCalledWith("srv_old"));
  expect(state.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ destructive: true, message: expect.stringContaining("My Mac") }),
  );
});

test("declining the confirmation keeps the Host", async () => {
  state.confirm.mockResolvedValueOnce(false);
  render(<HostReadinessCard serverId="srv_old" label="My Mac" />);
  fireEvent.click(screen.getByRole("button", { name: "Remove host" }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(state.removeHost).not.toHaveBeenCalled();
});

test("the desktop's own daemon is removed from its page, not from Home", () => {
  state.local = true;
  render(<HostReadinessCard serverId="srv_local" label="This Mac" />);
  expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove host" })).toBeNull();
});

test("a connected Host shows no recovery actions", () => {
  state.status = "online";
  render(<HostReadinessCard serverId="srv_new" label="My Mac" />);
  expect(screen.queryByText("ID srv_new")).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove host" })).toBeNull();
});
