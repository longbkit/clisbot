// COMPAT(clisbot-control-plane): targeted tests for the Telegram inbound-media
// module — extraction (photo-largest, multi-carrier order), download (the
// getFile + file-stream happy path, failure-skip with logger capture).

import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TELEGRAM_MAX_INBOUND_MEDIA_BYTES } from "@getpaseo/channels-shared";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import {
  downloadTelegramAttachment,
  extractTelegramAttachments,
  foldInboundTelegramMedia,
  type TelegramAttachment,
  type TelegramMessageShape,
  type TelegramMediaDownloadContext,
} from "./media.js";

const BOT_TOKEN = "123456789:TEST-TOKEN";
const API_ROOT = "https://api.telegram.org";
const DL_DIR = join(tmpdir(), "tg-media-test-dl");

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tg-media-test-"));
  return dir;
}

function makeContext(
  overrides?: Partial<TelegramMediaDownloadContext>,
): TelegramMediaDownloadContext {
  return {
    accountId: "acct",
    botToken: BOT_TOKEN,
    apiRoot: API_ROOT,
    downloadDir: DL_DIR,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

/** A fetch that answers getFile with `file_path` and the file stream with the
 * content bytes; `fileStatus` controls the getFile HTTP status. */
function fakeFetch(fileStatus: number, content: string) {
  return (async (url: string | URL | Request) => {
    const urlText = String(url);
    if (urlText.includes("/getFile")) {
      return new Response(
        JSON.stringify({
          ok: fileStatus === 200,
          result: { file_path: "files/abc/123" },
          description: fileStatus === 200 ? undefined : "bad file id",
        }),
        { status: fileStatus },
      );
    }
    return new Response(content, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

describe("extractTelegramAttachments", () => {
  it("returns no attachments for a text-only message", () => {
    const message: TelegramMessageShape = { message_id: 1, text: "hi" };
    expect(extractTelegramAttachments(message)).toEqual([]);
  });

  it("selects the LARGEST photo element (first wins ties, skips empty file_id)", () => {
    const message: TelegramMessageShape = {
      message_id: 1,
      photo: [
        { file_id: "small", file_size: 100 },
        { file_id: "", file_size: 999 },
        { file_id: "large", file_size: 900 },
        { file_id: "mid", file_size: 500 },
      ],
    };
    const attachments = extractTelegramAttachments(message);
    expect(attachments).toEqual([{ kind: "photo", fileId: "large", size: 900 }]);
  });

  it("extracts a document with its file_name + size", () => {
    const message: TelegramMessageShape = {
      message_id: 2,
      document: { file_id: "doc-id", file_name: "notes.txt", file_size: 42 },
    };
    expect(extractTelegramAttachments(message)).toEqual([
      { kind: "document", fileId: "doc-id", fileName: "notes.txt", size: 42 },
    ]);
  });

  it("extracts audio / voice / video / animation carriers", () => {
    for (const kind of ["audio", "voice", "video", "animation"] as const) {
      const message: TelegramMessageShape = {
        message_id: 3,
        [kind]: { file_id: `${kind}-id` },
      };
      expect(extractTelegramAttachments(message)).toEqual([{ kind, fileId: `${kind}-id` }]);
    }
  });

  it("omits a size that is not a safe integer", () => {
    const message: TelegramMessageShape = {
      message_id: 4,
      document: { file_id: "d", file_size: Number.MAX_SAFE_INTEGER + 1 },
    };
    expect(extractTelegramAttachments(message)).toEqual([{ kind: "document", fileId: "d" }]);
  });

  it("orders a multi-carrier message deterministically (G5)", () => {
    const message: TelegramMessageShape = {
      message_id: 5,
      photo: [{ file_id: "p", file_size: 10 }],
      document: { file_id: "d", file_name: "a.pdf" },
      video: { file_id: "v" },
    };
    const attachments = extractTelegramAttachments(message);
    expect(attachments.map((a) => a.kind)).toEqual(["photo", "document", "video"]);
  });
});

describe("downloadTelegramAttachment", () => {
  it("downloads the file stream into the download dir with the derived name", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(200, "photo-bytes") });
    const attachment: TelegramAttachment = { kind: "photo", fileId: "f1" };
    const record = await downloadTelegramAttachment(ctx, attachment, 10, 0);
    expect(record.path).toBe(join(dir, "10-1-photo.jpg"));
    expect(record.bytes).toBe("photo-bytes".length);
    expect(record.name).toBe("photo");
    await stat(record.path);
    await rm(dir, { recursive: true, force: true });
  });

  it("uses the document file_name with its native extension", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(200, "doc-bytes") });
    const record = await downloadTelegramAttachment(
      ctx,
      { kind: "document", fileId: "f2", fileName: "report.pdf" },
      11,
      0,
    );
    expect(record.path).toBe(join(dir, "11-1-report.pdf"));
    await rm(dir, { recursive: true, force: true });
  });

  it("fails when getFile reports an error HTTP status", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(400, "") });
    await expect(
      downloadTelegramAttachment(ctx, { kind: "photo", fileId: "bad" }, 12, 0),
    ).rejects.toThrow(/bad file id|HTTP 400/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("foldInboundTelegramMedia", () => {
  function makeEvent(body: string): ChannelInboundEvent {
    return {
      channel: "telegram",
      externalEventId: "update:1",
      externalMessageId: "10",
      externalConversationId: "-1001",
      chatType: "group",
      messageThreadId: null,
      senderId: "42",
      body,
      wasMentioned: true,
      timestampMs: 1_700_000_000_000,
    };
  }

  it("returns the event unchanged when there are no attachments", async () => {
    const message: TelegramMessageShape = { message_id: 10, text: "plain" };
    const event = makeEvent("plain");
    const ctx = makeContext();
    const folded = await foldInboundTelegramMedia(ctx, message, event);
    expect(folded).toBe(event);
  });

  it("folds caption + manifest (G1/G5) with files on disk", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(200, "img") });
    const message: TelegramMessageShape = {
      message_id: 20,
      caption: "describe this",
      photo: [
        { file_id: "p1", file_size: 3 },
        { file_id: "p2", file_size: 30 },
      ],
      document: { file_id: "d1", file_name: "a.txt", file_size: 3 },
    };
    const folded = await foldInboundTelegramMedia(ctx, message, makeEvent("describe this"));
    expect(folded).not.toBeNull();
    expect(folded!.body).toBe(
      `describe this\n\n[Attached files]\n` +
        `1. photo (photo, 3 bytes) → ${join(dir, "20-1-photo.jpg")}\n` +
        `2. a.txt (document, 3 bytes) → ${join(dir, "20-2-a.txt")}`,
    );
    await stat(join(dir, "20-1-photo.jpg"));
    await stat(join(dir, "20-2-a.txt"));
    await rm(dir, { recursive: true, force: true });
  });

  it("admits a media-only message with attachments: body = manifest only (G6)", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(200, "img") });
    const message: TelegramMessageShape = {
      message_id: 21,
      photo: [{ file_id: "p1", file_size: 3 }],
    };
    const folded = await foldInboundTelegramMedia(ctx, message, makeEvent(""));
    expect(folded).not.toBeNull();
    expect(folded!.body).toBe(
      `[Attached files]\n1. photo (photo, 3 bytes) → ${join(dir, "21-1-photo.jpg")}`,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("skips a failed attachment (logged) and keeps the rest (G11 floor)", async () => {
    const dir = await makeDir();
    const errors: string[] = [];
    const logger: HostChildLogger = {
      warn: () => {},
      error: (m) => {
        errors.push(m);
      },
    };
    // The getFile URL carries the file_id, so the fake can key off it: the
    // "first" file resolves to a bad stream path (404), the second to a good
    // one.
    const fetchImpl = (async (url: string | URL | Request) => {
      const urlText = String(url);
      if (urlText.includes("/getFile")) {
        const filePath = urlText.includes("first") ? "files/bad" : "files/good";
        return new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }), {
          status: 200,
        });
      }
      const isBad = urlText.includes("files/bad");
      return new Response(isBad ? "gone" : "ok-bytes", { status: isBad ? 404 : 200 });
    }) as unknown as typeof globalThis.fetch;
    const ctx2 = makeContext({ downloadDir: dir, fetchImpl, logger });
    const message: TelegramMessageShape = {
      message_id: 22,
      document: { file_id: "first", file_name: "a.txt", file_size: 8 },
      audio: { file_id: "second", file_size: 8 },
    };
    const folded = await foldInboundTelegramMedia(ctx2, message, makeEvent("still here"));
    expect(folded).not.toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/download failed/);
    expect(folded!.body).toBe(
      `still here\n\n[Attached files]\n1. audio (audio, 8 bytes) → ${join(dir, "22-2-audio.mp3")}`,
    );
    await stat(join(dir, "22-2-audio.mp3"));
    await rm(dir, { recursive: true, force: true });
  });

  // Slice 25 (security): `getFile` refuses anything over 20 MB, so a larger
  // declared length is a lie or a redirected host. An uncapped stream-to-disk
  // is a disk-fill any group member can drive.
  it("skips an attachment past the inbound ceiling without writing it", async () => {
    const dir = await makeDir();
    const errors: string[] = [];
    const logger: HostChildLogger = { warn: () => {}, error: (m) => void errors.push(m) };
    const oversized = (async (url: string | URL | Request) => {
      if (String(url).includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "f/1" } }), {
          status: 200,
        });
      }
      return new Response("x", {
        status: 200,
        headers: { "content-length": String(TELEGRAM_MAX_INBOUND_MEDIA_BYTES + 1) },
      });
    }) as unknown as typeof globalThis.fetch;
    const ctx = makeContext({ downloadDir: dir, fetchImpl: oversized, logger });
    const message: TelegramMessageShape = {
      message_id: 24,
      document: { file_id: "huge", file_name: "huge.bin" },
    };
    const folded = await foldInboundTelegramMedia(ctx, message, makeEvent("here"));
    expect(folded!.body).toBe("here");
    expect(errors[0]).toMatch(/download failed/);
    await expect(readdir(dir)).resolves.toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("drops the event when every attachment fails and there is no caption", async () => {
    const dir = await makeDir();
    const logger: HostChildLogger = { warn: () => {}, error: () => {} };
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(400, ""), logger });
    const message: TelegramMessageShape = {
      message_id: 23,
      photo: [{ file_id: "p", file_size: 1 }],
    };
    const folded = await foldInboundTelegramMedia(ctx, message, makeEvent(""));
    expect(folded).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
