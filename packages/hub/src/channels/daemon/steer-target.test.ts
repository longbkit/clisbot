import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HostNotReachedError } from "./enrolled-client.js";
import {
  createMemorySteerTargets,
  resolveSteerTurn,
  runningTurnOf,
  settleSteerTurn,
} from "./steer-target.js";

describe("the turn a Steer names", () => {
  const readAgain = async () => "read-again";

  it("names the recorded turn on every attempt, whatever the Host runs now", async () => {
    const store = createMemorySteerTargets();
    assert.equal(await resolveSteerTurn(store, "a", "m", async () => "turn-a"), "turn-a");
    await settleSteerTurn(store, "a", "m", "turn-a", new Error("dispatch timed out"));
    assert.equal(await resolveSteerTurn(store, "a", "m", readAgain), "turn-a");
    assert.equal(await resolveSteerTurn(store, "a", "idle", async () => null), null);
    assert.equal(await resolveSteerTurn(store, "a", "idle", readAgain), null);
  });

  it("reads the turn again once the Host never saw the attempt or refused it before delivery", async () => {
    for (const error of [
      new HostNotReachedError(),
      new Error("Active turn changed before steering could be delivered"),
      new Error("This provider cannot steer this active turn; choose Queue or Interrupt"),
    ]) {
      const store = createMemorySteerTargets();
      await resolveSteerTurn(store, "a", "m", async () => "turn-a");
      await settleSteerTurn(store, "a", "m", "turn-a", error);
      assert.equal(await resolveSteerTurn(store, "a", "m", readAgain), "read-again", error.message);
    }
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
