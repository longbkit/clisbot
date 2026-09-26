// @vitest-environment jsdom
import React, { useCallback } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HostChooserModal, useHostChooser } from "./host-chooser";
import type { HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "./appearance";

const adapters = vi.hoisted(() => ({
  hosts: [] as HostProfile[],
  status: "loading",
  error: null as string | null,
  retry: vi.fn(),
  choose: vi.fn(),
  noHosts: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/clisbot/hub/host-inventory", () => ({ useHostInventory: () => adapters }));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useLocalDaemonServerId: () => null }));
vi.mock("expo-router", () => ({ router: { push: adapters.push } }));
vi.mock("@/components/hosts/host-picker", () => ({ HostStatusDotSlot: () => null }));
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: () => <input aria-label="Search hosts" />,
}));
vi.mock("@/lib/overlay-root", () => ({
  OverlayLayerProvider: ({ children }: { children: React.ReactNode }) => children,
  useGlobalWebOverlayLayer: () => 1,
  useWebOverlayRegistration: () => undefined,
}));

function host(serverId: string, label: string): HostProfile {
  return {
    serverId,
    label,
    connections: [],
    preferredConnectionId: null,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "",
    updatedAt: "",
  };
}
const manual = host("manual", "Personal Host");
const managed = host("managed", "Hub Host");

function Chooser() {
  const choose = useHostChooser();
  const open = useCallback(
    () => choose({ onChooseHost: adapters.choose, onNoHosts: adapters.noHosts }),
    [choose],
  );
  return (
    <>
      <button type="button" onClick={open}>
        Choose Host
      </button>
      <HostChooserModal />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  adapters.hosts = [];
  adapters.status = "loading";
  adapters.error = null;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("waits for the full inventory instead of automatically choosing the one direct Host", () => {
  adapters.hosts = [manual];
  const view = render(<Chooser />);
  fireEvent.click(screen.getByText("Choose Host"));
  expect(screen.getByText("Loading Hosts...")).toBeDefined();
  expect(adapters.choose).not.toHaveBeenCalled();
  expect(adapters.noHosts).not.toHaveBeenCalled();
  adapters.status = "ready";
  adapters.hosts = [manual, managed];
  view.rerender(<Chooser />);
  expect(screen.queryByText("Loading Hosts...")).toBeNull();
  fireEvent.click(screen.getByText("Hub Host"));
  expect(adapters.choose).toHaveBeenCalledExactlyOnceWith("managed");
});

it("shows retry on a failed inventory and adds newly authorized Hosts after recovery", () => {
  adapters.status = "error";
  adapters.error = "Hub offline";
  const view = render(<Chooser />);
  fireEvent.click(screen.getByText("Choose Host"));
  expect(adapters.noHosts).not.toHaveBeenCalled();
  expect(adapters.push).not.toHaveBeenCalled();
  expect(screen.getByText("Hosts unavailable: Hub offline")).toBeDefined();
  fireEvent.click(screen.getByText("Retry"));
  expect(adapters.retry).toHaveBeenCalledOnce();
  adapters.status = "ready";
  adapters.error = null;
  adapters.hosts = [managed];
  view.rerender(<Chooser />);
  fireEvent.click(screen.getByText("Hub Host"));
  expect(adapters.choose).toHaveBeenCalledExactlyOnceWith("managed");
});

it("offers Add Host only after loading confirms an empty inventory", () => {
  const view = render(<Chooser />);
  fireEvent.click(screen.getByText("Choose Host"));
  expect(screen.queryByText("Add Host")).toBeNull();
  expect(adapters.noHosts).not.toHaveBeenCalled();
  adapters.status = "ready";
  view.rerender(<Chooser />);
  fireEvent.click(screen.getByText("Add Host"));
  expect(adapters.noHosts).toHaveBeenCalledOnce();
});

it("still automatically chooses a sole Host after the inventory is ready", () => {
  adapters.status = "ready";
  adapters.hosts = [manual];
  render(<Chooser />);
  fireEvent.click(screen.getByText("Choose Host"));
  expect(adapters.choose).toHaveBeenCalledExactlyOnceWith("manual");
});
