import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearZombiePidLock,
  createDevEnvironment,
  ensureCredentialKeyFile,
  parseHubOrigin,
  resolveDevPaths,
  waitForHttp,
  verifyHubDaemonSocket,
} from "./dev-clisbot.mjs";

test("parseHubOrigin accepts HTTPS and loopback development origins", () => {
  assert.equal(
    parseHubOrigin("https://sandbox.example.ts.net:8444"),
    "https://sandbox.example.ts.net:8444",
  );
  assert.equal(parseHubOrigin(undefined), "http://localhost:6868");
  assert.throws(() => parseHubOrigin("http://example.com"), /HTTPS origin/);
  assert.throws(() => parseHubOrigin("https://example.com/path"), /without a path/);
});

test("resolveDevPaths keeps Hub data under one isolated Clisbot dev root", () => {
  assert.deepEqual(resolveDevPaths({}, "/home/operator"), {
    devHome: "/home/operator/.clisbot-dev-01",
    hubDataDirectory: "/home/operator/.clisbot-dev-01/hub",
    credentialKeyFile: "/home/operator/.clisbot-dev-01.key",
  });
  assert.throws(
    () => resolveDevPaths({ CLISBOT_DEV_HOME: "relative" }, "/home/operator"),
    /absolute path/,
  );
});

test("ensureCredentialKeyFile creates and reuses one private 32-byte key", async () => {
  const root = await mkdtemp(join(tmpdir(), "clisbot-dev-key-"));
  const path = join(root, "credential.key");
  await ensureCredentialKeyFile(path);
  const first = await readFile(path, "utf8");
  await ensureCredentialKeyFile(path);
  assert.equal(await readFile(path, "utf8"), first);
  assert.equal(Buffer.from(first.trim(), "base64").byteLength, 32);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("createDevEnvironment replaces ambient production state", () => {
  const paths = resolveDevPaths({}, "/home/operator");
  const environment = createDevEnvironment(
    {
      DATABASE_URL: "postgres://production",
      PASEO_HOME: "/home/operator/.paseo",
      PASEO_HUB_AUTH_SECRET: "production-secret",
      PASEO_HUB_CREDENTIAL_MASTER_KEY: "production-key",
    },
    paths,
    "https://hub.example.com",
  );
  assert.equal(environment.PASEO_HOME, paths.devHome);
  assert.equal(environment.PASEO_HUB_DATA_DIR, paths.hubDataDirectory);
  assert.equal(environment.PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE, paths.credentialKeyFile);
  assert.equal(environment.PASEO_HUB_CREDENTIAL_MASTER_KEY, undefined);
  assert.equal(environment.PASEO_HUB_AUTH_SECRET, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
});

test("clearZombiePidLock removes only a confirmed zombie owner's lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "clisbot-dev-pid-"));
  const procRoot = join(root, "proc");
  const devHome = join(root, "home");
  await mkdir(join(procRoot, "123"), { recursive: true });
  await mkdir(devHome, { recursive: true });
  await writeFile(join(devHome, "paseo.pid"), JSON.stringify({ pid: 123 }));
  await writeFile(join(procRoot, "123", "stat"), "123 (Paseo Supervisor) Z 1 2 3");

  assert.equal(await clearZombiePidLock(devHome, procRoot), true);
  await assert.rejects(access(join(devHome, "paseo.pid")), /ENOENT/);
});

test(
  "readiness stops a pending HTTP probe when the dev stack exits",
  { timeout: 2_000 },
  async (t) => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const controller = new AbortController();
    t.after(() => controller.abort());
    const requested = once(server, "request");
    const probe = waitForHttp(
      `http://127.0.0.1:${server.address().port}/health`,
      "Hub",
      Date.now() + 900_000,
      controller.signal,
    );
    const stopped = assert.rejects(probe, { name: "AbortError" });
    await requested;
    controller.abort();
    await stopped;
  },
);

test("Hub readiness requires daemon WebSocket authentication, not a healthy HTTP page", async (t) => {
  let status = 200;
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    assert.equal(request.url, "/api/daemons/socket");
    socket.end(`HTTP/1.1 ${status} Result\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signal = AbortSignal.timeout(2_000);
  await assert.rejects(verifyHubDaemonSocket(origin, signal), /returned 200; expected 401/);
  status = 401;
  await verifyHubDaemonSocket(origin, signal);
});
