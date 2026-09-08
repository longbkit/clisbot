import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { createZaloAdmission } from "./admission.js";
import { setSsrfLookupImplementation } from "./ssrf.js";

function rawEvent(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    event_name: "message.text.received",
    message: {
      message_id: "m-1",
      from: { id: "user-1", name: "User One" },
      chat: { id: "chat-1", chat_type: "PRIVATE" },
      date: 1_700_000_000,
      text: "hello",
      ...overrides,
    },
  });
}

function admission(handleInbound: (event: ChannelInboundEvent) => Promise<unknown>) {
  return createZaloAdmission({
    accountId: "default",
    handleInbound: handleInbound as never,
  });
}

describe("createZaloAdmission.receiveRaw", () => {
  it("reports durable once the event is handed to the queue", async () => {
    const handled: ChannelInboundEvent[] = [];
    const result = await admission(async (event) => {
      handled.push(event);
      return { dispatched: true };
    }).receiveRaw(rawEvent());
    expect(result).toEqual({ kind: "durable" });
    expect(handled[0]).toMatchObject({ externalMessageId: "m-1", body: "hello" });
  });

  it("unwraps the ok/result envelope Zalo may wrap an update in", async () => {
    const wrapped = JSON.stringify({ ok: true, result: JSON.parse(rawEvent()) });
    const result = await admission(async () => ({ dispatched: true })).receiveRaw(wrapped);
    expect(result).toEqual({ kind: "durable" });
  });

  it("answers invalid (never a retry) for a body that can never parse", async () => {
    const handleInbound = vi.fn();
    const target = admission(handleInbound as never);
    await expect(target.receiveRaw("not json")).resolves.toMatchObject({ kind: "invalid" });
    await expect(target.receiveRaw(JSON.stringify({ message: {} }))).resolves.toMatchObject({
      kind: "invalid",
    });
    await expect(
      target.receiveRaw(
        JSON.stringify({
          event_name: "message.text.received",
          message: {
            message_id: "m-1",
            from: { id: "u" },
            chat: { id: "c", chat_type: "SOMETHING" },
            date: 1,
            text: "x",
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "invalid" });
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("propagates a queue failure so the caller can answer 5xx", async () => {
    const target = admission(async () => {
      throw new Error("queue write failed");
    });
    await expect(target.receiveRaw(rawEvent())).rejects.toThrow("queue write failed");
  });

  it("reports ignored for a non-turn update and for a processor drop", async () => {
    const stickerRaw = JSON.stringify({
      event_name: "message.sticker.received",
      message: {
        message_id: "m-2",
        from: { id: "u" },
        chat: { id: "c", chat_type: "PRIVATE" },
        date: 1,
        sticker: "s",
      },
    });
    await expect(
      admission(async () => ({ dispatched: true })).receiveRaw(stickerRaw),
    ).resolves.toEqual({ kind: "ignored", reason: "unsupported-event" });
    await expect(
      admission(async () => ({ dispatched: false, reason: "duplicate" })).receiveRaw(rawEvent()),
    ).resolves.toEqual({ kind: "ignored", reason: "duplicate" });
  });
});

describe("createZaloAdmission.receiveUpdate", () => {
  it("admits an already-parsed polling update", async () => {
    const handled: ChannelInboundEvent[] = [];
    const result = await admission(async (event) => {
      handled.push(event);
      return { dispatched: true };
    }).receiveUpdate({
      event_name: "message.text.received",
      message: {
        message_id: "poll-1",
        from: { id: "user-9" },
        chat: { id: "chat-9", chat_type: "GROUP" },
        date: 1,
        text: "hi",
      },
    });
    expect(result).toEqual({ kind: "durable" });
    expect(handled[0]).toMatchObject({ externalMessageId: "poll-1", chatType: "group" });
  });
});


// Slice 25 (security): `photo_url` is REMOTE INPUT. It arrives on the webhook /
// polling payload, so an unguarded fetch lets a sender aim the Hub's own
// network at itself and then read the response back as an agent attachment.
describe("inbound photo download guards", () => {
  const tmpDirs: string[] = [];

  async function makeDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zalo-admission-"));
    tmpDirs.push(dir);
    return dir;
  }

  function photoEvent(photoUrl: string): string {
    return JSON.stringify({
      event_name: "message.image.received",
      message: {
        message_id: "m-photo",
        from: { id: "user-1", name: "User One" },
        chat: { id: "chat-1", chat_type: "PRIVATE" },
        date: 1_700_000_000,
        text: "look at this",
        photo_url: photoUrl,
      },
    });
  }

  afterEach(async () => {
    setSsrfLookupImplementation(undefined);
    for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("refuses a photo_url that resolves to a private address and downloads nothing", async () => {
    const dir = await makeDir();
    const fetchImpl = vi.fn();
    setSsrfLookupImplementation((async () => [
      { address: "169.254.169.254", family: 4 },
    ]) as never);
    const handled: ChannelInboundEvent[] = [];
    const result = await createZaloAdmission({
      accountId: "default",
      downloadDir: dir,
      fetchImpl: fetchImpl as never,
      handleInbound: (async (event: ChannelInboundEvent) => {
        handled.push(event);
        return { dispatched: true };
      }) as never,
    }).receiveRaw(photoEvent("https://metadata.attacker.invalid/latest/meta-data/"));
    expect(result).toEqual({ kind: "durable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(handled[0]?.body).toContain("[zalo image attachment unavailable]");
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it("refuses a non-http photo_url", async () => {
    const dir = await makeDir();
    const fetchImpl = vi.fn();
    const handled: ChannelInboundEvent[] = [];
    const result = await createZaloAdmission({
      accountId: "default",
      downloadDir: dir,
      fetchImpl: fetchImpl as never,
      handleInbound: (async (event: ChannelInboundEvent) => {
        handled.push(event);
        return { dispatched: true };
      }) as never,
    }).receiveRaw(photoEvent("file:///etc/passwd"));
    expect(result).toEqual({ kind: "durable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(handled[0]?.body).toContain("[zalo image attachment unavailable]");
  });

  it("stops an oversized photo at the cap instead of writing it and checking after", async () => {
    const dir = await makeDir();
    setSsrfLookupImplementation((async () => [{ address: "203.0.113.10", family: 4 }]) as never);
    const fetchImpl = (async () =>
      new Response("x", {
        status: 200,
        headers: { "content-length": String(3 * 1024 * 1024) },
      })) as unknown as typeof globalThis.fetch;
    const handled: ChannelInboundEvent[] = [];
    await createZaloAdmission({
      accountId: "default",
      downloadDir: dir,
      mediaMaxMb: 1,
      fetchImpl,
      handleInbound: (async (event: ChannelInboundEvent) => {
        handled.push(event);
        return { dispatched: true };
      }) as never,
    }).receiveRaw(photoEvent("https://cdn.zalo.invalid/photo.jpg"));
    expect(handled[0]?.body).toContain("[zalo image attachment unavailable]");
    await expect(readdir(dir)).resolves.toEqual([]);
  });
});
