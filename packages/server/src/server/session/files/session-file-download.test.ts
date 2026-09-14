import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { WorkspaceFilesSession } from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import { attachSessionFiles } from "../../file-upload/session-files.js";
import type { SessionOutboundMessage } from "../../messages.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-download-"));
  roots.push(directory);
  const agent = path.join(directory, "agent");
  const workspace = path.join(directory, "workspace");
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, "legacy.txt"), "legacy");
  const attached = await attachSessionFiles({
    directory: agent,
    messageId: "message",
    images: [{ data: Buffer.from("saved image").toString("base64"), mimeType: "image/png" }],
    ownsUpload: () => false,
  });
  const emitted: SessionOutboundMessage[] = [];
  const tokens = new DownloadTokenStore({ ttlMs: 10000 });
  const subsystem = new WorkspaceFilesSession({
    paseoHome: directory,
    logger: pino({ level: "silent" }),
    downloadTokenStore: tokens,
    host: {
      emit: (message) => emitted.push(message),
      emitBinary: async () => {},
      hasBinaryChannel: () => false,
    },
    resolveAgentReadDirectory: async (id) => {
      if (id !== "archived-agent") throw new Error("Agent not found");
      return agent;
    },
  });
  const request = async (requestedPath: string, agentId?: string, supported = true) => {
    await subsystem.handleFileDownloadTokenRequest(
      {
        type: "file_download_token_request",
        cwd: workspace,
        path: requestedPath,
        requestId: "download",
        ...(agentId ? { agentId } : {}),
      },
      undefined,
      supported,
    );
    const response = emitted.at(-1);
    if (response?.type !== "file_download_token_response") throw new Error("Missing response");
    return response.payload;
  };
  return { agent, request, attached, tokens };
}
it("issues a token for an authorized retained link and preserves legacy workspace downloads", async () => {
  const { request, attached, tokens } = await setup();
  const response = await request(attached.links.files[0].relativePath, "archived-agent");
  expect(response.error).toBeNull();
  const token = tokens.consumeToken(response.token!);
  expect(await fs.readFile(token!.absolutePath, "utf8")).toBe("saved image");
  const legacy = await request("legacy.txt");
  expect(legacy.error).toBeNull();
  expect(await fs.readFile(tokens.consumeToken(legacy.token!)!.absolutePath, "utf8")).toBe(
    "legacy",
  );
});
it("rejects unsent drafts, traversal, cross-session paths and disabled client capability", async () => {
  const { agent, request, attached } = await setup();
  await fs.mkdir(path.join(agent, "uploads", "draft"));
  await fs.writeFile(path.join(agent, "uploads", "draft", "secret.txt"), "not sent");
  for (const requested of [
    "uploads/draft/secret.txt",
    "../workspace/legacy.txt",
    path.join(path.dirname(agent), "another-agent", attached.links.files[0].relativePath),
  ]) {
    const response = await request(requested, "archived-agent");
    expect(response.token).toBeNull();
    expect(response.error).toBeTruthy();
  }
  expect((await request(attached.links.files[0].relativePath, "other-agent")).token).toBeNull();
  expect(
    (await request(attached.links.files[0].relativePath, "archived-agent", false)).token,
  ).toBeNull();
});
