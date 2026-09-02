import assert from "node:assert/strict";
import type { SocketModeClient } from "@slack/socket-mode";
import { describe, it } from "vitest";
import { acquireSharedSlackSocket } from "./socket-pool.js";

describe("shared Slack Socket Mode lifecycle", () => {
  it("starts one client per app token and stops it only after the last account releases", async () => {
    const handlers = new Map<string, Set<() => void>>();
    let created = 0;
    let started = 0;
    let disconnected = 0;
    const createClient = (): SocketModeClient => {
      created += 1;
      const client = {
        on(event: string, fn: () => void): unknown {
          const listeners = handlers.get(event) ?? new Set<() => void>();
          listeners.add(fn);
          handlers.set(event, listeners);
          return client;
        },
        off(event: string, fn: () => void): unknown {
          handlers.get(event)?.delete(fn);
          return client;
        },
        async start(): Promise<void> {
          started += 1;
        },
        async disconnect(): Promise<void> {
          disconnected += 1;
        },
      };
      return client as unknown as SocketModeClient;
    };

    const first = acquireSharedSlackSocket({
      appToken: "xapp-shared-test",
      createClient: () => createClient(),
    });
    const second = acquireSharedSlackSocket({
      appToken: "xapp-shared-test",
      createClient: () => createClient(),
    });
    assert.equal(first.client, second.client);
    first.start();
    second.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(created, 1);
    assert.equal(started, 1);

    const firstLifetime = new AbortController();
    const firstWait = first.wait(firstLifetime.signal);
    firstLifetime.abort();
    await firstWait;
    await first.release();
    assert.equal(disconnected, 0);

    const secondLifetime = new AbortController();
    const secondWait = second.wait(secondLifetime.signal);
    secondLifetime.abort();
    await secondWait;
    await second.release();
    assert.equal(disconnected, 1);
  });
});
