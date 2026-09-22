import { beforeEach, expect, it, vi } from "vitest";
import {
  readHostDiagnostics,
  recordHostDiagnostic,
  setHostDiagnosticStorageForTests,
} from "./host-diagnostics";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  setHostDiagnosticStorageForTests({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

it("keeps the most recent events across reads, oldest first", async () => {
  for (let index = 0; index < 105; index += 1) {
    recordHostDiagnostic("managed-host-removed", { index });
  }
  await vi.waitFor(async () => {
    const events = await readHostDiagnostics();
    expect(events).toHaveLength(100);
    expect(events[0]).toMatchObject({ event: "managed-host-removed", index: 5 });
    expect(events[99]).toMatchObject({ index: 104 });
  });
  expect(console.warn).toHaveBeenCalledWith(
    "[paseo:host] managed-host-removed",
    expect.objectContaining({ index: 0 }),
  );
});

it("exposes the persisted events to the browser console", async () => {
  recordHostDiagnostic("host-route-redirect", { to: "/welcome" });
  const reader = Reflect.get(globalThis, "paseoHostDiagnostics") as () => Promise<unknown[]>;
  await vi.waitFor(async () => expect(await reader()).toHaveLength(1));
});
