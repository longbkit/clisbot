import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { InputQueueRuntime } from "./runtime.js";
import { writeJsonFileAtomic } from "../atomic-file.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("shutdown joins crash recovery before reporting the Host queue stopped", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "queue-stop-recovery-"));
  const proof = deferred<boolean>();
  const began = deferred<void>();
  const runtime = new InputQueueRuntime(pino({ level: "silent" }));
  try {
    await writeJsonFileAtomic(path.join(directory, "queue.json"), {
      version: 1,
      revision: 1,
      items: [
        {
          id: "pending",
          createdAt: "fixture",
          senderId: "owner",
          state: "sending",
          payload: {
            text: "retained",
            files: [],
            images: [],
            identity: {},
            fingerprint: "fixture",
          },
        },
      ],
    });
    runtime.register("target", {
      directory,
      ready: async () => false,
      delivered: async () => {
        began.resolve();
        return proof.promise;
      },
      handoff: async () => {},
    });
    await began.promise;
    let stopped = false;
    const shutdown = runtime.stop().then(() => {
      stopped = true;
      return undefined;
    });
    await new Promise<void>((complete) => setImmediate(complete));
    expect(stopped).toBe(false);
    proof.resolve(true);
    await shutdown;
    expect(JSON.parse(await readFile(path.join(directory, "queue.json"), "utf8")).items).toEqual(
      [],
    );
    await expect(
      runtime.command("target", { action: "fetch" }, { ownsUpload: () => false }),
    ).rejects.toThrow("shutting down");
  } finally {
    proof.resolve(true);
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown joins explicit send-now commands before fixture files can be removed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "queue-stop-command-"));
  const handoff = deferred<void>();
  const began = deferred<void>();
  const runtime = new InputQueueRuntime(pino({ level: "silent" }));
  let delivered = false;
  try {
    runtime.register("target", {
      directory,
      ready: async () => false,
      delivered: async () => delivered,
      handoff: async () => {
        began.resolve();
        await handoff.promise;
        delivered = true;
      },
    });
    const admitted = await runtime.command(
      "target",
      { action: "enqueue", id: "input", text: "queued" },
      { ownsUpload: () => false },
    );
    const sending = runtime.command(
      "target",
      { action: "send_now", id: "input", revision: admitted.queue.revision },
      { ownsUpload: () => false },
    );
    await began.promise;
    let stopped = false;
    const shutdown = runtime.stop().then(() => {
      stopped = true;
      return undefined;
    });
    await new Promise<void>((complete) => setImmediate(complete));
    expect(stopped).toBe(false);
    handoff.resolve();
    await Promise.all([sending, shutdown]);
    expect(JSON.parse(await readFile(path.join(directory, "queue.json"), "utf8")).items).toEqual(
      [],
    );
  } finally {
    handoff.resolve();
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
