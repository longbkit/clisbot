// COMPAT(clisbot-control-plane): targeted tests for the Slack outbound
// native-media path — the 3-step external upload (getUploadURLExternal →
// POST bytes → completeUploadExternal) and the host-allowlist refusal.

import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { uploadSlackFile } from "./outbound-media.js";
import { slackWebClientStubForTest, type WebClient } from "./client/web-api.js";

const tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slack-outbound-media-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

interface RecordedComplete {
  args: {
    files: Array<{ id: string; title?: string }>;
    channel_id: string;
    thread_ts?: string;
    initial_comment?: string;
  };
}

function fakeUploadClient(opts: {
  uploadUrl: string;
  ok: boolean;
  complete?: RecordedComplete[];
  completeOk?: boolean;
  fetchImpl?: typeof globalThis.fetch;
}): WebClient {
  return {
    ...slackWebClientStubForTest(),
    auth: {
      async test() {
        return { ok: true } as never;
      },
    },
    chat: {
      async postMessage() {
        return { ok: true, ts: "1.0" } as never;
      },
      async update() {
        return { ok: true } as never;
      },
    },
    files: {
      async getUploadURLExternal() {
        return {
          ok: true,
          upload_url: opts.uploadUrl,
          file_id: "F123",
        } as never;
      },
      async completeUploadExternal(args: RecordedComplete["args"]) {
        opts.complete?.push({ args });
        return { ok: opts.completeOk ?? true } as never;
      },
    },
  } as WebClient;
}

function okFetch(bytes: number) {
  return (async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(null, {
      status: 200,
      headers: { "Content-Length": String(bytes) },
    });
  }) as unknown as typeof globalThis.fetch;
}

describe("uploadSlackFile — the 3-step external upload", () => {
  it("get → POST bytes → complete in order, committing into the thread", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "shot.png");
    writeFileSync(filePath, "img-bytes");
    const complete: RecordedComplete[] = [];
    const client = fakeUploadClient({
      uploadUrl: "https://files.slack.com/upload/abc",
      ok: true,
      complete,
      fetchImpl: okFetch(9),
    });
    const fileId = await uploadSlackFile({
      client,
      filePath,
      fileName: "shot.png",
      channelId: "C1",
      threadTs: "1700.0001",
      caption: "look",
      fetchImpl: okFetch(9),
    });
    expect(fileId).toBe("F123");
    expect(complete).toHaveLength(1);
    expect(complete[0]?.args).toEqual({
      files: [{ id: "F123", title: "shot.png" }],
      channel_id: "C1",
      thread_ts: "1700.0001",
      initial_comment: "look",
    });
  });

  it("omits thread_ts/initial_comment when neither is given", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "a.jpg");
    writeFileSync(filePath, "j");
    const complete: RecordedComplete[] = [];
    const client = fakeUploadClient({
      uploadUrl: "https://files.slack.com/upload/x",
      ok: true,
      complete,
      fetchImpl: okFetch(1),
    });
    await uploadSlackFile({
      client,
      filePath,
      fileName: "a.jpg",
      channelId: "C2",
      fetchImpl: okFetch(1),
    });
    expect(complete[0]?.args).toEqual({
      files: [{ id: "F123", title: "a.jpg" }],
      channel_id: "C2",
    });
  });

  it("refuses to POST to a non-Slack upload host (allowlist)", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "a.jpg");
    writeFileSync(filePath, "j");
    let fetchCalled = 0;
    const sneakyFetch = (async () => {
      fetchCalled += 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = fakeUploadClient({
      uploadUrl: "https://evil.example.com/upload",
      ok: true,
      fetchImpl: sneakyFetch,
    });
    await expect(
      uploadSlackFile({
        client,
        filePath,
        fileName: "a.jpg",
        channelId: "C1",
        fetchImpl: sneakyFetch,
      }),
    ).rejects.toThrow(/not on a Slack host/);
    expect(fetchCalled).toBe(0);
  });

  it("throws when getUploadURLExternal is not ok", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "a.jpg");
    writeFileSync(filePath, "j");
    const client = {
      files: {
        async getUploadURLExternal() {
          return { ok: false, error: "not_authed" };
        },
        async completeUploadExternal() {
          return { ok: true };
        },
      },
    } as never;
    await expect(
      uploadSlackFile({ client, filePath, fileName: "a.jpg", channelId: "C1" }),
    ).rejects.toThrow(/getUploadURLExternal failed/);
  });
});
