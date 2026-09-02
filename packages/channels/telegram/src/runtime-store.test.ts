import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { registerAccountInbound, unregisterAccountInbound } from "./runtime-store.js";

function runtime(label: string): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: false, label }),
    state: {
      openKeyedStore: () => ({
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => true,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => true,
        entries: async () => [],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  };
}

describe("Telegram account runtime isolation", () => {
  it("replaces a same-id registration when a new account runtime is loaded", () => {
    const firstRuntime = runtime("first");
    const secondRuntime = runtime("second");
    const first = registerAccountInbound("work", 1, firstRuntime);
    const second = registerAccountInbound("work", 1, secondRuntime);
    assert.notEqual(first, second);
    // A late cleanup from the old lifecycle cannot delete the replacement.
    unregisterAccountInbound("work", firstRuntime);
    assert.equal(registerAccountInbound("work", 1, secondRuntime), second);
    unregisterAccountInbound("work", secondRuntime);
  });
});
