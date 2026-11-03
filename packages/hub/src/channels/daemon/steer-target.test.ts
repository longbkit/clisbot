import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HostNotReachedError } from "./enrolled-client.js";
import {
  beginSteerTurn,
  createMemorySteerTargets,
  resolveSteerTurn,
  runningTurnOf,
  settleSteerTurn,
  type SteerTargetStore,
  type SteerTurn,
} from "./steer-target.js";

/** One attempt as the daemon client runs it: resolve, count, send, settle a failure. */
async function attempt(
  store: SteerTargetStore,
  read: SteerTurn,
  failure?: Error,
): Promise<SteerTurn> {
  const turn = await resolveSteerTurn(store, "a", "m", async () => read);
  await beginSteerTurn(store, "a", "m", turn);
  if (failure !== undefined) await settleSteerTurn(store, "a", "m", turn, failure);
  return turn;
}

const refused = () => new Error("Active turn changed before steering could be delivered");

describe("the turn a Steer names", () => {
  it("names the recorded turn on every attempt, whatever the Host runs now", async () => {
    const store = createMemorySteerTargets();
    assert.equal(await attempt(store, "turn-a", new Error("dispatch timed out")), "turn-a");
    assert.equal(await attempt(store, "turn-b"), "turn-a");
    assert.equal(await resolveSteerTurn(store, "a", "idle", async () => null), null);
    assert.equal(await resolveSteerTurn(store, "a", "idle", async () => "turn-b"), null);
  });

  it("reads the turn again when the only attempt never reached the Host or was refused", async () => {
    for (const failure of [new HostNotReachedError(), refused()]) {
      const store = createMemorySteerTargets();
      await attempt(store, "turn-a", failure);
      assert.equal(await attempt(store, "turn-b"), "turn-b", failure.message);
    }
  });

  it("keeps the turn an earlier attempt may have delivered, whatever later attempts prove", async () => {
    const store = createMemorySteerTargets();
    await attempt(store, "turn-a", new Error("host_not_connected"));
    await attempt(store, "turn-b", new HostNotReachedError());
    await attempt(store, "turn-b", refused());
    assert.equal(await attempt(store, "turn-b"), "turn-a");
  });

  it("sends nothing when the record changed after the turn was resolved", async () => {
    const store = createMemorySteerTargets();
    const stale = await resolveSteerTurn(store, "a", "m", async () => "turn-a");
    // Meanwhile another attempt was refused, and the next recorded turn-b and is in flight.
    await beginSteerTurn(store, "a", "m", stale);
    await settleSteerTurn(store, "a", "m", stale, refused());
    const inFlight = await attempt(store, "turn-b");
    await assert.rejects(beginSteerTurn(store, "a", "m", stale), /target changed/);
    assert.equal(await attempt(store, "turn-c"), inFlight, "the turn-b attempt may be delivered");
  });

  it("forgets a record when its only counted attempt was a mismatch that sent nothing", async () => {
    const store = createMemorySteerTargets();
    await resolveSteerTurn(store, "a", "m", async () => "turn-b");
    await assert.rejects(beginSteerTurn(store, "a", "m", "turn-a"), /target changed/);
    assert.equal(await store.find("a", "m"), undefined);
  });

  it("reads every time without a message id, which the daemon keeps no receipt for", async () => {
    const store = createMemorySteerTargets();
    assert.equal(await resolveSteerTurn(store, "a", undefined, async () => "turn-b"), "turn-b");
    assert.equal(await resolveSteerTurn(store, "a", undefined, async () => null), null);
  });
});

describe("runningTurnOf", () => {
  it("names the running turn, none when idle, and refuses to guess while it has no id", () => {
    assert.equal(runningTurnOf({ status: "running", activeTurn: { turnId: "turn-a" } }), "turn-a");
    assert.equal(runningTurnOf({ status: "idle", activeTurn: { turnId: "autonomous" } }), null);
    assert.equal(runningTurnOf(undefined), null);
    assert.throws(() => runningTurnOf({ status: "running", activeTurn: null }), /cannot be named/);
  });
});
