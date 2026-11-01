import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
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

const ALREADY_ACCEPTED =
  "This message was already accepted. Clear the draft, or change it to send it again.";

for (const surface of ["agent", "direct"] as const) {
  test(`${surface}: a retried enqueue whose first response was lost resolves as accepted, never as a wedge`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), `queue-retry-${surface}-`));
    const daemon = await createTestClisbotDaemon({
      clisbotHomeRoot: root,
      agentSessionStorage: true,
      bots: { enabled: true, root: path.join(root, "homes") },
    });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    try {
      await client.connect();
      let agentId: string | undefined;
      let chatId: string | undefined;
      if (surface === "agent") {
        agentId = (await client.createAgent({ provider: "codex", cwd: daemon.staticDir })).id;
      } else {
        const bot = (
          await client.createBot({ name: "Retry fixture", launch: { provider: "codex" } })
        ).bot!;
        chatId = (
          await client.createChat({
            botIds: [bot.id],
            kind: surface,
            rules: { rounds: { max: 1 } },
          })
        ).chat!.id;
      }
      const execute = (
        command: Parameters<DaemonClient["executeAgentQueueCommand"]>[0]["command"],
      ) =>
        agentId
          ? client.executeAgentQueueCommand({ agentId, command })
          : client.executeChatQueueCommand({ chatId: chatId!, command });
      const uploaded = await client.uploadFile({
        fileName: "note.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("reference notes"),
      });
      const content = {
        id: "lost-response",
        text: "Compare these references",
        attachments: [uploaded.file!],
        images: [
          { data: Buffer.from("first image").toString("base64"), mimeType: "image/png" },
          { data: Buffer.from("second image").toString("base64"), mimeType: "image/webp" },
        ],
      };
      expect((await execute({ action: "enqueue", ...content })).error).toBeNull();
      await expect
        .poll(async () => (await execute({ action: "fetch" })).queue?.items, { timeout: 20000 })
        .toEqual([]);
      // The app never saw the first response and retries the same draft.
      const retried = await execute({ action: "enqueue", ...content });
      expect({ error: retried.error, items: retried.queue?.items }).toEqual({
        error: null,
        items: [],
      });
      // The same draft with its images prepared again into other bytes.
      const reencoded = await execute({
        action: "enqueue",
        ...content,
        images: [
          { data: Buffer.from("first image, smaller").toString("base64"), mimeType: "image/jpeg" },
        ],
      });
      expect({
        error: reencoded.error,
        errorCode: reencoded.errorCode,
        items: reencoded.queue?.items,
      }).toEqual({
        error: ALREADY_ACCEPTED,
        errorCode: "already_accepted",
        items: [],
      });
    } finally {
      await client.close();
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);
}

test("a draft still waiting in the queue, prepared again into other bytes, stays one item", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const daemon = await createTestClisbotDaemon({
    agentSessionStorage: true,
    agentClients: createTestAgentClients({ beforeTurnComplete: () => gate }),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const agent = await client.createAgent({ provider: "codex", cwd: daemon.staticDir });
    await client.sendAgentMessage(agent.id, "Hold the turn", { messageId: "running" });
    const image = (text: string) => ({
      data: Buffer.from(text).toString("base64"),
      mimeType: "image/jpeg",
    });
    const enqueue = (images: { data: string; mimeType: string }[]) =>
      client.executeAgentQueueCommand({
        agentId: agent.id,
        command: { action: "enqueue", id: "waiting", text: "Compare", images },
      });
    expect((await enqueue([image("first bytes")])).error).toBeNull();
    const retried = await enqueue([image("other bytes")]);
    expect({
      error: retried.error,
      errorCode: retried.errorCode,
      ids: retried.queue?.items.map((item) => item.id),
    }).toEqual({ error: ALREADY_ACCEPTED, errorCode: "already_accepted", ids: ["waiting"] });
  } finally {
    release();
    await client.close();
    await daemon.close();
  }
}, 60000);
