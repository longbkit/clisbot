import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

async function sessionDirectory(home: string, id: string): Promise<string> {
  const root = path.join(home, "agents");
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) {
      const directory = path.join(root, entry.name, id);
      try {
        await readFile(path.join(directory, "session.json"));
        return directory;
      } catch {}
    }
  throw new Error("Fixture session directory missing");
}
for (const surface of ["agent", "direct", "group"] as const) {
  test(`${surface}: SIGKILL preserves queued bytes and recovery never replays an uncertain claim`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), `queue-crash-${surface}-`));
    await mkdir(path.join(root, "static"));
    const child = fork(
      fileURLToPath(new URL("../test-utils/queue-crash-host.ts", import.meta.url)),
      [root],
      { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let stderr = "";
    child.stderr!.on("data", (data) => {
      stderr += String(data);
    });
    let client: DaemonClient | undefined;
    let restarted: Awaited<ReturnType<typeof createTestClisbotDaemon>> | undefined;
    try {
      const boot = await Promise.race([
        once(child, "message", { signal: AbortSignal.timeout(20_000) }).then(
          ([message]) => message as { port: number },
        ),
        once(child, "exit").then(() => {
          throw new Error(`Fixture host exited: ${stderr}`);
        }),
      ]);
      client = new DaemonClient({ url: `ws://127.0.0.1:${boot.port}/ws` });
      await client.connect();
      let agentId: string | undefined;
      let chatId: string | undefined;
      if (surface === "agent") {
        agentId = (await client.createAgent({ provider: "codex", cwd: path.join(root, "static") }))
          .id;
        await client.sendAgentMessage(agentId, "Hold active turn", { messageId: "hold" });
      } else {
        const bot = (
          await client.createBot({ name: "Crash fixture", launch: { provider: "codex" } })
        ).bot!;
        chatId = (
          await client.createChat({
            botIds: [bot.id],
            kind: surface,
            rules: { rounds: { max: 1 } },
          })
        ).chat!.id;
        await client.sendChatMessage({ chatId, text: "Hold discussion", messageId: "hold" });
        await expect
          .poll(
            async () =>
              (await client!.listChats()).chats.find((c) => c.id === chatId)?.participants[0]
                .agentId,
          )
          .toBeTruthy();
      }
      const command = {
        action: "enqueue" as const,
        id: "after-crash",
        text: "Accepted before SIGKILL",
        images: [
          { data: Buffer.from("restart-image-bytes").toString("base64"), mimeType: "image/png" },
        ],
      };
      const accepted = agentId
        ? await client.executeAgentQueueCommand({ agentId, command })
        : await client.executeChatQueueCommand({ chatId: chatId!, command });
      expect(accepted.error).toBeNull();
      expect(accepted.queue!.items[0].state).toBe("queued");
      const home = path.join(root, ".clisbot");
      const directory = agentId
        ? await sessionDirectory(home, agentId)
        : path.join(home, "chats", chatId!);
      const queueFile = path.join(directory, "queue.json");
      const second = {
        action: "enqueue" as const,
        id: "queued-after-unknown",
        text: "Run after explicit disposition",
      };
      const next = agentId
        ? await client.executeAgentQueueCommand({ agentId, command: second })
        : await client.executeChatQueueCommand({ chatId: chatId!, command: second });
      expect(next.error).toBeNull();
      const before = JSON.parse(await readFile(queueFile, "utf8"));
      // A process may die with a temp snapshot on disk; only queue.json is canonical.
      await writeFile(
        path.join(directory, ".queue.json.crash.tmp"),
        JSON.stringify({ ...before, items: [{ ...before.items[0], id: "uncommitted-ghost" }] }),
      );
      const stopped = once(child, "exit");
      child.kill("SIGKILL");
      await stopped;
      await client.close();
      // Simulate death after persisted claim, before durable handoff. Missing proof must block FIFO.
      const uncertain = structuredClone(before);
      uncertain.revision++;
      uncertain.items[0].state = "sending";
      await writeFile(queueFile, JSON.stringify(uncertain));
      restarted = await createTestClisbotDaemon({
        clisbotHomeRoot: root,
        staticDir: path.join(root, "static"),
        cleanup: false,
        agentSessionStorage: true,
        bots: { enabled: true, root: path.join(root, "homes") },
      });
      client = new DaemonClient({ url: `ws://127.0.0.1:${restarted.port}/ws` });
      await client.connect();
      const fetch = () =>
        agentId
          ? client!.executeAgentQueueCommand({ agentId, command: { action: "fetch" } })
          : client!.executeChatQueueCommand({ chatId: chatId!, command: { action: "fetch" } });
      await expect.poll(async () => (await fetch()).queue?.items[0]?.state).toBe("needs_review");
      expect((await fetch()).queue!.items[0].images).toEqual(command.images);
      const stored = JSON.parse(await readFile(queueFile, "utf8"));
      expect(stored.items).toHaveLength(2);
      expect(stored.items[0].state).toBe("needs_review");
      if (agentId)
        expect(
          await restarted.daemon.agentManager.hasDurableSubmittedMessage(agentId, command.id),
        ).toBe(false);
      else
        expect(
          (await client.fetchChatTranscript({ chatId: chatId! })).lines.some(
            (line) => line.id === command.id,
          ),
        ).toBe(false);
      // Discard requires a current revision; no unknown item is silently replayed.
      const revision = (await fetch()).queue!.revision;
      const discarded = agentId
        ? await client.executeAgentQueueCommand({
            agentId,
            command: { action: "discard", id: command.id, revision },
          })
        : await client.executeChatQueueCommand({
            chatId: chatId!,
            command: { action: "discard", id: command.id, revision },
          });
      expect(discarded.error).toBeNull();
      await expect
        .poll(
          async () =>
            (await fetch()).queue?.items.map((item) => [item.id, item.state, item.reason]),
          { timeout: 20000 },
        )
        .toEqual([]);
      if (agentId)
        expect(
          await restarted.daemon.agentManager.hasDurableSubmittedMessage(agentId, second.id),
        ).toBe(true);
      else
        expect(
          (await client.fetchChatTranscript({ chatId: chatId! })).lines.filter(
            (line) => line.id === second.id,
          ),
        ).toHaveLength(1);
      const retried = agentId
        ? await client.executeAgentQueueCommand({ agentId, command: second })
        : await client.executeChatQueueCommand({ chatId: chatId!, command: second });
      expect(retried.error).toBeNull();
      expect(retried.queue!.items).toEqual([]);
      const changed = { ...second, text: "Changed content with already submitted identity" };
      const rejected = agentId
        ? await client.executeAgentQueueCommand({ agentId, command: changed })
        : await client.executeChatQueueCommand({ chatId: chatId!, command: changed });
      expect(rejected.error).toBeTruthy();
      // Seed the exact stale snapshot left by death between durable handoff and queue removal.
      // Restart must remove it by the existing owner's proof, without a second turn.
      await client.close();
      await restarted.close();
      const after = JSON.parse(await readFile(queueFile, "utf8"));
      await writeFile(
        queueFile,
        JSON.stringify({
          version: 1,
          revision: after.revision + 1,
          items: [{ ...before.items[1], state: "sending" }],
        }),
      );
      restarted = await createTestClisbotDaemon({
        clisbotHomeRoot: root,
        staticDir: path.join(root, "static"),
        cleanup: false,
        agentSessionStorage: true,
        bots: { enabled: true, root: path.join(root, "homes") },
      });
      client = new DaemonClient({ url: `ws://127.0.0.1:${restarted.port}/ws` });
      await client.connect();
      await expect.poll(async () => (await fetch()).queue?.items).toEqual([]);
      if (!agentId)
        expect(
          (await client.fetchChatTranscript({ chatId: chatId! })).lines.filter(
            (line) => line.id === second.id,
          ),
        ).toHaveLength(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      if (restarted && client?.isConnected) {
        const projects = new Set(
          (await client.fetchWorkspaces()).entries.map((workspace) => workspace.projectId),
        );
        for (const projectId of projects) await client.removeProject(projectId);
      }
      await client?.close();
      await restarted?.close();
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 60000);
}
