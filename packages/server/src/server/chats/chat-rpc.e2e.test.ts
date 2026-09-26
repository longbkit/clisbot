import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

test("real socket: bot homes, direct and group transcripts, mentions and restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bots-rpc-"));
  const options = {
    paseoHomeRoot: root,
    cleanup: false,
    agentSessionStorage: true,
    bots: { enabled: true, root: path.join(root, "homes") },
  };
  let daemon = await createTestPaseoDaemon(options);
  let client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const updates: import("../messages.js").SessionOutboundMessage[] = [];
    const events = client.observeEvents([
      "bot.updated",
      "chat.updated",
      "chat.transcript.appended",
    ]);
    events.subscribe({ snapshot: () => {}, update: (message) => updates.push(message) });
    await events.ready;
    const a = await client.createBot({
      name: "Analyst",
      kind: "team",
      launch: { provider: "claude" },
    });
    const b = await client.createBot({
      name: "Writer",
      kind: "personal",
      launch: { provider: "claude" },
    });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const analyst = a.bot!;
    const writer = b.bot!;
    await access(path.join(analyst.cwd, "AGENTS.md"));
    const direct = await client.createChat({ botIds: [analyst.id] });
    expect(direct.error).toBeNull();
    const sent = await client.sendChatMessage({
      chatId: direct.chat!.id,
      text: "hello",
      messageId: "direct-1",
    });
    expect(sent.error).toBeNull();
    await expect
      .poll(
        async () => (await client.fetchChatTranscript({ chatId: direct.chat!.id })).lines.length,
      )
      .toBe(2);
    const duplicate = await client.sendChatMessage({
      chatId: direct.chat!.id,
      text: "hello",
      messageId: "direct-1",
    });
    expect(duplicate.duplicate).toBe(true);
    const group = await client.createChat({ botIds: [analyst.id, writer.id] });
    expect(group.error).toBeNull();
    const mentioned = await client.sendChatMessage({
      chatId: group.chat!.id,
      text: `@${analyst.slug} report`,
    });
    expect(mentioned.targets).toEqual([analyst.id]);
    await expect
      .poll(async () => (await client.fetchChatTranscript({ chatId: group.chat!.id })).lines.length)
      .toBe(2);
    const all = await client.sendChatMessage({ chatId: group.chat!.id, text: "both respond" });
    expect(all.targets.sort()).toEqual([analyst.id, writer.id].sort());
    await expect
      .poll(async () => (await client.fetchChatTranscript({ chatId: group.chat!.id })).lines.length)
      .toBe(5);
    await expect
      .poll(
        () =>
          updates.filter(
            (message) =>
              message.type === "chat.transcript.appended" &&
              message.payload.chatId === group.chat!.id,
          ).length,
      )
      .toBe(5);
    expect(
      updates.some(
        (message) =>
          message.type === "chat.updated" &&
          message.payload.chat.id === group.chat!.id &&
          message.payload.chat.participants.every((participant) => participant.agentId),
      ),
    ).toBe(true);
    await events.release();
    const before = await client.fetchChatTranscript({ chatId: group.chat!.id });
    await client.close();
    await daemon.close();
    daemon = await createTestPaseoDaemon(options);
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    expect((await client.listBots()).bots).toHaveLength(2);
    expect((await client.listChats()).chats).toHaveLength(2);
    expect((await client.fetchChatTranscript({ chatId: group.chat!.id })).lines).toEqual(
      before.lines,
    );
    expect(
      (await client.resetChatSession({ chatId: group.chat!.id, botId: analyst.id })).error,
    ).toBeNull();
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
