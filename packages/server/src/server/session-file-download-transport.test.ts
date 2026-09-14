import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

function clientFor(daemon: TestPaseoDaemon) {
  if (daemon.port === 6767) throw new Error("Production daemon port is forbidden");
  const clients: unknown = Reflect.get(daemon.daemon.agentManager, "clients");
  if (!(clients instanceof Map) || clients.get("codex") !== daemon.config.agentClients?.codex)
    throw new Error("Daemon did not install the injected fake provider");
  return new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: `download-${randomUUID()}`,
    clientType: "browser",
    capabilities: { [CLIENT_CAPS.agentSessionStorage]: true },
    reconnect: { enabled: false },
  });
}

it("downloads linked uploads over real WS and HTTP after archive and capture-off restart, excluding unsent and foreign files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-download-transport-"));
  const staticDirectories: string[] = [];
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;
  try {
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      agentSessionStorage: true,
    });
    staticDirectories.push(daemon.staticDir);
    client = clientFor(daemon);
    await client.connect();
    const cwd = root;
    const agent = await client.createAgent({ provider: "codex", cwd, modeId: "bypassPermissions" });
    const other = await client.createAgent({ provider: "codex", cwd, modeId: "bypassPermissions" });
    const bytes = new TextEncoder().encode("retained upload bytes 😀\n");
    const uploaded = await client.uploadFile({
      agentId: agent.id,
      fileName: "retained.txt",
      mimeType: "text/plain",
      bytes,
    });
    expect(uploaded.error).toBeNull();
    if (!uploaded.file) throw new Error("Upload did not return its identity");
    const draft = await client.uploadFile({
      agentId: agent.id,
      fileName: "draft.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("unsent secret"),
    });
    expect(draft.error).toBeNull();
    if (!draft.file) throw new Error("Draft upload did not return its identity");
    const beforeSend = await client.requestDownloadToken(cwd, uploaded.file.path, undefined, {
      agentId: agent.id,
    });
    expect(beforeSend.token).toBeNull();
    await client.sendMessage(agent.id, "use this attachment", {
      attachments: [uploaded.file],
      clientMessageId: randomUUID(),
    });
    expect((await client.waitForFinish(agent.id, 15000)).status).toBe("idle");
    await client.archiveAgent(agent.id);
    await daemon.daemon.agentManager.flush();
    const directory = await daemon.daemon.agentStorage.getSessionDirectory(agent.id);
    const relative = path.relative(directory, uploaded.file.path);
    expect(relative.startsWith("uploads/")).toBe(true);
    await client.close();
    client = undefined;
    await daemon.close();
    daemon = undefined;

    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      agentSessionStorage: false,
    });
    staticDirectories.push(daemon.staticDir);
    client = clientFor(daemon);
    await client.connect();
    expect(client.getLastServerInfoMessage()?.features?.agentSessionStorage).not.toBe(true);
    expect(client.getLastServerInfoMessage()?.features?.agentSessionStorageRead).toBe(true);
    expect((await client.fetchAgent(agent.id))?.agent.archivedAt).toBeTruthy();
    const token = await client.requestDownloadToken(cwd, relative, undefined, {
      agentId: agent.id,
    });
    expect(token.error).toBeNull();
    expect(token.token).toBeTruthy();
    const url = `http://127.0.0.1:${daemon.port}/api/files/download?token=${encodeURIComponent(token.token!)}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("retained.txt");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect((await fetch(url)).status).toBe(403);
    for (const [agentId, requested] of [
      [agent.id, draft.file.path],
      [other.id, uploaded.file.path],
      [agent.id, "../session.json"],
      [agent.id, "uploads/forged/retained.txt"],
    ]) {
      const denied = await client.requestDownloadToken(cwd, requested!, undefined, {
        agentId: agentId!,
      });
      expect(denied.token).toBeNull();
      expect(denied.error).toBeTruthy();
    }
    await fs.writeFile(path.join(cwd, "legacy.txt"), "legacy workspace bytes");
    const legacy = await client.requestDownloadToken(cwd, "legacy.txt");
    expect(legacy.error).toBeNull();
    expect(
      await (
        await fetch(
          `http://127.0.0.1:${daemon.port}/api/files/download?token=${encodeURIComponent(legacy.token!)}`,
        )
      ).text(),
    ).toBe("legacy workspace bytes");
  } finally {
    await client?.close();
    await daemon?.close();
    await Promise.all(
      [root, ...staticDirectories].map((directory) =>
        fs.rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}, 60000);
