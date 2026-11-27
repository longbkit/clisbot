import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readChannelFileChunk, writeChannelFileChunk } from "./channel-file.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const config = {
  mcpServers: {
    channel_reply: { type: "http" as const, url: "https://hub.test/mcp/channel/session-token" },
  },
};
const capabilityHash = createHash("sha256").update("session-token").digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "channel-host-file-"));
  roots.push(root);
  const generated = path.join(root, "generated_images");
  await mkdir(generated);
  const file = path.join(generated, "image.png");
  const bytes = Buffer.alloc(700_000, 97);
  await writeFile(file, bytes);
  return {
    root,
    file,
    bytes,
    request: { capabilityHash, path: file, offset: 0, maxBytes: 1_000_000 },
  };
}

it("reads an agent-generated file outside its workspace in bounded chunks, including symlinks", async () => {
  const { root, file, bytes, request } = await fixture();
  const link = path.join(root, "link.png");
  await symlink(file, link);
  const first = await readChannelFileChunk(config, { ...request, path: link });
  const a = Buffer.from(first.data, "base64");
  expect(a.length).toBe(512 * 1024);
  const second = await readChannelFileChunk(config, {
    ...request,
    offset: a.length,
    version: first.version,
  });
  expect(Buffer.concat([a, Buffer.from(second.data, "base64")])).toEqual(bytes);
});

it("rejects a different session capability, missing agent, oversized file and directory", async () => {
  const { root, request } = await fixture();
  await expect(
    readChannelFileChunk(config, { ...request, capabilityHash: "0".repeat(64) }),
  ).rejects.toThrow("does not belong");
  await expect(readChannelFileChunk(undefined, request)).rejects.toThrow("does not belong");
  await expect(readChannelFileChunk(config, { ...request, maxBytes: 100 })).rejects.toThrow(
    "upload limit",
  );
  await expect(readChannelFileChunk(config, { ...request, path: root })).rejects.toThrow(
    "regular file",
  );
  await expect(readChannelFileChunk(config, { ...request, path: "relative.png" })).rejects.toThrow(
    "absolute",
  );
  await expect(
    readChannelFileChunk(config, { ...request, path: path.join(root, "missing") }),
  ).rejects.toThrow("ENOENT");
});

it("refuses a changed file between chunks", async () => {
  const { file, request } = await fixture();
  const first = await readChannelFileChunk(config, request);
  await writeFile(file, "replacement");
  await expect(
    readChannelFileChunk(config, { ...request, offset: 1, version: first.version }),
  ).rejects.toThrow("File changed");
});

async function homeFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "channel-host-home-"));
  roots.push(home);
  return home;
}
const fileId = "f".repeat(64);
function chunksOf(bytes: Buffer, size = 512 * 1024) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length || offset === 0; offset += size) {
    chunks.push({
      fileId,
      fileName: "PUS_25.11.csv",
      size: bytes.length,
      offset,
      data: bytes.subarray(offset, offset + size).toString("base64"),
    });
    if (bytes.length === 0) break;
  }
  return chunks;
}

it("writes an inbound channel file in order under the Host's uploads and names it once complete", async () => {
  const home = await homeFixture();
  const bytes = Buffer.alloc(700_000, 44);
  const [first, second] = chunksOf(bytes);
  expect(await writeChannelFileChunk(home, first!)).toEqual({
    receivedBytes: 512 * 1024,
    path: null,
  });
  const done = await writeChannelFileChunk(home, second!);
  expect(done).toEqual({
    receivedBytes: bytes.length,
    path: path.join(home, "uploads", "channel", fileId, "PUS_25.11.csv"),
  });
  expect(await readFile(done.path!)).toEqual(bytes);
  expect(await readdir(path.dirname(done.path!))).toEqual(["PUS_25.11.csv"]);

  // A retried prompt sends the file again: the finished copy answers at once, unchanged.
  expect(await writeChannelFileChunk(home, first!)).toEqual(done);
});

it("refuses a chunk out of order, a file over the limit and a name that climbs out", async () => {
  const home = await homeFixture();
  const bytes = Buffer.alloc(700_000, 44);
  const [, second] = chunksOf(bytes);
  await expect(writeChannelFileChunk(home, second!)).rejects.toThrow(/out of order/);
  await expect(
    writeChannelFileChunk(home, { ...chunksOf(Buffer.from("x"))[0]!, size: 100 * 1024 * 1024 + 1 }),
  ).rejects.toThrow("File exceeds the channel file limit of 104857600 bytes");
  const climbed = await writeChannelFileChunk(home, {
    ...chunksOf(Buffer.from("x"))[0]!,
    fileName: "../../outside.txt",
  });
  expect(climbed.path).toBe(path.join(home, "uploads", "channel", fileId, "outside.txt"));
});
