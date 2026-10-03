// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { hubResourceQueryKey } from "../query-keys";
import { useManagedAccessTransition } from "./managed-access-transition";

const runtime = vi.hoisted(() => ({
  status: "online",
  restart: vi.fn(async () => {}),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ restartHostConnection: runtime.restart }),
  useHostRuntimeConnectionStatus: () => runtime.status,
}));

const scope = {
  origin: "https://hub.test",
  organizationId: "org",
  accountId: "me",
  daemonId: "d1",
};

afterEach(() => {
  cleanup();
  runtime.restart.mockClear();
  runtime.status = "online";
  runtime.restart.mockResolvedValue(undefined);
});

function clientReportingOff() {
  const client = new QueryClient();
  const data = {
    daemons: [{ id: "d1", managedAccessMode: "off" }],
  };
  client.setQueryDefaults(hubResourceQueryKey(scope, "daemons"), { queryFn: async () => data });
  client.setQueryData(hubResourceQueryKey(scope, "daemons"), data);
  return client;
}

it("guides a protected ticket-only device to separate Host pairing after turning access off", async () => {
  runtime.status = "offline";
  const applyMode = vi.fn(async () => {
    throw new Error("Daemon device credentials are now required");
  });
  const hasIndependentCredential = vi.fn(async () => false);
  const { result } = renderHook(
    () =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode: "external",
        applyMode,
        devicePairing: true,
        hasIndependentCredential,
      }),
    { wrapper: wrapperFor(clientReportingOff()) },
  );
  await act(() => result.current.switchMode("off"));
  expect(result.current.transition).toEqual({ status: "pairing-required" });
  expect(hasIndependentCredential).toHaveBeenCalledOnce();
  expect(runtime.restart).toHaveBeenCalledWith("srv");

  await act(() => result.current.finishPairing());
  expect(result.current.transition).toEqual({ status: "done", mode: "off" });
});

it("reconnects a separately paired device using ordinary daemon authority", async () => {
  runtime.status = "offline";
  const applyMode = vi.fn(async () => {
    throw new Error("Daemon device credentials are now required");
  });
  const { result, rerender } = renderHook(
    ({ daemonMode }: { daemonMode: "off" | "external" }) =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode,
        applyMode,
        devicePairing: true,
        hasIndependentCredential: async () => true,
      }),
    {
      initialProps: { daemonMode: "external" as "off" | "external" },
      wrapper: wrapperFor(clientReportingOff()),
    },
  );
  await act(() => result.current.switchMode("off"));
  expect(result.current.transition).toEqual({
    status: "switching",
    target: "off",
  });
  runtime.status = "online";
  rerender({ daemonMode: "off" });
  await waitFor(() => expect(result.current.transition).toEqual({ status: "done", mode: "off" }));
});

it("retains feature-off legacy reconnect and never checks device credentials", async () => {
  runtime.status = "offline";
  const hasIndependentCredential = vi.fn(async () => false);
  const { result } = renderHook(
    () =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode: "external",
        applyMode: async () => {},
        devicePairing: false,
        hasIndependentCredential,
      }),
    { wrapper: wrapperFor(clientReportingOff()) },
  );
  await act(() => result.current.switchMode("off"));
  expect(result.current.transition).toEqual({
    status: "switching",
    target: "off",
  });
  expect(hasIndependentCredential).not.toHaveBeenCalled();
  expect(runtime.restart).toHaveBeenCalledWith("srv");
});

it("does not mistake a denied policy change for successful off mode or pairing permission", async () => {
  const hasIndependentCredential = vi.fn(async () => false);
  const { result } = renderHook(
    () =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode: "external",
        devicePairing: true,
        hasIndependentCredential,
        applyMode: async () => {
          throw new Error("Only an owner can change this");
        },
      }),
    { wrapper: wrapperFor(clientReportingOff()) },
  );
  await act(() => result.current.switchMode("off"));
  expect(result.current.transition).toEqual({
    status: "failed",
    message: "Only an owner can change this",
  });
  expect(hasIndependentCredential).not.toHaveBeenCalled();
  expect(runtime.restart).not.toHaveBeenCalled();
});

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

it("treats the daemon closing this session as the expected start of managed access", async () => {
  vi.stubGlobal("React", React);
  const client = new QueryClient();
  const daemons = { daemons: [{ id: "d1", managedAccessMode: "external" }] };
  client.setQueryDefaults(hubResourceQueryKey(scope, "daemons"), {
    queryFn: async () => daemons,
  });
  await client.fetchQuery({ queryKey: hubResourceQueryKey(scope, "daemons") });
  const applyMode = vi.fn(async () => {
    throw new Error("Managed access is now required");
  });
  const { result, rerender } = renderHook(
    ({ daemonMode }: { daemonMode: "off" | "external" }) =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode,
        applyMode,
      }),
    {
      initialProps: { daemonMode: "off" as "off" | "external" },
      wrapper: wrapperFor(client),
    },
  );

  await act(() => result.current.switchMode("external"));
  expect(result.current.transition).toEqual({
    status: "switching",
    target: "external",
  });
  expect(runtime.restart).toHaveBeenCalledWith("srv");

  rerender({ daemonMode: "external" });
  await waitFor(() =>
    expect(result.current.transition).toEqual({
      status: "done",
      mode: "external",
    }),
  );
});

it("reports a real failure to apply the mode", async () => {
  vi.stubGlobal("React", React);
  const applyMode = vi.fn(async () => {
    throw new Error("Only an owner can change this");
  });
  const { result } = renderHook(
    () =>
      useManagedAccessTransition({
        serverId: "srv",
        scope,
        daemonMode: "off",
        applyMode,
      }),
    { wrapper: wrapperFor(new QueryClient()) },
  );

  await act(() => result.current.switchMode("external"));
  expect(result.current.transition).toEqual({
    status: "failed",
    message: "Only an owner can change this",
  });
  expect(runtime.restart).not.toHaveBeenCalled();
});
