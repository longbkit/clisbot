import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HostNotReachedError } from "./enrolled-client.js";
import { runningTurnOf, SteerTargets } from "./steer-target.js";

describe("SteerTargets", () => {
  async function remembered(targets: SteerTargets, key: string): Promise<string | null> {
    return targets.resolve(key, async () => "read-again");
  }

  it("keeps the first attempt's turn after an outcome the Hub cannot know", async () => {
    const targets = new SteerTargets();
    await targets.resolve("m", async () => "turn-a");
    targets.settle("m", new Error("dispatch timed out"));
    assert.equal(await remembered(targets, "m"), "turn-a");
  });

  it("reads the turn again once the Host never saw the attempt or refused it before delivery", async () => {
    for (const error of [
      new HostNotReachedError(),
      new Error("Active turn changed before steering could be delivered"),
      new Error("This provider cannot steer this active turn; choose Queue or Interrupt"),
    ]) {
      const targets = new SteerTargets();
      await targets.resolve("m", async () => "turn-a");
      targets.settle("m", error);
      assert.equal(await remembered(targets, "m"), "read-again", error.message);
    }
  });

  it("forgets a delivered message and reads every time without a message id", async () => {
    const targets = new SteerTargets();
    await targets.resolve("m", async () => "turn-a");
    targets.settle("m");
    assert.equal(await remembered(targets, "m"), "read-again");
    assert.equal(await targets.resolve(undefined, async () => "turn-b"), "turn-b");
    assert.equal(await targets.resolve(undefined, async () => null), null);
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
