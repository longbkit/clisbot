// COMPAT(clisbot-control-plane): targeted tests for the shared inbound-media
// helpers — download streaming, failure cleanup, manifest shape, body fold.

import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildAttachedFilesManifest,
  downloadMediaFile,
  foldAttachedFilesIntoBody,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
} from "./media.js";

const tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "media-test-"));
  tmpDirs.push(dir);
  return dir;
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("downloadMediaFile", () => {
  it("streams bytes to a created file and reports the byte count", async () => {
    const dir = await makeDir();
    const content = "hello media bytes";
    const fetchImpl = async () => jsonResponse(200, content) as unknown as Promise<Response>;
    const result = await downloadMediaFile({
      url: "https://example.invalid/file",
      dir,
      fileName: "10-1-photo.jpg",
      fetchImpl,
    });
    expect(result.path).toBe(join(dir, "10-1-photo.jpg"));
    expect(result.bytes).toBe(content.length);
    const onDisk = await readFile(join(dir, "10-1-photo.jpg"));
    expect(onDisk.toString("utf8")).toBe(content);
  });

  it("rides the given headers verbatim (the Slack half's Bearer token)", async () => {
    const dir = await makeDir();
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string> | undefined;
      return jsonResponse(200, "x");
    }) as unknown as typeof globalThis.fetch;
    await downloadMediaFile({
      url: "https://files.slack.com/f.png",
      dir,
      fileName: "f.png",
      fetchImpl,
      headers: { Authorization: "Bearer xoxb-secret" },
    });
    expect(seenHeaders?.["Authorization"]).toBe("Bearer xoxb-secret");
  });

  it("exposes the shared 10-minute download floor as a constant", () => {
    expect(MEDIA_DOWNLOAD_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it("throws on HTTP 404 and leaves no partial file", async () => {
    const dir = await makeDir();
    const fetchImpl = async () => jsonResponse(404, "not found") as unknown as Promise<Response>;
    await expect(
      downloadMediaFile({
        url: "https://example.invalid/missing",
        dir,
        fileName: "nope.bin",
        fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(stat(join(dir, "nope.bin"))).rejects.toThrow();
  });

  it("removes the partial file when the stream fails mid-download", async () => {
    const dir = await makeDir();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.error(new Error("stream broke"));
      },
    });
    const fetchImpl = async () => new Response(stream) as unknown as Promise<Response>;
    await expect(
      downloadMediaFile({
        url: "https://example.invalid/half",
        dir,
        fileName: "half.bin",
        fetchImpl,
      }),
    ).rejects.toThrow(/stream broke/);
    await expect(stat(join(dir, "half.bin"))).rejects.toThrow();
  });
});

describe("buildAttachedFilesManifest", () => {
  it("returns the empty string with no files", () => {
    expect(buildAttachedFilesManifest([])).toBe("");
  });

  it("numbers files in order with absolute paths", () => {
    const manifest = buildAttachedFilesManifest([
      { name: "photo", kind: "photo", bytes: 1024, path: "/home/u/dl/10-1-photo.jpg" },
      { name: "notes.txt", kind: "document", bytes: 42, path: "/home/u/dl/10-2-notes.txt" },
    ]);
    expect(manifest).toBe(
      "[Attached files]\n" +
        "1. photo (photo, 1024 bytes) → /home/u/dl/10-1-photo.jpg\n" +
        "2. notes.txt (document, 42 bytes) → /home/u/dl/10-2-notes.txt",
    );
  });
});

describe("foldAttachedFilesIntoBody", () => {
  it("joins caption + manifest with a blank line", () => {
    expect(foldAttachedFilesIntoBody("describe this", "[Attached files]\n1. a")).toBe(
      "describe this\n\n[Attached files]\n1. a",
    );
  });

  it("returns the manifest alone when the body is empty (G6)", () => {
    expect(foldAttachedFilesIntoBody("   ", "[Attached files]\n1. a")).toBe(
      "[Attached files]\n1. a",
    );
  });

  it("returns the body alone when there is no manifest", () => {
    expect(foldAttachedFilesIntoBody("plain text", "")).toBe("plain text");
  });

  it("returns the empty string when both are empty", () => {
    expect(foldAttachedFilesIntoBody("", "")).toBe("");
  });
});
