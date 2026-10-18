import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import {
  attachSessionFiles,
  resolveLinkedSessionFile,
  pruneSessionDrafts,
} from "../file-upload/session-files.js";
import { registerChatInputQueue } from "../chats/chat-input-queue.js";
import type { ChatStore } from "../chats/chat-store.js";
import type { ChatEngine } from "../chats/chat-engine.js";
import type { TranscriptLog } from "../chats/transcript-log.js";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { prepareQueueFiles } from "./files.js";
import { InputQueueRuntime } from "./runtime.js";
import { AgentInputQueues } from "./agent-runtime.js";

const logger = pino({ level: "silent" });
async function admittedHistory(directory: string, source: string) {
  await mkdir(source, { recursive: true });
  const original = path.join(source, "note.txt");
  await writeFile(original, "retained fork bytes");
  const linked = await attachSessionFiles({
    directory: source,
    messageId: "original",
    attachments: [
      {
        type: "uploaded_file",
        id: "original-file",
        fileName: "note.txt",
        mimeType: "text/plain",
        size: 19,
        path: original,
      },
    ],
    ownsUpload: () => true,
  });
  const content = await prepareQueueFiles({
    directory,
    text: "Queued history",
    files: {
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          text: path.join(source, linked.links.files[0].relativePath),
          sourceSession: { agentId: "authorized-source", epoch: "observed", seq: 1 },
        },
      ],
    },
    ownsUpload: () => false,
    resolveForkSource: async () => ({
      directory: source,
      messageIds: (async function* () {
        yield "original";
      })(),
    }),
    identity: { actor: { kind: "user", id: "fixture-owner" } },
    fingerprint: "fixture",
  });
  await writeJsonFileAtomic(path.join(directory, "queue.json"), {
    version: 1,
    revision: 1,
    items: [
      {
        id: "queued-history",
        senderId: "owner",
        createdAt: "fixture",
        state: "queued",
        payload: content,
      },
    ],
  });
  await writeFile(original, "changed original");
  await rm(source, { recursive: true });
  return content;
}
async function verifyTransferred(
  directory: string,
  files: Awaited<ReturnType<typeof admittedHistory>>["files"],
) {
  const links = JSON.parse(
    await readFile(
      path.join(
        directory,
        "uploads",
        ".messages",
        `${createHash("sha256").update("queued-history").digest("hex")}.json`,
      ),
      "utf8",
    ),
  );
  expect(links.forkSources).toEqual([{ agentId: "authorized-source", epoch: "observed", seq: 1 }]);
  await pruneSessionDrafts(directory, Date.now() + 48 * 60 * 60 * 1000);
  for (const file of files) {
    const location = path.join(directory, file.relativePath);
    expect(await readFile(location, "utf8")).toBe("retained fork bytes");
    expect((await resolveLinkedSessionFile(directory, location)).id).toBe(file.id);
  }
}

test("session queue handoff transfers authorized retained fork bytes after original removal", async () => {
  const daemon = await createTestClisbotDaemon({
    agentSessionStorage: true,
    hostInputQueue: false,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  let queues: AgentInputQueues | undefined;
  try {
    await client.connect();
    const agent = await client.createAgent({ provider: "codex", cwd: daemon.staticDir });
    const directory = await daemon.daemon.agentStorage.getSessionDirectory(agent.id);
    const content = await admittedHistory(directory, path.join(daemon.staticDir, "source"));
    queues = new AgentInputQueues({
      manager: daemon.daemon.agentManager,
      storage: daemon.daemon.agentStorage,
      logger,
    });
    await queues.ready;
    const runtime = queues.runtime;
    await expect
      .poll(
        async () =>
          (await runtime.command(agent.id, { action: "fetch" }, { ownsUpload: () => false })).queue
            .items,
        { timeout: 15000 },
      )
      .toEqual([]);
    expect(
      await daemon.daemon.agentManager.hasDurableSubmittedMessage(agent.id, "queued-history"),
    ).toBe(true);
    await verifyTransferred(directory, content.files);
  } finally {
    await queues?.stop();
    await client.close();
    await daemon.close();
  }
});

test("Chat queue retains fork ownership and actor through handoff and accepted recovery", async () => {
  const daemon = await createTestClisbotDaemon({ hostInputQueue: false });
  const runtime = new InputQueueRuntime(logger);
  const recovered = new InputQueueRuntime(logger);
  try {
    const directory = path.join(daemon.staticDir, "chat");
    await mkdir(directory);
    const content = await admittedHistory(directory, path.join(daemon.staticDir, "source"));
    let accepted = false;
    let preparations = 0;
    const engine = {
      busy: () => false,
      send: async (input: Parameters<ChatEngine["send"]>[0]) => {
        expect(input.actor).toEqual(content.identity.actor);
        if (input.prepareFiles) {
          const result = await input.prepareFiles(directory, input.messageId!, input);
          expect(result.attachments?.[0]).toMatchObject({
            sourceSession: { agentId: "authorized-source" },
          });
          preparations += 1;
          accepted = true;
        }
      },
    } as unknown as ChatEngine;
    const registration = {
      queues: runtime,
      engine,
      agentManager: daemon.daemon.agentManager,
      store: {
        directory: () => directory,
        require: async () => ({ participants: [] }),
      } as unknown as ChatStore,
      transcriptOf: () =>
        ({
          findById: async () => (accepted ? { id: "queued-history" } : null),
        }) as unknown as TranscriptLog,
    };
    registerChatInputQueue(registration, "chat");
    await expect
      .poll(
        async () =>
          (await runtime.command("chat", { action: "fetch" }, { ownsUpload: () => false })).queue
            .items,
      )
      .toEqual([]);
    expect(accepted).toBe(true);
    await verifyTransferred(directory, content.files);
    await runtime.stop();
    await writeJsonFileAtomic(path.join(directory, "queue.json"), {
      version: 1,
      revision: 4,
      items: [
        {
          id: "queued-history",
          senderId: "owner",
          createdAt: "fixture",
          state: "sending",
          payload: content,
        },
      ],
    });
    registerChatInputQueue({ ...registration, queues: recovered }, "chat");
    await expect
      .poll(
        async () =>
          (await recovered.command("chat", { action: "fetch" }, { ownsUpload: () => false })).queue
            .items,
      )
      .toEqual([]);
    expect(preparations).toBe(1);
  } finally {
    await runtime.stop();
    await recovered.stop();
    await daemon.close();
  }
});
