import { expect, test, vi } from "vitest";
import { createResourcePinsStore, type ResourcePin } from "./pins";

const oldPin: ResourcePin = { kind: "bot", serverId: "host", id: "old" };
const newPin: ResourcePin = { kind: "bot", serverId: "host", id: "new" };

test("queues early toggles until hydration and preserves other principals' pins", async () => {
  let resolveRead!: (value: string | null) => void;
  const writes: string[] = [];
  const store = createResourcePinsStore({
    getItem: () =>
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      }),
    setItem: (_key, value) => {
      writes.push(value);
    },
    removeItem: () => {},
  });
  const hydrated = new Promise<void>((resolve) => store.persist.onFinishHydration(() => resolve()));
  store.getState().toggle("owner", oldPin);
  store.getState().toggle("owner", newPin);
  // Two queued toggles cancel each other, including on another principal.
  store.getState().toggle("other", newPin);
  store.getState().toggle("other", newPin);
  expect(writes).toEqual([]);
  resolveRead(
    JSON.stringify({ state: { scopes: { owner: [oldPin], other: [oldPin] } }, version: 0 }),
  );
  await hydrated;
  expect(store.getState().scopes).toEqual({ owner: [newPin], other: [oldPin] });
  expect(JSON.parse(writes.at(-1)!)).toMatchObject({
    state: { scopes: { owner: [newPin], other: [oldPin] } },
  });
});

test("replays a DM pin using the captured alias when storage hydrates", async () => {
  let resolveRead!: (value: string | null) => void;
  const store = createResourcePinsStore({
    getItem: () =>
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      }),
    setItem: () => {},
    removeItem: () => {},
  });
  const hydrated = new Promise<void>((resolve) => store.persist.onFinishHydration(() => resolve()));
  store.getState().toggle("owner", { kind: "chat", serverId: "host", id: "dm" }, [
    {
      serverId: "host",
      id: "dm",
      kind: "direct",
      participants: [{ botId: "old", agentId: null }],
    },
  ]);
  resolveRead(JSON.stringify({ state: { scopes: { owner: [oldPin] } } }));
  await hydrated;
  expect(store.getState().scopes.owner).toEqual([]);
});

test("retries a failed storage read on the next interaction without dropping queued intent", async () => {
  let rejectRead!: (error: Error) => void;
  const writes: string[] = [];
  const getItem = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string | null>((_resolve, reject) => {
          rejectRead = reject;
        }),
    )
    .mockResolvedValue(JSON.stringify({ state: { scopes: { owner: [oldPin], other: [oldPin] } } }));
  const store = createResourcePinsStore({
    getItem,
    setItem: (_key, value) => {
      writes.push(value);
    },
    removeItem: () => {},
  });
  store.getState().toggle("owner", oldPin);
  rejectRead(new Error("Storage temporarily unavailable"));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(writes).toEqual([]);
  expect(getItem).toHaveBeenCalledOnce();
  const hydrated = new Promise<void>((resolve) => store.persist.onFinishHydration(() => resolve()));
  store.getState().toggle("owner", newPin);
  await hydrated;
  expect(getItem).toHaveBeenCalledTimes(2);
  expect(store.getState().scopes).toEqual({ owner: [newPin], other: [oldPin] });
  expect(JSON.parse(writes.at(-1)!)).toMatchObject({
    state: { scopes: { owner: [newPin], other: [oldPin] } },
  });
});
