import { describe, expect, test } from "bun:test";
import {
  chainOrderedIngressAccepted,
  OrderedIngressDispatcher,
} from "../src/channels/message/ordered-ingress-dispatcher.ts";

describe("OrderedIngressDispatcher", () => {
  test("shared accepted callback releases same-surface ingress before handler completion", async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const dispatcher = new OrderedIngressDispatcher<{ id: number; key: string }>(
      (item) => item.key,
      async (item, controls) => {
        order.push(`start:${item.id}`);
        await chainOrderedIngressAccepted(controls, async () => {
          order.push(`accepted:${item.id}`);
        })();
        if (item.id === 1) {
          await firstFinished;
        }
        order.push(`end:${item.id}`);
      },
    );

    const tasks = dispatcher.dispatch([{ id: 1, key: "chat-1" }, { id: 2, key: "chat-1" }]);

    for (let attempt = 0; attempt < 20 && !order.includes("end:2"); attempt += 1) {
      await Bun.sleep(10);
    }
    expect(order).toEqual(["start:1", "accepted:1", "start:2", "accepted:2", "end:2"]);

    finishFirst();
    await Promise.all(tasks);
    expect(order).toEqual(["start:1", "accepted:1", "start:2", "accepted:2", "end:2", "end:1"]);
  });
});
