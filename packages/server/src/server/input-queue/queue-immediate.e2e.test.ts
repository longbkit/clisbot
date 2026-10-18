import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { expect, test } from "vitest";
import { InputQueueRuntime } from "./runtime.js";

for (const action of ["steer_now", "send_now"] as const) {
  test(`${action} uses explicit handoff semantics and removes only after durable confirmation`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "queue-immediate-"));
    const runtime = new InputQueueRuntime(pino({ level: "silent" }));
    let complete!: () => void;
    const gate = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let begun!: () => void;
    const began = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let delivered = false;
    const calls: unknown[] = [];
    const authority = { ownsUpload: () => false };
    try {
      runtime.register("target", {
        directory,
        ready: async () => false,
        delivered: async () => delivered,
        handoff: async (id, content, interrupt, target) => {
          calls.push({ id, text: content.text, interrupt, target });
          begun();
          await gate;
          delivered = true;
        },
      });
      const accepted = await runtime.command(
        "target",
        { action: "enqueue", id: "queued", text: "Preserve this input" },
        authority,
      );
      const target = { agentId: "active-agent", turnId: "exact-turn" };
      const pending = runtime.command(
        "target",
        action === "steer_now"
          ? { action, id: "queued", revision: accepted.queue.revision, target }
          : { action, id: "queued", revision: accepted.queue.revision },
        authority,
      );
      await began;
      expect(calls).toEqual([
        {
          id: "queued",
          text: "Preserve this input",
          interrupt: action === "send_now",
          target: action === "steer_now" ? target : undefined,
        },
      ]);
      const during = await runtime.command("target", { action: "fetch" }, authority);
      expect(during.queue.items[0].state).toBe("sending");
      const conflict = await runtime.command(
        "target",
        { action: "steer_now", id: "queued", revision: accepted.queue.revision, target },
        authority,
      );
      expect(conflict.errorCode).toBe("queue_conflict");
      expect(calls).toHaveLength(1);
      complete();
      expect((await pending).queue.items).toEqual([]);
    } finally {
      complete();
      await runtime.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
