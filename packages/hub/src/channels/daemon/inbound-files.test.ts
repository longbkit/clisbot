import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHANNEL_FILE_WRITE_MAX_BYTES } from "@clisbot/protocol/channel-files";
import {
  HOST_TOO_OLD,
  NOT_ON_HUB,
  stageInboundFiles,
  type InboundFileHost,
} from "./inbound-files.js";

let root: string;
let downloads: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-inbound-stage-"));
  downloads = join(root, "slack", "work", "downloads");
  await mkdir(downloads, { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A Host on another machine: it keeps what it is sent and names its own path. */
function remoteHost(canWrite = true) {
  const files = new Map<string, Buffer>();
  const writes: { fileId: string; offset: number }[] = [];
  const host: InboundFileHost = {
    canWrite,
    write: async (chunk) => {
      writes.push({ fileId: chunk.fileId, offset: chunk.offset });
      const path = `/host/uploads/channel/${chunk.fileId}/${chunk.fileName}`;
      const bytes = Buffer.concat([
        chunk.offset === 0 ? Buffer.alloc(0) : files.get(path)!,
        Buffer.from(chunk.data, "base64"),
      ]);
      files.set(path, bytes);
      const done = bytes.length === chunk.size;
      return { receivedBytes: bytes.length, path: done ? path : null };
    },
  };
  return { host, files, writes };
}

const line = (n: number, name: string, bytes: number, path: string) =>
  `${n}. ${name} (document, ${bytes} bytes) → ${path}`;

describe("an inbound attachment staged for the Agent's Host", () => {
  it("names the Host copy of every file, and both files arrive whole", async () => {
    const a = join(downloads, "1-1-a.csv");
    const b = join(downloads, "1-2-b $& name.csv");
    await writeFile(a, "x,y\n");
    await writeFile(b, "1,2,3\n");
    const { host, files } = remoteHost();
    const text = `sender: [Attached files]\n${line(1, "a.csv", 4, a)}\n${line(2, "b $& name.csv", 6, b)}`;
    const staged = await stageInboundFiles(text, {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    const [first, second] = [...files.keys()];
    assert.equal(
      staged,
      `sender: [Attached files]\n${line(1, "a.csv", 4, first!)}\n${line(2, "b $& name.csv", 6, second!)}`,
    );
    assert.equal(files.get(first!)?.toString(), "x,y\n");
    assert.equal(files.get(second!)?.toString(), "1,2,3\n");
  });

  it("leaves a typed line that names a file outside the account's downloads, and reads nothing", async () => {
    const secret = join(root, "secret.txt");
    await writeFile(secret, "do not send");
    const linked = join(downloads, "link.txt");
    await symlink(secret, linked);
    const { host, writes } = remoteHost();
    const text = [
      line(1, "passwd", 10, "/etc/passwd"),
      line(2, "up", 10, `${downloads}/../../secret.txt`),
      line(3, "link", 10, linked),
    ].join("\n");
    const staged = await stageInboundFiles(text, {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    assert.equal(staged, text);
    assert.deepEqual(writes, []);
  });

  it("says a file is gone rather than naming a Hub path that no longer exists", async () => {
    const gone = join(downloads, "9-1-gone.csv");
    const { host } = remoteHost();
    const staged = await stageInboundFiles(line(1, "gone.csv", 3, gone), {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    assert.equal(staged, `1. gone.csv (document, 3 bytes) — ${NOT_ON_HUB}`);
  });

  it("names the size limit for a file too large to send, and sends none of it", async () => {
    const big = join(downloads, "2-1-big.bin");
    await writeFile(big, "");
    await truncate(big, CHANNEL_FILE_WRITE_MAX_BYTES + 1);
    const { host, writes } = remoteHost();
    const staged = await stageInboundFiles(line(1, "big.bin", 1, big), {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    assert.match(staged, /— not sent: larger than the 100 MB limit for files sent to the agent$/);
    assert.equal(staged.includes(big), false);
    assert.deepEqual(writes, []);
  });

  it("asks for a Host update when the Host cannot receive files", async () => {
    const file = join(downloads, "3-1-old.csv");
    await writeFile(file, "a\n");
    const { host } = remoteHost(false);
    const staged = await stageInboundFiles(line(1, "old.csv", 2, file), {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    assert.equal(staged, `1. old.csv (document, 2 bytes) — ${HOST_TOO_OLD}`);
  });

  it("sends an empty file as one write", async () => {
    const empty = join(downloads, "4-1-empty.txt");
    await writeFile(empty, "");
    const { host, files, writes } = remoteHost();
    const staged = await stageInboundFiles(line(1, "empty.txt", 0, empty), {
      agentId: "agent",
      downloadsDir: downloads,
      host,
    });
    const [hostPath] = [...files.keys()];
    assert.equal(staged, line(1, "empty.txt", 0, hostPath!));
    assert.equal(writes.length, 1);
  });

  it("names a different Host copy for each Agent the same file goes to", async () => {
    const file = join(downloads, "5-1-shared.csv");
    await writeFile(file, "s\n");
    const { host } = remoteHost();
    const text = line(1, "shared.csv", 2, file);
    const one = await stageInboundFiles(text, { agentId: "one", downloadsDir: downloads, host });
    const again = await stageInboundFiles(text, { agentId: "one", downloadsDir: downloads, host });
    const two = await stageInboundFiles(text, { agentId: "two", downloadsDir: downloads, host });
    assert.equal(one, again, "a retry is the same request");
    assert.notEqual(one, two);
  });
});
