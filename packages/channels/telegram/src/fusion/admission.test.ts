// Slice 20: the admission step (media fold → Hub handoff). Migrated from the
// retired `transport/poll.test.ts` group-G cases (G1/G5/G6/G11), plus the
// multi-file media-group case the old transport could not express.

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import type { Message } from "grammy/types";
import { clearTelegramRuntimeForTest } from "../runtime.test-support.js";
import { buildTelegramAdmission } from "./admission.js";
import { buildTelegramMessageEvent, type TelegramInboundBuild } from "./inbound-adapter.js";
import { hasProviderObservedTelegramThreadBinding } from "./message-thread-observation.js";
import { installMemoryTelegramRuntime } from "./test-support.js";

const BOT_TOKEN = "123456789:TEST-TOKEN";
const PARAMS = { accountId: "acct", botId: 123_456_789, botUsername: "longluong3bot" };
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tg-admit-"));
  dirs.push(dir);
  return dir;
}

/** Answers `getFile` (keying off the file id in the URL) and the file stream;
 * `fileOk` controls whether the stream succeeds. */
function mediaFetch(fileOk: boolean): typeof globalThis.fetch {
  return (async (url: string | URL | Request) => {
    const urlText = String(url);
    if (urlText.includes("/getFile")) {
      const ok = fileOk || urlText.includes("good");
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: ok ? "files/good" : "files/bad" } }),
        { status: 200 },
      );
    }
    const isBad = urlText.includes("files/bad");
    return new Response(isBad ? "gone" : "media-bytes", { status: isBad ? 404 : 200 });
  }) as unknown as typeof globalThis.fetch;
}

function message(messageId: number, extra: Record<string, unknown>): Message {
  return {
    message_id: messageId,
    date: 1_700_000_000,
    chat: { id: -100_000_000_001, type: "supergroup", title: "Test Group" },
    from: { id: 42, is_bot: false, first_name: "Human" },
    ...extra,
  } as unknown as Message;
}

function build(messages: Message[]): TelegramInboundBuild {
  const result = buildTelegramMessageEvent(messages, 1, PARAMS);
  if (result === null) throw new Error("expected a build");
  return result;
}

async function admitOnce(options: {
  messages: Message[];
  downloadDir?: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<ChannelInboundEvent | null> {
  const seen: ChannelInboundEvent[] = [];
  const admit = buildTelegramAdmission({
    accountId: "acct",
    botToken: BOT_TOKEN,
    apiRoot: "https://api.telegram.org",
    abortSignal: new AbortController().signal,
    ...(options.downloadDir === undefined ? {} : { downloadDir: options.downloadDir }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    handleInbound: async (event) => {
      seen.push(event);
    },
  });
  await admit(build(options.messages));
  return seen[0] ?? null;
}

describe("telegram inbound admission", () => {
  it("folds caption + two attachments into the body, files land on disk (G1/G5)", async () => {
    const dir = await makeDir();
    const event = await admitOnce({
      downloadDir: dir,
      fetchImpl: mediaFetch(true),
      messages: [
        message(30, {
          caption: "describe these",
          photo: [
            { file_id: "small", file_unique_id: "s", file_size: 10, width: 1, height: 1 },
            { file_id: "large", file_unique_id: "l", file_size: 90, width: 2, height: 2 },
          ],
          document: { file_id: "doc", file_unique_id: "d", file_name: "notes.txt", file_size: 11 },
        }),
      ],
    });
    expect(event?.body).toBe(
      `describe these\n\n[Attached files]\n` +
        `1. photo (photo, 11 bytes) → ${join(dir, "30-1-photo.jpg")}\n` +
        `2. notes.txt (document, 11 bytes) → ${join(dir, "30-2-notes.txt")}`,
    );
    await stat(join(dir, "30-1-photo.jpg"));
    await stat(join(dir, "30-2-notes.txt"));
  });

  it("admits a media-only message: body is the manifest alone (G6)", async () => {
    const dir = await makeDir();
    const event = await admitOnce({
      downloadDir: dir,
      fetchImpl: mediaFetch(true),
      messages: [
        message(31, {
          photo: [{ file_id: "p", file_unique_id: "u", file_size: 11, width: 1, height: 1 }],
        }),
      ],
    });
    expect(event?.body).toBe(
      `[Attached files]\n1. photo (photo, 11 bytes) → ${join(dir, "31-1-photo.jpg")}`,
    );
  });

  it("keeps an attachment-less media-only event body empty (G6: the Hub drops it)", async () => {
    // No download dir AND no manifest: the event body stays "".
    const event = await admitOnce({
      messages: [message(32, { video: { file_id: "v", file_unique_id: "vu" } })],
    });
    expect(event?.body).toBe("");
  });

  it("admits nothing when every attachment fails (G11 floor)", async () => {
    const dir = await makeDir();
    const event = await admitOnce({
      downloadDir: dir,
      fetchImpl: mediaFetch(false),
      messages: [
        message(33, {
          photo: [{ file_id: "bad", file_unique_id: "b", file_size: 11, width: 1, height: 1 }],
        }),
      ],
    });
    expect(event).toBeNull();
  });

  it("folds every file of a media group into ONE manifest, in arrival order", async () => {
    const dir = await makeDir();
    const event = await admitOnce({
      downloadDir: dir,
      fetchImpl: mediaFetch(true),
      messages: [
        message(40, {
          media_group_id: "mg-1",
          caption: "album",
          photo: [{ file_id: "a", file_unique_id: "au", file_size: 11, width: 1, height: 1 }],
        }),
        message(41, {
          media_group_id: "mg-1",
          photo: [{ file_id: "b", file_unique_id: "bu", file_size: 11, width: 1, height: 1 }],
        }),
        message(42, {
          media_group_id: "mg-1",
          document: { file_id: "c", file_unique_id: "cu", file_name: "spec.pdf", file_size: 11 },
        }),
      ],
    });
    expect(event?.body).toBe(
      `album\n\n[Attached files]\n` +
        `1. photo (photo, 11 bytes) → ${join(dir, "40-1-photo.jpg")}\n` +
        `2. photo (photo, 11 bytes) → ${join(dir, "41-2-photo.jpg")}\n` +
        `3. spec.pdf (document, 11 bytes) → ${join(dir, "42-3-spec.pdf")}`,
    );
    await stat(join(dir, "40-1-photo.jpg"));
    await stat(join(dir, "41-2-photo.jpg"));
    await stat(join(dir, "42-3-spec.pdf"));
  });

  it("propagates a Hub admission failure so the transport can retry", async () => {
    const admit = buildTelegramAdmission({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      abortSignal: new AbortController().signal,
      handleInbound: async () => {
        throw new Error("queue write failed");
      },
    });
    await expect(admit(build([message(50, { text: "hi" })]))).rejects.toThrow(/queue write failed/);
  });
});

describe("provider-observed thread binding (D-TG-031)", () => {
  it("answers yes only for a message the provider showed us in that topic", async () => {
    installMemoryTelegramRuntime();
    try {
      const admit = buildTelegramAdmission({
        accountId: "acct",
        botToken: BOT_TOKEN,
        apiRoot: "https://api.telegram.org",
        abortSignal: new AbortController().signal,
        botId: PARAMS.botId,
        handleInbound: async () => undefined,
      });
      await admit(
        build([
          message(60, {
            text: "in topic 7",
            message_thread_id: 7,
            is_topic_message: true,
            chat: { id: -100_000_000_001, type: "supergroup", is_forum: true, title: "Forum" },
          }),
        ]),
      );
      await expect(
        hasProviderObservedTelegramThreadBinding({
          accountId: "acct",
          chatId: "-100000000001",
          messageId: "60",
          threadId: 7,
        }),
      ).resolves.toBe(true);
      // Same message, different topic → upstream's deny branch.
      await expect(
        hasProviderObservedTelegramThreadBinding({
          accountId: "acct",
          chatId: "-100000000001",
          messageId: "60",
          threadId: 8,
        }),
      ).resolves.toBe(false);
      // A message nobody observed → deny.
      await expect(
        hasProviderObservedTelegramThreadBinding({
          accountId: "acct",
          chatId: "-100000000001",
          messageId: "61",
          threadId: 7,
        }),
      ).resolves.toBe(false);
    } finally {
      clearTelegramRuntimeForTest();
    }
  });
});
