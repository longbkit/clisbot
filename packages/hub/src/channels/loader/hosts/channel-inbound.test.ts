// Tests for the bound `openclaw/plugin-sdk/channel-inbound` seam module
// (plan §7 / §14.5). The seam hands the channel's normalized inbound event to the
// account's HostRuntime (`onInboundReply`), read back from the runtime store. The
// failure-domain rule (P13) is the contract under test: a fault in the runtime or a
// missing runtime must NEVER throw into the channel — the seam logs and returns a
// benign no-dispatch result. These are pure (no ESM hooks involved), so vitest.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";
import { createHostKeyedStoreRoot } from "../../state/keyed-store.js";
import {
  dispatchChannelInboundReply,
  dispatchReplyFromConfigWithSettledDispatcher,
  runChannelInboundEvent,
  runPreparedInboundReply,
} from "./channel-inbound.js";
import type { InboundReplyParams } from "../host.js";
import { clearAllChannelRuntimes, setChannelRuntime } from "../runtime-store.js";
import { clearChannelSeamLogger, setChannelSeamLogger } from "../seam-logger.js";
import type { PlaneLogger } from "../../plane/types.js";

const CHANNEL = "slack";
const ACCOUNT = "a1";

function params(): InboundReplyParams {
  return {
    channel: CHANNEL,
    accountId: ACCOUNT,
    ctxPayload: { channel: CHANNEL, accountId: ACCOUNT, messageId: "m1" },
  };
}

describe("bound channel-inbound seam", () => {
  beforeEach(() => {
    clearAllChannelRuntimes();
    clearChannelSeamLogger();
  });

  it("dispatches to the account's onInboundReply and returns its result", async () => {
    setChannelRuntime(CHANNEL, ACCOUNT, {
      onInboundReply: async () => ({
        dispatched: true,
        dispatchResult: { queuedFinal: true, counts: { final: 1 } },
      }),
      state: createHostKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
    });
    const result = await dispatchChannelInboundReply(params());
    assert.equal(result.dispatched, true);
    assert.deepEqual(result.dispatchResult, { queuedFinal: true, counts: { final: 1 } });
  });

  it("routes all four seam exports to the same runtime", async () => {
    let calls = 0;
    const runtime = {
      onInboundReply: async () => {
        calls += 1;
        return { dispatched: true } as const;
      },
      state: createHostKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
    };
    setChannelRuntime(CHANNEL, ACCOUNT, runtime);
    await dispatchChannelInboundReply(params());
    await runChannelInboundEvent(params());
    await runPreparedInboundReply(params());
    await dispatchReplyFromConfigWithSettledDispatcher(params());
    assert.equal(calls, 4);
  });

  it("returns a benign no-dispatch when the runtime is missing (never throws)", async () => {
    const result = await dispatchChannelInboundReply(params());
    assert.equal(result.dispatched, false);
    assert.equal(result.dispatchResult, undefined);
  });

  it("reports a no-runtime miss through the process-wide sink when one is assigned", async () => {
    const warnings: Array<{ message: string; meta?: unknown }> = [];
    const logger: PlaneLogger = {
      warn: (message, meta) => {
        warnings.push({ message, meta });
      },
    };
    setChannelSeamLogger(logger);
    const result = await dispatchChannelInboundReply(params());
    assert.equal(result.dispatched, false);
    assert.equal(
      warnings.length,
      1,
      "the miss is logged, not silent, when the supervisor assigned a sink",
    );
    assert.match(warnings[0]!.message, /no runtime/u);
    assert.deepEqual(warnings[0]!.meta, {
      channel: CHANNEL,
      accountId: ACCOUNT,
      op: "dispatchChannelInboundReply",
    });
  });

  it("catches a runtime fault, logs it, and returns no-dispatch (never throws)", async () => {
    let warned = false;
    const runtime = {
      onInboundReply: async () => {
        throw new Error("boom");
      },
      state: createHostKeyedStoreRoot(),
      logging: {
        getChildLogger: () => ({
          warn: () => {
            warned = true;
          },
        }),
      },
      channel: {},
    };
    setChannelRuntime(CHANNEL, ACCOUNT, runtime);
    const result = await dispatchChannelInboundReply(params());
    assert.equal(result.dispatched, false);
    assert.equal(warned, true, "the fault was logged through the runtime logger");
  });

  it("keying is per-account: a fault in one account does not affect another", async () => {
    setChannelRuntime(CHANNEL, "broken", {
      onInboundReply: async () => {
        throw new Error("boom");
      },
      state: createHostKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
    });
    setChannelRuntime(CHANNEL, ACCOUNT, {
      onInboundReply: async () => ({ dispatched: true }),
      state: createHostKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
    });
    assert.equal((await dispatchChannelInboundReply(params())).dispatched, true);
  });
});
