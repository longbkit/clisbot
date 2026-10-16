import { expect, it, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { createCatalogEventFeeds } from "./catalog-event-feeds";

type Observer = Parameters<ReturnType<DaemonClient["observeEvents"]>["subscribe"]>[0];
function fixture() {
  const observers: Observer[] = [];
  const releases: ReturnType<typeof vi.fn>[] = [];
  const unsubscribes: ReturnType<typeof vi.fn>[] = [];
  const observeEvents = vi.fn(() => {
    const release = vi.fn(async () => {});
    const unsubscribe = vi.fn();
    releases.push(release);
    unsubscribes.push(unsubscribe);
    return {
      subscribe: (observer: Observer) => {
        observers.push(observer);
        return unsubscribe;
      },
      release,
    };
  });
  const client = { observeEvents } as unknown as DaemonClient;
  const observer = { snapshot: vi.fn(), update: vi.fn() };
  const snapshot = {} as Parameters<Observer["snapshot"]>[0];
  const append = { type: "chat.transcript.appended" } as Parameters<Observer["update"]>[0];
  return { client, observeEvents, observer, observers, releases, unsubscribes, snapshot, append };
}
it("shares initial reconciliation and append delivery, keeping the feed until its last consumer", () => {
  const f = fixture();
  const retain = createCatalogEventFeeds();
  const a = retain(f.client, "host:1:1", () => true, f.observer);
  const b = retain(f.client, "host:1:1", () => true, f.observer);
  expect(f.observeEvents).toHaveBeenCalledTimes(1);
  f.observers[0]!.snapshot(f.snapshot);
  expect(f.observer.snapshot).toHaveBeenCalledTimes(1);
  a();
  a();
  expect(f.releases[0]).not.toHaveBeenCalled();
  f.observers[0]!.update(f.append);
  expect(f.observer.update).toHaveBeenCalledTimes(1);
  b();
  b();
  expect(f.releases[0]).toHaveBeenCalledTimes(1);
  expect(f.unsubscribes[0]).toHaveBeenCalledTimes(1);
  f.observers[0]!.update(f.append);
  f.observers[0]!.snapshot(f.snapshot);
  expect(f.observer.update).toHaveBeenCalledTimes(1);
  expect(f.observer.snapshot).toHaveBeenCalledTimes(1);
});
it("rejects old epoch events before effect cleanup and reconciles a fresh admission", () => {
  const f = fixture();
  const retain = createCatalogEventFeeds();
  let epoch = 1;
  const old = retain(f.client, "host:1:1", () => epoch === 1, f.observer);
  epoch = 2;
  const fresh = retain(f.client, "host:1:2", () => epoch === 2, f.observer);
  f.observers[0]!.update(f.append);
  f.observers[0]!.snapshot(f.snapshot);
  expect(f.observer.update).not.toHaveBeenCalled();
  expect(f.observer.snapshot).not.toHaveBeenCalled();
  f.observers[1]!.snapshot(f.snapshot);
  f.observers[1]!.update(f.append);
  expect(f.observer.snapshot).toHaveBeenCalledTimes(1);
  expect(f.observer.update).toHaveBeenCalledTimes(1);
  old();
  fresh();
});
it("never shares a feed with a replacement client even if its epoch numbers coincide", () => {
  const a = fixture();
  const b = fixture();
  const retain = createCatalogEventFeeds();
  let current = a.client;
  const stopA = retain(a.client, "host:1:1", () => current === a.client, a.observer);
  current = b.client;
  const stopB = retain(b.client, "host:1:1", () => current === b.client, b.observer);
  a.observers[0]!.update(a.append);
  a.observers[0]!.snapshot(a.snapshot);
  b.observers[0]!.snapshot(b.snapshot);
  expect(a.observer.update).not.toHaveBeenCalled();
  expect(a.observer.snapshot).not.toHaveBeenCalled();
  expect(b.observer.snapshot).toHaveBeenCalledTimes(1);
  stopA();
  stopB();
});
it("starts a new synchronization after all consumers leave and later return", () => {
  const f = fixture();
  const retain = createCatalogEventFeeds();
  retain(f.client, "host:1:1", () => true, f.observer)();
  const stop = retain(f.client, "host:1:1", () => true, f.observer);
  expect(f.observeEvents).toHaveBeenCalledTimes(2);
  f.observers[1]!.snapshot(f.snapshot);
  expect(f.observer.snapshot).toHaveBeenCalledTimes(1);
  stop();
});
