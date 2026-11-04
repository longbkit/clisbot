import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { FileTransferOpcode, type FileTransferFrame } from "@clisbot/protocol/binary-frames/index";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { SessionDelivery } from "../owned-subscriptions/index.js";
import { heldUploadFrameBytes, WorkspaceFilesSession } from "./workspace-files-session.js";

const MiB = 1024 * 1024;
const CHUNK = 128 * 1024;
// One shared payload keeps large holds cheap: the hold counts bytes, it never copies them.
const PAYLOAD = new Uint8Array(CHUNK);
const homes: string[] = [];
const subsystems: WorkspaceFilesSession[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const subsystem of subsystems.splice(0)) subsystem.dispose();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  // Every test must leave the process-wide budget as it found it.
  expect(heldUploadFrameBytes()).toBe(0);
});

function setup(options: { heldUploadTimeoutMs?: number } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "held-upload-")));
  homes.push(home);
  const emitted: SessionOutboundMessage[] = [];
  const subsystem = new WorkspaceFilesSession({
    host: {
      emit: (message) => emitted.push(message),
      emitBinary: async () => {},
      hasBinaryChannel: () => false,
    },
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    clisbotHome: home,
    logger: pino({ level: "silent" }),
    ...options,
  });
  subsystems.push(subsystem);
  const ownership = new SessionDelivery((_source, message) => emitted.push(message));
  const connect = () => {
    const source = {};
    ownership.attach(source, true);
    return source;
  };
  const admit = (source: object, requestId: string, size: number) => {
    const request = {
      type: "file.upload.request",
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      size,
      modifiedAt: "2026-11-04T00:00:00.000Z",
      requestId,
    } as const;
    return ownership.request(source, request, async () =>
      subsystem.handleFileUploadRequest(request, ownership),
    );
  };
  const send = (source: object, batch: FileTransferFrame[]) =>
    batch.map((frame) => subsystem.handleFileTransferFrame(frame, source, () => true));
  const answer = (requestId: string) =>
    emitted.find(
      (message) =>
        (message.type === "file.upload.response" || message.type === "rpc_error") &&
        message.payload.requestId === requestId,
    );
  const answers = (requestId: string) =>
    emitted.filter(
      (message) =>
        (message.type === "file.upload.response" || message.type === "rpc_error") &&
        message.payload.requestId === requestId,
    );
  return { subsystem, ownership, connect, admit, send, answer, answers };
}

function frames(requestId: string, size: number): FileTransferFrame[] {
  const result: FileTransferFrame[] = [
    {
      opcode: FileTransferOpcode.FileBegin,
      requestId,
      metadata: {
        mime: "video/mp4",
        size,
        encoding: "binary",
        modifiedAt: "2026-11-04T00:00:00.000Z",
        fileName: "clip.mp4",
      },
    },
  ];
  for (let offset = 0; offset < size; offset += CHUNK)
    result.push({
      opcode: FileTransferOpcode.FileChunk,
      requestId,
      payload: PAYLOAD.subarray(0, Math.min(CHUNK, size - offset)),
    });
  result.push({ opcode: FileTransferOpcode.FileEnd, requestId });
  return result;
}

test("a drained hold returns every byte it counted", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "drained", size: 3 * MiB }, source);
  const delivered = t.send(source, frames("drained", 3 * MiB));
  expect(heldUploadFrameBytes()).toBe(3 * MiB);
  await t.admit(source, "drained", 3 * MiB);
  release();
  await Promise.all(delivered);
  await expect.poll(() => t.answer("drained")?.type).toBe("file.upload.response");
  expect(heldUploadFrameBytes()).toBe(0);
});

test("a refused request returns its held bytes and writes nothing", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "refused", size: MiB }, source);
  const delivered = t.send(source, frames("refused", MiB));
  release(); // The request was refused: no upload was begun.
  await Promise.all(delivered);
  expect(heldUploadFrameBytes()).toBe(0);
  expect(t.answer("refused")).toBeUndefined();
});

test("a connection that closes while its request waits releases the hold", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "closed", size: 2 * MiB }, source);
  void Promise.all(t.send(source, frames("closed", 2 * MiB)));
  expect(heldUploadFrameBytes()).toBe(2 * MiB);
  t.subsystem.releaseSource(source);
  expect(heldUploadFrameBytes()).toBe(0);
  // A late frame finds no hold, and the late settle has nothing left to drain.
  await Promise.all(t.send(source, frames("closed", CHUNK).slice(1, 2)));
  release();
  expect(heldUploadFrameBytes()).toBe(0);
});

test("a request that never settles gives its hold up", async () => {
  vi.useFakeTimers();
  const t = setup();
  const source = t.connect();
  t.subsystem.holdUploadFrames({ requestId: "stuck", size: MiB }, source);
  void Promise.all(t.send(source, frames("stuck", MiB)));
  expect(heldUploadFrameBytes()).toBe(MiB);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(heldUploadFrameBytes()).toBe(0);
  expect(t.answers("stuck")).toEqual([
    expect.objectContaining({
      type: "rpc_error",
      payload: expect.objectContaining({ code: "upload_authorization_timeout" }),
    }),
  ]);
  expect(t.subsystem.uploadRequestAnswered("stuck", source)).toBe(true);
  // Frames still on the wire are dropped by the marker, not held again.
  await Promise.all(t.send(source, frames("stuck", CHUNK).slice(1, 2)));
  expect(heldUploadFrameBytes()).toBe(0);
});

test("a connection that closes while held frames drain stops the drain and returns the bytes", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "midway", size: 16 * MiB }, source);
  const delivered = t.send(source, frames("midway", 16 * MiB));
  await t.admit(source, "midway", 16 * MiB);
  release();
  // Socket close, as the websocket server does it: release the hold, then the delivery source.
  t.subsystem.releaseSource(source);
  await t.ownership.detach(source);
  await Promise.all(delivered);
  expect(heldUploadFrameBytes()).toBe(0);
  expect(
    t
      .answers("midway")
      .some((message) => message.type === "file.upload.response" && message.payload.error === null),
  ).toBe(false);
});

test("the authorization timeout cannot fire once held frames are draining", async () => {
  const t = setup({ heldUploadTimeoutMs: 50 });
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "slow", size: 32 * MiB }, source);
  const delivered = t.send(source, frames("slow", 32 * MiB));
  await t.admit(source, "slow", 32 * MiB);
  release();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await Promise.all(delivered);
  await expect.poll(() => t.answer("slow")?.type, { timeout: 30_000 }).toBe("file.upload.response");
  expect(t.answers("slow")).toHaveLength(1);
  const answer = t.answer("slow");
  expect(answer?.type === "file.upload.response" && answer.payload.error).toBeNull();
  await expect.poll(() => heldUploadFrameBytes()).toBe(0);
}, 60_000);

test("disposing the session releases every connection's holds", () => {
  const t = setup();
  const [first, second] = [t.connect(), t.connect()];
  t.subsystem.holdUploadFrames({ requestId: "a", size: MiB }, first);
  t.subsystem.holdUploadFrames({ requestId: "b", size: MiB }, second);
  void Promise.all([...t.send(first, frames("a", MiB)), ...t.send(second, frames("b", MiB))]);
  expect(heldUploadFrameBytes()).toBe(2 * MiB);
  t.subsystem.dispose();
  expect(heldUploadFrameBytes()).toBe(0);
});

test("the shared budget refuses a third full hold with an answer, then recovers", async () => {
  const sessions = [setup(), setup(), setup()];
  const sources = sessions.map((t) => t.connect());
  const releases = sessions.map((t, index) =>
    t.subsystem.holdUploadFrames({ requestId: `full-${index}`, size: 64 * MiB }, sources[index]!),
  );
  const delivered = sessions.flatMap((t, index) =>
    t.send(sources[index]!, frames(`full-${index}`, 64 * MiB)),
  );
  expect(heldUploadFrameBytes()).toBe(128 * MiB);
  const third = sessions[2]!;
  await third.admit(sources[2]!, "full-2", 64 * MiB);
  releases[2]!();
  await expect.poll(() => third.answer("full-2")?.type).toBe("file.upload.response");
  const answer = third.answer("full-2");
  expect(answer?.type === "file.upload.response" && answer.payload.error).toMatch(/overloaded/);
  for (const [index, t] of sessions.slice(0, 2).entries()) {
    await t.admit(sources[index]!, `full-${index}`, 64 * MiB);
    releases[index]!();
  }
  await Promise.all(delivered);
  // The two admitted holds drain to disk in the background.
  await expect.poll(() => heldUploadFrameBytes(), { timeout: 30_000 }).toBe(0);
  for (const [index, t] of sessions.slice(0, 2).entries()) {
    await expect
      .poll(() => t.answer(`full-${index}`)?.type, { timeout: 30_000 })
      .toBe("file.upload.response");
    const admitted = t.answer(`full-${index}`);
    expect(admitted?.type === "file.upload.response" && admitted.payload.error).toBeNull();
  }
}, 60_000);

test("a second request with the same id on the same connection joins the first hold", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "dup", size: MiB }, source);
  const releaseDuplicate = t.subsystem.holdUploadFrames({ requestId: "dup", size: MiB }, source);
  const delivered = t.send(source, frames("dup", MiB));
  expect(heldUploadFrameBytes()).toBe(MiB);
  releaseDuplicate();
  expect(heldUploadFrameBytes()).toBe(MiB);
  await t.admit(source, "dup", MiB);
  release();
  await Promise.all(delivered);
  await expect.poll(() => t.answer("dup")?.type).toBe("file.upload.response");
  expect(heldUploadFrameBytes()).toBe(0);
});

test("overflow while held frames drain ends the upload and returns the bytes", async () => {
  const t = setup();
  const source = t.connect();
  const release = t.subsystem.holdUploadFrames({ requestId: "spill", size: MiB }, source);
  const early = t.send(source, frames("spill", MiB).slice(0, 5));
  await t.admit(source, "spill", MiB);
  release();
  // Past the declared megabyte while the first frames are still being written.
  const late = t.send(source, frames("spill", 2 * MiB).slice(1));
  await Promise.all([...early, ...late]);
  await expect.poll(() => t.answer("spill")?.type).toBe("file.upload.response");
  const answer = t.answer("spill");
  expect(answer?.type === "file.upload.response" && answer.payload.error).toMatch(
    /overloaded|exceeded declared size/,
  );
  expect(heldUploadFrameBytes()).toBe(0);
});
