import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { registerAccountInbound, unregisterAccountInbound } from "./runtime-store.js";
import { withTelegramAccount } from "./runtime.js";
import { writeTelegramUpdateOffset } from "./update-offset-store.js";

const written = new Map<string, unknown>();

function runtime(label: string): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: false, label }),
    state: {
      openKeyedStore: () => ({
        register: async (key: string, value: unknown) => void written.set(key, value),
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

describe("Telegram inbound runtime install", () => {
  // Regression (live 2026-09-07): the account polled fine but every offset
  // persist failed with "Telegram runtime not initialized" — the ported
  // runtime was installed only at the SEND entry points, so an account that
  // had not sent yet had no keyed stores. Starting the account must install
  // it, and the transport must run inside the account's ALS scope.
  it("lets a ported inbound store resolve the account runtime without a prior send", async () => {
    const host = runtime("inbound");
    registerAccountInbound("inbound-only", 991_001, host);
    try {
      written.clear();
      await withTelegramAccount("inbound-only", async () => {
        await writeTelegramUpdateOffset({ accountId: "inbound-only", updateId: 318_879_853 });
      });
      assert.equal(written.size, 1);
    } finally {
      unregisterAccountInbound("inbound-only", host);
    }
  });

  it("still has no runtime outside the account scope (why startAccount wraps the transport)", async () => {
    const host = runtime("unscoped");
    registerAccountInbound("scoped-account", 991_002, host);
    try {
      await assert.rejects(
        writeTelegramUpdateOffset({ accountId: "scoped-account", updateId: 1 }),
        /Telegram runtime not initialized/,
      );
    } finally {
      unregisterAccountInbound("scoped-account", host);
    }
  });
});
