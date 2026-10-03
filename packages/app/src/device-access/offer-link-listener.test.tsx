// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OfferLinkListener } from "./offer-link-listener";

const state = vi.hoisted(() => ({
  initial: null as string | null,
  listener: null as ((event: { url: string }) => void) | null,
  importLink: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  dismiss: vi.fn(),
  unmounted: vi.fn(),
}));
vi.mock("expo-linking", () => ({
  getInitialURL: async () => state.initial,
  addEventListener: (_name: string, listener: (event: { url: string }) => void) => {
    state.listener = listener;
    return { remove: vi.fn() };
  },
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: state.toast, dismiss: state.dismiss }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ importConnectionLink: state.importLink }),
}));
vi.mock("@/utils/host-routes", () => ({
  buildOpenProjectRoute: () => "/open-project",
}));

const link = `https://app.clisbot.com/#offer=${Buffer.from(
  JSON.stringify({
    v: 4,
    hub: {
      hubId: "hub-one",
      publicKey: "public-key",
      origin: "https://home.example.test",
      pairing: {
        backendId: "hub-one",
        token: "p".repeat(43),
        expiresAt: Date.now() + 300_000,
      },
    },
  }),
).toString("base64url")}`;

beforeEach(() => {
  state.initial = null;
  state.listener = null;
  vi.resetAllMocks();
});
afterEach(cleanup);

function AccountScope() {
  useEffect(() => () => state.unmounted(), []);
  return null;
}

test("a first Hub can remount its account scope without cancelling QR completion or repeating pairing", async () => {
  let complete!: (result: { status: "hub_connected" }) => void;
  state.initial = link;
  state.importLink.mockImplementation(() => new Promise((resolve) => (complete = resolve)));
  const tree = (hubId: string) => (
    <>
      <OfferLinkListener />
      <AccountScope key={hubId} />
    </>
  );
  const view = render(tree("unconfigured"));
  await waitFor(() => expect(state.importLink).toHaveBeenCalledOnce());
  view.rerender(tree("hub-one"));
  state.listener?.({ url: link });
  expect(state.unmounted).toHaveBeenCalledOnce();
  expect(state.importLink).toHaveBeenCalledOnce();
  await act(async () => complete({ status: "hub_connected" }));
  expect(state.replace).toHaveBeenCalledWith("/settings/hub/overview");
});

test("pairing failures show network and fresh-link guidance without exposing link secrets or raw errors", async () => {
  state.initial = link;
  state.importLink.mockRejectedValue(new Error(`Failed ${link} private server trace`));
  render(<OfferLinkListener />);
  await waitFor(() => expect(state.toast).toHaveBeenCalledOnce());
  const [message, options] = state.toast.mock.calls[0];
  expect(message).toContain("fresh QR code");
  expect(message).toContain("relay works without Tailscale");
  expect(message).not.toContain(link);
  expect(message).not.toContain("private server trace");
  expect(options).toMatchObject({ variant: "error", durationMs: null });
  expect(state.replace).not.toHaveBeenCalled();
});

test("root teardown cancels pending navigation while daemon-only links retain their existing destination", async () => {
  let complete!: (result: { status: "connected"; serverId: string }) => void;
  state.initial = "relay://legacy-public-connection";
  state.importLink.mockImplementation(() => new Promise((resolve) => (complete = resolve)));
  const view = render(<OfferLinkListener />);
  await waitFor(() => expect(state.importLink).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => complete({ status: "connected", serverId: "host-one" }));
  expect(state.replace).not.toHaveBeenCalled();
  state.importLink.mockResolvedValue({
    status: "connected",
    serverId: "host-one",
  });
  render(<OfferLinkListener />);
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/open-project"));
});

test("a successful explicit retry dismisses only its prior pairing error", async () => {
  state.initial = link;
  state.toast.mockReturnValue(72);
  state.importLink.mockRejectedValueOnce(new Error("network"));
  render(<OfferLinkListener />);
  await waitFor(() => expect(state.toast).toHaveBeenCalledOnce());
  state.importLink.mockResolvedValue({ status: "hub_connected" });
  await act(async () => state.listener?.({ url: link }));
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/settings/hub/overview"));
  expect(state.dismiss).toHaveBeenCalledExactlyOnceWith(72);
});
