// Tests for the per-account host-runtime store (plan §7 / §14.5, impl doc §4.1).
// The store is the bridge between the loader (which injects a runtime at load) and
// the bound seam (hosts/channel-inbound.ts, which reads it back on every dispatch),
// keyed by `${channel}:${accountId}` so one Hub process can host several accounts.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";
import type { HostRuntime } from "./host.js";
import { createHostKeyedStoreRoot } from "../state/keyed-store.js";
import {
  clearAllChannelRuntimes,
  clearChannelRuntime,
  getChannelRuntime,
  runtimeKey,
  setChannelRuntime,
} from "./runtime-store.js";

function fakeRuntime(): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: true }),
    state: createHostKeyedStoreRoot(),
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  };
}

describe("runtime-store", () => {
  beforeEach(() => {
    clearAllChannelRuntimes();
  });

  it("runtimeKey is `${channel}:${accountId}`", () => {
    assert.equal(runtimeKey("slack", "a1"), "slack:a1");
  });

  it("round-trips a runtime by account key and is isolated across accounts", () => {
    const r1 = fakeRuntime();
    const r2 = fakeRuntime();
    setChannelRuntime("slack", "a1", r1);
    setChannelRuntime("slack", "a2", r2);
    assert.equal(getChannelRuntime("slack", "a1"), r1);
    assert.equal(getChannelRuntime("slack", "a2"), r2);
    // A different channel with the same account id does not collide.
    assert.equal(getChannelRuntime("telegram", "a1"), undefined);
  });

  it("returns undefined for an unstarted account", () => {
    assert.equal(getChannelRuntime("slack", "never"), undefined);
  });

  it("re-set replaces the previous runtime for the same account", () => {
    const old = fakeRuntime();
    const fresh = fakeRuntime();
    setChannelRuntime("slack", "a1", old);
    setChannelRuntime("slack", "a1", fresh);
    assert.equal(getChannelRuntime("slack", "a1"), fresh);
  });

  it("clearChannelRuntime drops only that account; clearAllChannelRuntimes drops all", () => {
    setChannelRuntime("slack", "a1", fakeRuntime());
    setChannelRuntime("telegram", "t1", fakeRuntime());
    clearChannelRuntime("slack", "a1");
    assert.equal(getChannelRuntime("slack", "a1"), undefined);
    assert.notEqual(getChannelRuntime("telegram", "t1"), undefined);
    clearAllChannelRuntimes();
    assert.equal(getChannelRuntime("telegram", "t1"), undefined);
  });
});
