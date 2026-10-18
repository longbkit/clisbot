import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

for (const surface of ["agent", "direct", "group"] as const) {
  test(`${surface}: Host owns accepted text/files, concurrent edits, app closure and handoff`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), `input-queue-${surface}-`));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNext = true;
    let held = false;
    const daemon = await createTestClisbotDaemon({
      clisbotHomeRoot: root,
      agentSessionStorage: true,
      bots: { enabled: true, root: path.join(root, "homes") },
      agentClients: createTestAgentClients({
        beforeTurnComplete: async () => {
          if (holdNext) {
            holdNext = false;
            held = true;
            await gate;
          }
        },
      }),
    });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    const second = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    try {
      await client.connect();
      await second.connect();
      let agentId: string | undefined;
      let chatId: string | undefined;
      if (surface === "agent") {
        agentId = (await client.createAgent({ provider: "codex", cwd: daemon.staticDir })).id;
        await client.sendAgentMessage(agentId, "Hold the first turn", { messageId: "first-turn" });
      } else {
        const bot = (
          await client.createBot({ name: "Queue fixture", launch: { provider: "codex" } })
        ).bot!;
        const result = await client.createChat({
          botIds: [bot.id],
          kind: surface,
          rules: { rounds: { max: 1 } },
        });
        expect(result.error).toBeNull();
        chatId = result.chat!.id;
        expect(
          (
            await client.sendChatMessage({
              chatId,
              text: "Hold the first discussion",
              messageId: "first-turn",
            })
          ).error,
        ).toBeNull();
      }
      await expect.poll(() => held).toBe(true);
      const target = (
        connection: DaemonClient,
        command: Parameters<DaemonClient["executeAgentQueueCommand"]>[0]["command"],
      ) =>
        agentId
          ? connection.executeAgentQueueCommand({ agentId, command })
          : connection.executeChatQueueCommand({ chatId: chatId!, command });
      const uploaded = await client.uploadFile({
        fileName: "note.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("durable file bytes"),
      });
      expect(uploaded.error).toBeNull();
      const content = {
        id: "queued-a",
        text: "",
        attachments: [uploaded.file!],
        images: [{ data: Buffer.from("image bytes").toString("base64"), mimeType: "image/png" }],
      };
      const accepted = await target(client, { action: "enqueue", ...content });
      expect(accepted.error).toBeNull();
      expect(accepted.queue!.items.map((item) => item.id)).toEqual(["queued-a"]);
      expect((await target(client, { action: "enqueue", ...content })).queue!.revision).toBe(
        accepted.queue!.revision,
      );
      const queueFile = agentId
        ? path.join(await daemon.daemon.agentStorage.getSessionDirectory(agentId), "queue.json")
        : path.join(daemon.clisbotHome, "chats", chatId!, "queue.json");
      const disk = JSON.parse(await readFile(queueFile, "utf8"));
      expect(JSON.stringify(disk)).not.toContain(content.images[0].data);
      const durable = accepted.queue!.items[0].attachments!.find(
        (item) => item.type === "uploaded_file",
      )!;
      if (durable.type !== "uploaded_file") throw new Error("Expected file");
      expect(await readFile(durable.path, "utf8")).toBe("durable file bytes");
      const copied = await target(second, {
        action: "read_file",
        id: "queued-a",
        fileId: durable.id,
        offset: 0,
      });
      expect(copied.error).toBeNull();
      expect(Buffer.from(copied.fileChunk!.data, "base64").toString()).toBe("durable file bytes");
      expect(copied.fileChunk!.done).toBe(true);
      expect(
        (
          await target(second, {
            action: "read_file",
            id: "queued-a",
            fileId: "arbitrary-file",
            offset: 0,
          })
        ).error,
      ).toBeTruthy();
      expect((await target(second, { action: "fetch" })).queue!.revision).toBe(
        accepted.queue!.revision,
      );
      // Device B opens the same item; opening an editor never mutates the Host.
      const onSecond = await target(second, { action: "fetch" });
      expect(onSecond.queue!.revision).toBe(accepted.queue!.revision);
      const edited = await target(second, {
        action: "update",
        id: "queued-a",
        revision: onSecond.queue!.revision,
        text: "Edited input",
        attachments: onSecond.queue!.items[0].attachments,
        images: onSecond.queue!.items[0].images,
      });
      expect(edited.error).toBeNull();
      const conflict = await target(client, {
        action: "delete",
        id: "queued-a",
        revision: accepted.queue!.revision,
      });
      expect(conflict.error).toContain("changed");
      expect(conflict.queue!.items[0].text).toBe("Edited input");
      await client.close(); // Host continues with no submitting app.
      release();
      await expect
        .poll(
          async () =>
            (await target(second, { action: "fetch" })).queue?.items.map((item) => [
              item.id,
              item.state,
              item.reason,
            ]),
          { timeout: 20000 },
        )
        .toEqual([]);
      if (agentId) {
        expect(
          await daemon.daemon.agentManager.hasDurableSubmittedMessage(agentId, "queued-a"),
        ).toBe(true);
      } else {
        const transcript = await second.fetchChatTranscript({ chatId: chatId! });
        expect(transcript.lines.filter((line) => line.id === "queued-a")).toHaveLength(1);
        expect(transcript.lines.find((line) => line.id === "queued-a")!.text).toBe("Edited input");
      }
      expect(await readFile(durable.path, "utf8")).toBe("durable file bytes");
      const stale = await target(second, {
        action: "update",
        id: "queued-a",
        revision: (await target(second, { action: "fetch" })).queue!.revision,
        text: "Never resurrect",
      });
      expect(stale.error).toContain("deleted");
      expect(stale.queue!.items).toEqual([]);
    } finally {
      release();
      await client.close();
      await second.close();
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);
}
