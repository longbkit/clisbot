import { describe, expect, it, vi } from "vitest";

import { CommittedEventOutbox } from "./committed-event-outbox.js";

function writeGate(): { promise: Promise<void>; commit: () => void } {
  let commit!: () => void;
  const promise = new Promise<void>((resolve) => {
    commit = resolve;
  });
  return { promise, commit };
}

function createOutbox() {
  const state: { write: Promise<void> | undefined; failed: boolean } = {
    write: undefined,
    failed: false,
  };
  const delivered: string[] = [];
  const outbox = new CommittedEventOutbox({
    pendingWrite: () => state.write,
    failed: () => state.failed,
    onDeliveryError: vi.fn(),
  });
  const publish = (name: string, options?: { cursor?: boolean }) =>
    outbox.publish("agent", () => delivered.push(name), options);
  return { outbox, state, delivered, publish };
}

describe("CommittedEventOutbox", () => {
  it("delivers at once when nothing is queued and no write is in flight", () => {
    const { delivered, publish } = createOutbox();
    publish("state");
    expect(delivered).toEqual(["state"]);
  });

  it("never lets a delivery with no write in flight overtake an earlier held one", async () => {
    const { outbox, state, delivered, publish } = createOutbox();
    const write = writeGate();
    state.write = write.promise;
    publish("row", { cursor: true });
    write.commit();
    state.write = undefined;
    publish("turn end");
    expect(delivered).toEqual([]);
    await outbox.delivered("agent");
    expect(delivered).toEqual(["row", "turn end"]);
  });

  it("delivers entries held behind successive writes in publish order", async () => {
    const { outbox, state, delivered, publish } = createOutbox();
    const first = writeGate();
    state.write = first.promise;
    publish("row 1", { cursor: true });
    const second = writeGate();
    state.write = Promise.all([first.promise, second.promise]).then(() => undefined);
    publish("row 2", { cursor: true });
    publish("state");
    second.commit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(delivered).toEqual([]);
    first.commit();
    await outbox.delivered("agent");
    expect(delivered).toEqual(["row 1", "row 2", "state"]);
  });

  it("discards held deliveries on failure, then drops cursors and delivers the rest at once", async () => {
    const { outbox, state, delivered, publish } = createOutbox();
    const write = writeGate();
    state.write = write.promise;
    publish("row", { cursor: true });
    publish("turn end");
    const waiting = outbox.delivered("agent");
    state.failed = true;
    outbox.discard("agent");
    await waiting;
    publish("late row", { cursor: true });
    publish("error state");
    expect(delivered).toEqual(["error state"]);
    write.commit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(delivered).toEqual(["error state"]);
  });
});
