// COMPAT(clisbot-control-plane): targeted tests for the Slack inbound-media
// module — extraction (files[] download URL + kind + external/host skips),
// download (Bearer-token stream-to-disk), and the fold (manifest ordering,
// media-only admit, all-failed drop, external skip). Mirrors the Telegram
// vertical's media.test.ts (same admission semantics, the F-06/G5+G6 parity).

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import type { SlackMessageEvent } from "./socket-event-filter.js";
import {
  downloadSlackFile,
  extractSlackFileAttachments,
  foldInboundSlackMedia,
  type SlackFileAttachment,
  type SlackMediaDownloadContext,
} from "./media.js";

const BOT_TOKEN = "xoxb-slack-token";
const DL_DIR = join(tmpdir(), "slack-media-test-dl");

async function makeDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "slack-media-test-"));
}

function makeContext(overrides?: Partial<SlackMediaDownloadContext>): SlackMediaDownloadContext {
  return {
    accountId: "acct",
    botToken: BOT_TOKEN,
    downloadDir: DL_DIR,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function makeEvent(body: string): ChannelInboundEvent {
  return {
    channel: "slack",
    externalEventId: "1700000000.000100",
    externalMessageId: "1700000000.000100",
    externalConversationId: "C123",
    chatType: "channel",
    messageThreadId: null,
    senderId: "U0BOB",
    body,
    wasMentioned: true,
    timestampMs: 1_700_000_000_000,
  };
}

/** A fetch that answers file downloads with `content`; `failWhen` returns a
 * 404 for any file URL whose path matches the substring. Records the headers
 * seen (so the Bearer token assertion can inspect them). */
function fakeFetch(failWhen: string | null, headersSeen: Record<string, string>[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    headersSeen.push((init?.headers ?? {}) as Record<string, string>);
    const urlText = String(url);
    const bad = failWhen !== null && urlText.includes(failWhen);
    return new Response(bad ? "gone" : "img-bytes", { status: bad ? 404 : 200 });
  }) as unknown as typeof globalThis.fetch;
}

describe("extractSlackFileAttachments", () => {
  function eventWithFiles(files: unknown): SlackMessageEvent {
    return { type: "message", text: "hi", ts: "1.0", channel: "C1", files };
  }

  it("returns no attachments for a text-only message", () => {
    expect(extractSlackFileAttachments(eventWithFiles(undefined))).toEqual({
      attachments: [],
      skipped: [],
    });
  });

  it("downloads a slack-host file with its native name + size, classifying the kind", () => {
    const { attachments } = extractSlackFileAttachments(
      eventWithFiles([
        {
          name: "report.pdf",
          mimetype: "application/pdf",
          size: 1234,
          url_private_download: "https://files.slack.com/files-tmp/report.pdf",
        },
      ]),
    );
    expect(attachments).toEqual([
      {
        kind: "document",
        fileName: "report.pdf",
        size: 1234,
        url: "https://files.slack.com/files-tmp/report.pdf",
      },
    ]);
  });

  it("prefers url_private_download over url_private", () => {
    const { attachments } = extractSlackFileAttachments(
      eventWithFiles([
        {
          name: "img.png",
          mimetype: "image/png",
          url_private: "https://files.slack.com/private/img.png",
          url_private_download: "https://files.slack.com/download/img.png",
        },
      ]),
    );
    expect(attachments[0]?.url).toBe("https://files.slack.com/download/img.png");
    expect(attachments[0]?.kind).toBe("image");
  });

  it("classifies image/audio/video mime prefixes; unknown → document", () => {
    for (const [mime, kind] of [
      ["image/png", "image"],
      ["audio/ogg", "audio"],
      ["video/mp4", "video"],
      ["application/zip", "document"],
    ] as const) {
      const { attachments } = extractSlackFileAttachments(
        eventWithFiles([
          { name: "f", mimetype: mime, url_private_download: "https://files.slack.com/x" },
        ]),
      );
      expect(attachments[0]?.kind).toBe(kind);
    }
  });

  it("skips an external link file (external_url) with a logged skip", () => {
    const extraction = extractSlackFileAttachments(
      eventWithFiles([
        {
          name: "link.md",
          external_url: "https://example.com/doc",
          external_type: "markdown",
        },
      ]),
    );
    expect(extraction.attachments).toEqual([]);
    expect(extraction.skipped).toEqual([{ fileName: "link.md", reason: "external" }]);
  });

  it("skips a file whose download URL is not on a Slack host", () => {
    const extraction = extractSlackFileAttachments(
      eventWithFiles([
        {
          name: "evil.bin",
          mimetype: "image/png",
          url_private_download: "https://evil.example.com/f.png",
        },
      ]),
    );
    expect(extraction.attachments).toEqual([]);
    expect(extraction.skipped).toEqual([{ fileName: "evil.bin", reason: "host-not-slack" }]);
  });

  it("orders a multi-file message deterministically (G5)", () => {
    const { attachments } = extractSlackFileAttachments(
      eventWithFiles([
        { name: "a.png", mimetype: "image/png", url_private_download: "https://files.slack.com/a" },
        {
          name: "b.pdf",
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/b",
        },
        { name: "c.mp4", mimetype: "video/mp4", url_private_download: "https://files.slack.com/c" },
      ]),
    );
    expect(attachments.map((a) => a.fileName)).toEqual(["a.png", "b.pdf", "c.mp4"]);
  });
});

describe("downloadSlackFile", () => {
  it("streams the file into the download dir with the native name + Bearer token", async () => {
    const dir = await makeDir();
    const headersSeen: Record<string, string>[] = [];
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(null, headersSeen) });
    const attachment: SlackFileAttachment = {
      kind: "image",
      fileName: "pic.png",
      url: "https://files.slack.com/pic.png",
    };
    const record = await downloadSlackFile(ctx, attachment, "1700.0001", 0);
    expect(record.path).toBe(join(dir, "1700.0001-1-pic.png"));
    expect(record.bytes).toBe("img-bytes".length);
    // The manifest name keeps the native file name (with extension) — TG parity.
    expect(record.name).toBe("pic.png");
    expect(record.kind).toBe("image");
    await stat(record.path);
    // The Bearer bot token rides the download request.
    expect(headersSeen[0]?.["Authorization"]).toBe(`Bearer ${BOT_TOKEN}`);
    await rm(dir, { recursive: true, force: true });
  });

  it("throws when the download stream returns a non-200", async () => {
    const dir = await makeDir();
    const ctx = makeContext({
      downloadDir: dir,
      fetchImpl: fakeFetch("always", []),
    });
    await expect(
      downloadSlackFile(ctx, { kind: "image", url: "https://files.slack.com/always" }, "2.0", 0),
    ).rejects.toThrow(/HTTP 404/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("foldInboundSlackMedia", () => {
  function eventWithFiles(text: string, files: unknown): SlackMessageEvent {
    return {
      type: "message",
      text,
      ts: "1700000000.000100",
      channel: "C1",
      files,
    };
  }

  it("returns the event unchanged when there are no files", async () => {
    const inbound = makeEvent("plain");
    const folded = await foldInboundSlackMedia(makeContext(), eventWithFiles("plain", []), inbound);
    expect(folded).toBe(inbound);
  });

  it("folds text + manifest with files on disk, in order (G1/G5)", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(null, []) });
    const event = eventWithFiles("describe these", [
      { name: "a.png", mimetype: "image/png", url_private_download: "https://files.slack.com/a" },
      {
        name: "b.pdf",
        mimetype: "application/pdf",
        url_private_download: "https://files.slack.com/b",
      },
    ]);
    const folded = await foldInboundSlackMedia(ctx, event, makeEvent("describe these"));
    expect(folded).not.toBeNull();
    expect(folded!.body).toBe(
      `describe these\n\n[Attached files]\n` +
        `1. a.png (image, 9 bytes) → ${join(dir, "1700000000.000100-1-a.png")}\n` +
        `2. b.pdf (document, 9 bytes) → ${join(dir, "1700000000.000100-2-b.pdf")}`,
    );
    await stat(join(dir, "1700000000.000100-1-a.png"));
    await stat(join(dir, "1700000000.000100-2-b.pdf"));
    await rm(dir, { recursive: true, force: true });
  });

  it("admits a media-only message with files: body = manifest only (G6)", async () => {
    const dir = await makeDir();
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(null, []) });
    const event = eventWithFiles("", [
      {
        name: "solo.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.com/s",
      },
    ]);
    const folded = await foldInboundSlackMedia(ctx, event, makeEvent(""));
    expect(folded).not.toBeNull();
    expect(folded!.body).toBe(
      `[Attached files]\n1. solo.png (image, 9 bytes) → ${join(dir, "1700000000.000100-1-solo.png")}`,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("skips a failed file (logged) and keeps the rest", async () => {
    const dir = await makeDir();
    const errors: string[] = [];
    const logger: HostChildLogger = {
      warn: () => {},
      error: (m) => {
        errors.push(m);
      },
    };
    const ctx = makeContext({
      downloadDir: dir,
      fetchImpl: fakeFetch("badfile", []),
      logger,
    });
    const event = eventWithFiles("still here", [
      {
        name: "badfile.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.com/badfile",
      },
      {
        name: "good.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.com/good",
      },
    ]);
    const folded = await foldInboundSlackMedia(ctx, event, makeEvent("still here"));
    expect(folded).not.toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/download failed/);
    expect(folded!.body).toBe(
      `still here\n\n[Attached files]\n` +
        `1. good.png (image, 9 bytes) → ${join(dir, "1700000000.000100-2-good.png")}`,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("drops the event when every file fails and there is no text (TG parity)", async () => {
    const dir = await makeDir();
    const logger: HostChildLogger = { warn: () => {}, error: () => {} };
    const ctx = makeContext({
      downloadDir: dir,
      fetchImpl: fakeFetch("everything", []),
      logger,
    });
    const event = eventWithFiles("", [
      {
        name: "x.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.com/everything",
      },
    ]);
    const folded = await foldInboundSlackMedia(ctx, event, makeEvent(""));
    expect(folded).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("logs a skip for an external-only message and drops it (no text, nothing downloaded)", async () => {
    const dir = await makeDir();
    const warnings: string[] = [];
    const logger: HostChildLogger = {
      warn: (m) => {
        warnings.push(m);
      },
      error: () => {},
    };
    const ctx = makeContext({ downloadDir: dir, fetchImpl: fakeFetch(null, []), logger });
    const event = eventWithFiles("", [
      { name: "link.md", external_url: "https://example.com/x", external_type: "markdown" },
    ]);
    const folded = await foldInboundSlackMedia(ctx, event, makeEvent(""));
    expect(folded).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/skipped file/);
    await rm(dir, { recursive: true, force: true });
  });
});
