/** Actual published official artifacts. Run only with an explicitly staged isolated artifact directory. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { createPaseoDaemon } from "./bootstrap.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

const execute = promisify(execFile);
const artifacts = process.env.PASEO_OFFICIAL_ARTIFACT_DIR;
let OfficialClient: typeof DaemonClient;
let createOfficialDaemon: typeof createPaseoDaemon;
let officialCli: string;

async function artifactFile(name: string, file: string): Promise<string> {
  const root = resolve(artifacts!, "node_modules", "@getpaseo", name);
  const target = await realpath(join(root, file));
  if (!target.startsWith(`${root}/`)) throw new Error(`Artifact escaped isolated package: ${name}`);
  return target;
}
function connect(Client: typeof DaemonClient, daemon: TestPaseoDaemon, clientId: string) {
  if (daemon.port === 6767) throw new Error("Production daemon port is forbidden");
  // Fail before creating any agent if the published bootstrap did not preserve the fixture seam.
  const clients: unknown = Reflect.get(daemon.daemon.agentManager, "clients");
  if (!(clients instanceof Map) || clients.get("codex") !== daemon.config.agentClients?.codex)
    throw new Error("Daemon did not install the injected fake Codex client");
  return new Client({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId,
    clientType: "browser",
    reconnect: { enabled: false },
  });
}
async function complete(client: DaemonClient, agentId: string): Promise<void> {
  const result = await client.waitForFinish(agentId, 15_000);
  expect(result.error).toBeNull();
  expect(result.status).toBe("idle");
}
async function exerciseClient(Client: typeof DaemonClient, daemon: TestPaseoDaemon) {
  const clientId = `official-matrix-${randomUUID()}`;
  let client = connect(Client, daemon, clientId);
  await client.connect();
  try {
    expect(client.getLastServerInfoMessage()?.serverId).toBeTruthy();
    const agent = await client.createAgent({
      provider: "codex",
      cwd: daemon.paseoHome,
      modeId: "bypassPermissions",
      initialPrompt: "matrix initial message",
    });
    await complete(client, agent.id);
    for (let index = 0; index < 3; index++) {
      await client.sendMessage(agent.id, `matrix message ${index}`);
      await complete(client, agent.id);
    }
    const uploaded = await client.uploadFile({
      agentId: agent.id,
      fileName: "matrix.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("exact official matrix upload"),
    });
    expect(uploaded.error).toBeNull();
    expect(uploaded.file).toBeTruthy();
    await client.sendMessage(agent.id, "matrix with attachment", { attachments: [uploaded.file!] });
    await complete(client, agent.id);
    const page = await client.fetchAgentTimeline(agent.id, { limit: 2, projection: "projected" });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.hasOlder).toBe(true);
    expect(page.startCursor).toBeTruthy();
    const older = await client.fetchAgentTimeline(agent.id, {
      limit: 2,
      projection: "projected",
      direction: "before",
      cursor: page.startCursor!,
    });
    expect(older.entries.length).toBeGreaterThan(0);
    expect(older.endCursor!.seq).toBeLessThan(page.startCursor!.seq);
    await client.close();
    client = connect(Client, daemon, clientId);
    await client.connect();
    expect((await client.fetchAgentTimeline(agent.id, { limit: 2 })).entries).toEqual(page.entries);
    const ask = await client.createAgent({
      provider: "codex",
      cwd: daemon.paseoHome,
      modeId: "default",
    });
    await client.sendMessage(ask.id, "echo hello");
    expect((await client.waitForFinish(ask.id, 15_000)).status).toBe("permission");
    const request = (await client.fetchAgent(ask.id))!.agent.pendingPermissions[0]!;
    await client.respondToPermissionAndWait(ask.id, request.id, { behavior: "allow" });
    await complete(client, ask.id);
    expect((await client.fetchAgent(ask.id))!.agent.pendingPermissions).toEqual([]);
  } finally {
    await client.close();
  }
}

describe.skipIf(!artifacts)("published official artifact session-storage matrix", () => {
  beforeAll(async () => {
    const manifest = JSON.parse(await readFile(join(artifacts!, "artifact-manifest.json"), "utf8"));
    expect(manifest.version).toBe("0.8.0");
    for (const name of ["server", "client", "cli", "protocol"]) {
      const entry = manifest.packages.find(
        (pkg: { name: string }) => pkg.name === `@getpaseo/${name}`,
      );
      expect(entry?.integrity).toMatch(/^sha512-/);
      expect(
        JSON.parse(await readFile(await artifactFile(name, "package.json"), "utf8")).version,
      ).toBe("0.8.0");
    }
    ({ DaemonClient: OfficialClient } = await import(
      pathToFileURL(await artifactFile("client", "dist/daemon-client.js")).href
    ));
    expect(
      await readFile(await artifactFile("server", "dist/server/server/bootstrap.js"), "utf8"),
    ).toMatch(/extraClients:\s*config\.agentClients/);
    ({ createPaseoDaemon: createOfficialDaemon } = await import(
      pathToFileURL(await artifactFile("server", "dist/server/server/exports.js")).href
    ));
    officialCli = await artifactFile("cli", "bin/paseo");
  }, 30_000);
  test.each([false, true])(
    "official client against Fusion capture=%s",
    async (enabled) => {
      const daemon = await createTestPaseoDaemon({ agentSessionStorage: enabled });
      try {
        await exerciseClient(OfficialClient, daemon);
      } finally {
        await daemon.close();
      }
    },
    60_000,
  );
  test("Fusion client against the official daemon", async () => {
    const daemon = await createTestPaseoDaemon({ createDaemon: createOfficialDaemon });
    try {
      await exerciseClient(DaemonClient, daemon);
    } finally {
      await daemon.close();
    }
  }, 60_000);
  test("official CLI creates, sends an image, approves, pages logs, and reconnects to Fusion off", async () => {
    const daemon = await createTestPaseoDaemon({ agentSessionStorage: false });
    const client = connect(OfficialClient, daemon, `cli-observer-${randomUUID()}`);
    const cli = async (args: string[]) =>
      execute(process.execPath, [officialCli, ...args], {
        env: {
          ...process.env,
          PASEO_AGENT_ID: undefined,
          PASEO_AGENT_CWD: undefined,
          PASEO_HOST: `127.0.0.1:${daemon.port}`,
          PASEO_HOME: daemon.paseoHome,
          PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
        },
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      });
    try {
      await client.connect();
      const created = await cli([
        "-q",
        "run",
        "-d",
        "--provider",
        "codex",
        "--mode",
        "bypassPermissions",
        "--cwd",
        daemon.paseoHome,
        "official CLI start",
      ]);
      const id = created.stdout.trim();
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      await complete(client, id);
      const image = join(daemon.paseoHome, "pixel.png");
      await writeFile(
        image,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      await cli(["send", id, "official CLI attachment", "--image", image]);
      const logs = await cli(["logs", id, "--tail", "2"]);
      expect(logs.stdout.length).toBeGreaterThan(0);
      const ask = await client.createAgent({
        provider: "codex",
        cwd: daemon.paseoHome,
        modeId: "default",
      });
      await client.sendMessage(ask.id, "echo hello");
      expect((await client.waitForFinish(ask.id, 15_000)).status).toBe("permission");
      const request = (await client.fetchAgent(ask.id))!.agent.pendingPermissions[0]!;
      await cli(["permit", "allow", ask.id, request.id]);
      await complete(client, ask.id);
      expect((await cli(["logs", ask.id, "--tail", "1"])).stdout.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await daemon.close();
    }
  }, 90_000);
});
