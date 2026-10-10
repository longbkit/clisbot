import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeModule = "packages/server/dist/server/server/agent/providers/opencode/bridge.js";

// Mirrors nix/package.nix's installPhase: copy every traced path into $out.
async function installTracedDaemon(outRoot) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(repoRoot, "scripts/trace-daemon.mjs")],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  for (const file of stdout.split("\n").filter(Boolean)) {
    await cp(path.join(repoRoot, file), path.join(outRoot, file), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

test("traced closure ships OpenCode bridges, channels and a working local Hub", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "trace-daemon-dist-"));
  try {
    await installTracedDaemon(outRoot);
    const pins = JSON.parse(
      await readFile(path.join(outRoot, "packages/hub/channel-pins.json"), "utf8"),
    );
    for (const pin of Object.values(pins.channels).filter(
      (candidate) => candidate.loadMode === "in-repo",
    )) {
      for (const entry of [pin.entry, pin.plugin.specifier]) {
        await access(path.join(outRoot, "node_modules", pin.inRepoPackage, entry));
      }
    }
    await smokeHub(outRoot);
    const installedBridgeUrl = pathToFileURL(path.join(outRoot, bridgeModule)).href;
    const { loadOpenCodeBridgePluginArtifact } = await import(installedBridgeUrl);

    for (const version of [1, 2]) {
      const artifact = await loadOpenCodeBridgePluginArtifact(
        installedBridgeUrl,
        undefined,
        version,
      );
      assert.ok(artifact.byteLength > 0, `OpenCode v${version} bridge plugin is empty`);
    }
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});

// Boot from the copied closure, outside the source tree, with an isolated database.
async function smokeHub(outRoot) {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const hub = spawn(process.execPath, [path.join(outRoot, "packages/hub/bin/clisbot-hub.js")], {
    cwd: outRoot,
    env: {
      PATH: process.env.PATH,
      HOME: outRoot,
      CLISBOT_HOME: path.join(outRoot, "home"),
      CLISBOT_HUB_BIND: "127.0.0.1",
      CLISBOT_HUB_CHANNELS_ENABLED: "0",
      CLISBOT_HUB_CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  hub.stdout.on("data", (data) => {
    output += data;
  });
  hub.stderr.on("data", (data) => {
    output += data;
  });
  const closed = once(hub, "close");
  let timer;
  try {
    await Promise.race([
      once(hub, "message").then(([message]) => assert.equal(message.type, "clisbot:ready")),
      closed.then(([code]) => {
        throw new Error(`Packaged Hub exited (${code}): ${output}`);
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Packaged Hub timed out: ${output}`)), 60000);
      }),
    ]);
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(health.status, 200);
  } finally {
    clearTimeout(timer);
    hub.kill("SIGTERM");
    const killTimer = setTimeout(() => hub.kill("SIGKILL"), 5000);
    await closed;
    clearTimeout(killTimer);
  }
}
