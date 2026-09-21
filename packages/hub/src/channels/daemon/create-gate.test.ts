import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  HOST_CREATE_WAIT_MS,
  MAX_CONCURRENT_CREATES_PER_HOST,
  withHostCreateSlot,
} from "./create-gate.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("host create gate", () => {
  it("caps concurrent creates per Host and runs the rest in arrival order", async () => {
    let running = 0;
    let peak = 0;
    const finished: number[] = [];
    const create = (index: number) =>
      withHostCreateSlot("host-a", async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(10);
        running -= 1;
        finished.push(index);
      });
    await Promise.all(Array.from({ length: 10 }, (_, index) => create(index)));
    assert.equal(peak, MAX_CONCURRENT_CREATES_PER_HOST);
    assert.deepEqual(
      finished,
      [...finished].sort((a, b) => a - b),
    );
  });

  it("gives up on a slot that never frees, and leaves the queue clean", async () => {
    vi.useFakeTimers();
    try {
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hold = (): Promise<void> => held;
      const holders = Array.from({ length: MAX_CONCURRENT_CREATES_PER_HOST }, () =>
        withHostCreateSlot("host-full", hold),
      );
      const waiter = withHostCreateSlot("host-full", async () => "created");
      const refused = assert.rejects(waiter, { name: "HostBusyError" });
      await vi.advanceTimersByTimeAsync(HOST_CREATE_WAIT_MS);
      await refused;
      release();
      await Promise.all(holders);
      assert.equal(await withHostCreateSlot("host-full", async () => "created"), "created");
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the slot when a create fails, and keeps Hosts apart", async () => {
    const refuse = async (): Promise<string> => {
      throw new Error("create failed");
    };
    const failing = Array.from({ length: MAX_CONCURRENT_CREATES_PER_HOST }, () =>
      withHostCreateSlot("host-b", refuse),
    );
    const settled = await Promise.allSettled(failing);
    assert.equal(
      settled.every((entry) => entry.status === "rejected"),
      true,
    );
    assert.equal(await withHostCreateSlot("host-b", async () => "created"), "created");
    assert.equal(await withHostCreateSlot("host-c", async () => "created"), "created");
  });
});
