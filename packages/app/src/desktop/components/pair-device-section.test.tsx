// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PairDeviceSection } from "./pair-device-section";

const state = vi.hoisted(() => ({
  offer: { relayEnabled: false, url: "https://app.clisbot.com/#offer=direct" },
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeClient: () => ({
    getLastServerInfoMessage: () => ({ features: { daemonStatusRpc: true, relayConfig: true } }),
  }),
  useHostRuntimeSnapshot: () => ({ connectionStatus: "online" }),
}));
vi.mock("@/device-access/hub-profiles", () => ({ useHubProfiles: () => ({ profiles: [] }) }));
vi.mock("@/device-access/pairing-offer", () => ({ appDevicePairingOffer: vi.fn() }));
vi.mock("@/hooks/use-daemon-config", () => ({ useDaemonConfig: () => ({ patchConfig: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/data/query", () => ({
  useFetchQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "daemon-pairing-offer-qr" ? "<svg />" : state.offer,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
afterEach(cleanup);

test("shows a direct pairing URL with relay disabled instead of forcing relay consent", () => {
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <PairDeviceSection serverId="daemon-one" onClose={onClose} />
    </QueryClientProvider>,
  );
  expect(view.queryByText("pairing.device.enableRelay")).toBeNull();
  expect(view.getByDisplayValue(state.offer.url)).toBeTruthy();
});
