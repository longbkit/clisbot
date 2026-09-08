// Fusion test: the Hub drive surface (`plugin.outbound.*`) over the ported
// OpenClaw Discord send path, driven against a fake Discord REST transport.
//
// The seam is upstream's own: `RequestClient` takes a `fetch`, so these cases
// exercise the real `sendMessageDiscord` / `editMessageDiscord` /
// `sendTypingDiscord` closure — routing, multipart upload, receipts — and only
// the socket is faked.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostRuntime, KeyedStoreEntry } from "@getpaseo/channels-shared";
import { DISCORD_MAX_MEDIA_BYTES } from "@getpaseo/channels-shared";
import { RequestClient } from "./internal/rest.js";
import { discordTyping, sendMedia, sendText, updateText } from "./outbound.js";
import { setChannelHostRuntime } from "./runtime-store.js";

const CHANNEL_ID = "400000000000000004";

type Recorded = { method: string; url: string; body: string | null; multipart: boolean };

function fakeRest(): { rest: RequestClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const rest = new RequestClient("test-token", {
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const rawBody = init?.body;
      calls.push({
        method,
        url,
        body: typeof rawBody === "string" ? rawBody : null,
        multipart: typeof FormData !== "undefined" && rawBody instanceof FormData,
      });
      if (method === "POST" && url.includes("/typing")) {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ id: "700000000000000007", channel_id: CHANNEL_ID }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  return { rest, calls };
}

function hostRuntime(): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: false }),
    state: {
      openKeyedStore: () => ({
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => true,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => false,
        entries: async () => [] as KeyedStoreEntry<unknown>[],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  };
}

const cfg = {
  channels: { discord: { accounts: { main: { token: "test-token" } } } },
} as Record<string, unknown>;

let workDir: string;

beforeEach(() => {
  setChannelHostRuntime(hostRuntime());
  workDir = mkdtempSync(join(tmpdir(), "discord-outbound-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("plugin.outbound.sendText", () => {
  it("posts to the conversation and returns the native message id", async () => {
    const { rest, calls } = fakeRest();
    const result = await sendText({
      cfg,
      accountId: "main",
      to: CHANNEL_ID,
      text: "hello from the hub",
      rest,
    });
    expect(result.messageId).toBe("700000000000000007");
    expect(result["channelId"]).toBe(CHANNEL_ID);
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toContain(`/channels/${CHANNEL_ID}/messages`);
    expect(JSON.parse(post!.body!)).toMatchObject({ content: "hello from the hub" });
  });

  it("routes the post into the thread when the Hub names one", async () => {
    const { rest, calls } = fakeRest();
    await sendText({
      cfg,
      accountId: "main",
      to: CHANNEL_ID,
      threadId: "600000000000000006",
      text: "in-thread",
      rest,
    });
    // A Discord thread IS a channel: the thread id becomes the target channel.
    expect(calls.find((call) => call.method === "POST")?.url).toContain(
      "/channels/600000000000000006/messages",
    );
  });

  it("refuses an unusable target instead of posting somewhere else", async () => {
    const { rest } = fakeRest();
    await expect(
      sendText({ cfg, accountId: "main", to: "", text: "nowhere", rest }),
    ).rejects.toThrow(/Discord recipient is required/u);
  });
});

describe("plugin.outbound.sendMedia", () => {
  it("uploads a local file as a native attachment", async () => {
    const { rest, calls } = fakeRest();
    const filePath = join(workDir, "report.pdf");
    writeFileSync(filePath, "%PDF-1.4 fake");
    const result = await sendMedia({
      cfg,
      accountId: "main",
      to: CHANNEL_ID,
      filePath,
      caption: "the report",
      rest,
    });
    expect(result.mediaPosted).toBe(true);
    expect(result.messageId).toBe("700000000000000007");
    const post = calls.find((call) => call.method === "POST");
    // The ported sender switches to a multipart body once a file is attached.
    expect(post?.multipart).toBe(true);
  });

  it("posts the size notice through the text path instead of dropping the file", async () => {
    const { rest, calls } = fakeRest();
    const filePath = join(workDir, "huge.bin");
    writeFileSync(filePath, Buffer.alloc(DISCORD_MAX_MEDIA_BYTES + 1));
    const result = await sendMedia({
      cfg,
      accountId: "main",
      to: CHANNEL_ID,
      filePath,
      rest,
    });
    expect(result.mediaPosted).toBe(false);
    expect(result.messageId).toBe("700000000000000007");
    const post = calls.find((call) => call.method === "POST");
    expect(JSON.parse(post!.body!).content).toMatch(/Could not post media huge\.bin: too large/u);
  });

  it("throws for a missing local file so the Hub can fail the delivery", async () => {
    const { rest } = fakeRest();
    await expect(
      sendMedia({ cfg, accountId: "main", to: CHANNEL_ID, filePath: join(workDir, "gone"), rest }),
    ).rejects.toThrow(/local media file not found/u);
  });
});

describe("plugin.outbound.updateText and typing", () => {
  it("edits in place and clears the components by default", async () => {
    const { rest, calls } = fakeRest();
    const result = await updateText({
      cfg,
      accountId: "main",
      to: CHANNEL_ID,
      text: "approved",
      externalMessageId: "700000000000000007",
      rest,
    });
    expect(result).toEqual({ ok: true });
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toContain(`/channels/${CHANNEL_ID}/messages/700000000000000007`);
    expect(JSON.parse(patch!.body!)).toMatchObject({ content: "approved" });
  });

  it("posts the typing indicator to the target channel", async () => {
    const { rest, calls } = fakeRest();
    await discordTyping({ cfg, accountId: "main", to: CHANNEL_ID, rest });
    expect(calls.some((call) => call.url.endsWith(`/channels/${CHANNEL_ID}/typing`))).toBe(true);
  });
});
