import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { FileAgentTimelineStore } from "../agent/session-storage/file-agent-timeline-store.js";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { AgentInputQueues } from "./agent-runtime.js";

for (const outcome of ["rejected", "accepted", "pending", "applied_without_row"] as const) {
  test(`recovery requires applied submission plus durable row: ${outcome}`, async () => {
    const daemon = await createTestClisbotDaemon({
      agentSessionStorage: true,
      hostInputQueue: false,
    });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    let queues: AgentInputQueues | undefined;
    try {
      await client.connect();
      const agent = await client.createAgent({ provider: "codex", cwd: daemon.staticDir });
      const manager = daemon.daemon.agentManager;
      const durable = (manager as unknown as { durableTimelineStore: FileAgentTimelineStore })
        .durableTimelineStore;
      const session = manager.getAgent(agent.id)!.session;
      const start = vi.spyOn(session, "startTurn");
      if (outcome === "rejected")
        start.mockRejectedValue(new Error("Synthetic generic start rejection"));
      if (outcome === "rejected" || outcome === "accepted") {
        await client
          .sendAgentMessage(agent.id, "Retained queue input", { messageId: "logical" })
          .catch(() => {});
        await expect
          .poll(async () => Boolean(await durable.getSubmittedUserMessage(agent.id, "logical")))
          .toBe(true);
        await expect
          .poll(async () => (await durable.readMessageSubmission(agent.id, "logical"))?.status)
          .toBe(outcome === "accepted" ? "applied" : "pending");
      } else {
        await durable.writeMessageSubmission(agent.id, {
          id: "logical",
          digest: "fixture",
          identity: {},
          timestamp: "fixture",
          status: "pending",
        });
      }
      if (outcome === "applied_without_row") {
        const pending = (await durable.readMessageSubmission(agent.id, "logical"))!;
        await durable.writeMessageSubmission(agent.id, { ...pending, status: "applied" });
      }
      const beforeStarts = start.mock.calls.length;
      const directory = await daemon.daemon.agentStorage.getSessionDirectory(agent.id);
      const retainedFile = {
        id: "held-file",
        fileName: "note.txt",
        mimeType: "text/plain",
        size: 19,
        relativePath: path.join("uploads", "held-file", "note.txt"),
      };
      if (outcome !== "accepted") {
        await mkdir(path.dirname(path.join(directory, retainedFile.relativePath)), {
          recursive: true,
        });
        await writeFile(path.join(directory, retainedFile.relativePath), "retained fork bytes");
      }
      const identity = (await durable.readMessageSubmission(agent.id, "logical"))?.identity ?? {};
      await writeJsonFileAtomic(path.join(directory, "queue.json"), {
        version: 1,
        revision: 1,
        items: [
          {
            id: "logical",
            createdAt: "fixture",
            senderId: "owner",
            state: "sending",
            payload: {
              text: "Retained queue input",
              attachments: [],
              files: outcome === "accepted" ? [] : [retainedFile],
              images: [],
              identity,
              fingerprint: "fixture",
            },
          },
        ],
      });
      queues = new AgentInputQueues({
        manager,
        storage: daemon.daemon.agentStorage,
        logger: pino({ level: "silent" }),
      });
      await queues.ready;
      const recovered = await queues.runtime.command(
        agent.id,
        { action: "fetch" },
        { ownsUpload: () => false },
      );
      expect(recovered.queue.items).toEqual(
        outcome === "accepted"
          ? []
          : [expect.objectContaining({ id: "logical", state: "needs_review" })],
      );
      expect(start.mock.calls.length).toBe(beforeStarts);
      if (outcome !== "accepted")
        expect(await readFile(path.join(directory, retainedFile.relativePath), "utf8")).toBe(
          "retained fork bytes",
        );
    } finally {
      await queues?.stop();
      await client.close();
      await daemon.close();
    }
  });
}
