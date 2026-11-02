// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

const runtime = vi.hoisted(() => {
  const statuses = new Map<string, string>();
  const listeners = new Set<() => void>();
  return {
    statuses,
    set(serverId: string, status: string) {
      statuses.set(serverId, status);
      for (const listener of listeners) listener();
    },
    store: {
      subscribeAll(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: (serverId: string) => ({ connectionStatus: statuses.get(serverId) }),
    },
  };
});
vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => runtime.store }));

const { projectHostChoiceStatus, useHostChoiceStatuses } = await import("./host-choice-statuses");

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
});

it("keeps a retrying unreachable Host unreachable until it is online", () => {
  expect(projectHostChoiceStatus("connecting", "error")).toBe("error");
  expect(projectHostChoiceStatus("idle", "offline")).toBe("offline");
  expect(projectHostChoiceStatus("online", "error")).toBe("online");
  expect(projectHostChoiceStatus("connecting", "online")).toBe("connecting");
  expect(projectHostChoiceStatus("connecting", undefined)).toBe("connecting");
});

// Home read every Host's raw status: a dozen unreachable Hosts retrying flipped connecting and
// error about twice a second, and each flip re-rendered the whole start screen.
it("does not re-render the start screen while unreachable Hosts retry", async () => {
  const ids = ["srv_up", "srv_down"];
  runtime.statuses.set("srv_up", "online");
  runtime.statuses.set("srv_down", "error");
  const seen: ReadonlyMap<string, HostRuntimeConnectionStatus>[] = [];
  function Home() {
    seen.push(useHostChoiceStatuses(ids));
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root!.render(<Home />));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(() => runtime.set("srv_down", "connecting"));
    await act(() => runtime.set("srv_down", "error"));
  }
  expect(seen).toHaveLength(1);
  expect(seen[0]!.get("srv_down")).toBe("error");
  await act(() => runtime.set("srv_down", "online"));
  expect(seen).toHaveLength(2);
  expect(seen[1]!.get("srv_down")).toBe("online");
});
