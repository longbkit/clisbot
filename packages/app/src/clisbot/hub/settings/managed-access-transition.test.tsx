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
  client.setQueryDefaults(hubResourceQueryKey(scope, "daemons"), { queryFn: async () => daemons });
  await client.fetchQuery({ queryKey: hubResourceQueryKey(scope, "daemons") });
  const applyMode = vi.fn(async () => {
    throw new Error("Managed access is now required");
  });
  const { result, rerender } = renderHook(
    ({ daemonMode }: { daemonMode: "off" | "external" }) =>
      useManagedAccessTransition({ serverId: "srv", scope, daemonMode, applyMode }),
    { initialProps: { daemonMode: "off" as "off" | "external" }, wrapper: wrapperFor(client) },
  );

  await act(() => result.current.switchMode("external"));
  expect(result.current.transition).toEqual({ status: "switching", target: "external" });
  expect(runtime.restart).toHaveBeenCalledWith("srv");

  rerender({ daemonMode: "external" });
  await waitFor(() =>
    expect(result.current.transition).toEqual({ status: "done", mode: "external" }),
  );
});

it("reports a real failure to apply the mode", async () => {
  vi.stubGlobal("React", React);
  const applyMode = vi.fn(async () => {
    throw new Error("Only an owner can change this");
  });
  const { result } = renderHook(
    () => useManagedAccessTransition({ serverId: "srv", scope, daemonMode: "off", applyMode }),
    { wrapper: wrapperFor(new QueryClient()) },
  );

  await act(() => result.current.switchMode("external"));
  expect(result.current.transition).toEqual({
    status: "failed",
    message: "Only an owner can change this",
  });
  expect(runtime.restart).not.toHaveBeenCalled();
});
