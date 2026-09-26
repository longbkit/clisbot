import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readChannelFileChunk } from "./channel-file.js";

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
