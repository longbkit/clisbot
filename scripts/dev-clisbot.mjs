import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HOME_NAME = ".clisbot-dev-01";
const DAEMON_PORT = 6768;
const HUB_PORT = 6868;
const APP_PORT = 8081;
// The first Metro web bundle in a cold checkout can take several minutes on a
// small dev host. Keep the stack alive while it warms instead of failing a
// healthy server during that one-time compile.
const READY_TIMEOUT_MS = 900_000;

export function parseHubOrigin(value) {
  const raw = value?.trim() || `http://localhost:${HUB_PORT}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid Hub URL: ${raw}`);
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const supportedProtocol = url.protocol === "https:" || (url.protocol === "http:" && loopback);
  if (
    !supportedProtocol ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Hub URL must be an HTTPS origin or a loopback HTTP origin without a path");
  }
  return url.origin;
}

export function resolveDevPaths(environment = process.env, homeDirectory = homedir()) {
  const override = environment["CLISBOT_DEV_HOME"]?.trim();
  if (override && !isAbsolute(override)) {
    throw new Error("CLISBOT_DEV_HOME must be an absolute path");
  }
  const devHome = override || join(homeDirectory, DEFAULT_HOME_NAME);
  return {
    devHome,
    hubDataDirectory: join(devHome, "hub"),
    credentialKeyFile: join(dirname(devHome), `${basename(devHome)}.key`),
  };
}

export async function ensureCredentialKeyFile(path) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${randomBytes(32).toString("base64")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const encoded = (await readFile(path, "utf8")).trim();
  const decoded = Buffer.from(encoded, "base64");
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded) || decoded.byteLength !== 32) {
    throw new Error(`invalid credential key file: ${path}`);
  }
  await chmod(path, 0o600);
}

export function createDevEnvironment(base, paths, hubOrigin) {
  const environment = {
    ...base,
    APP_VARIANT: "development",
    BROWSER: "none",
    CLISBOT_HUB_ORIGIN: hubOrigin,
    EXPO_PORT: String(APP_PORT),
    EXPO_PUBLIC_LOCAL_DAEMON: `localhost:${DAEMON_PORT}`,
    PASEO_CORS_ORIGINS: "*",
    PASEO_DEV_MANAGED_HOME: "1",
    PASEO_HOME: paths.devHome,
    PASEO_HUB_APP_URL: hubOrigin,
    PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: paths.credentialKeyFile,
    PASEO_HUB_DATA_DIR: paths.hubDataDirectory,
    PASEO_LISTEN: `127.0.0.1:${DAEMON_PORT}`,
    PASEO_RELAY_ENABLED: "true",
    PASEO_SKIP_DEV_SERVER_BUILD: "1",
  };

  // The combined dev command always owns an isolated embedded Hub database and
  // one file-backed key. Ambient production settings must not leak into it.
  delete environment["CLISBOT_HUB_DATABASE_URL"];
  delete environment["CLISBOT_HUB_CREDENTIAL_MASTER_KEY"];
  delete environment["DATABASE_URL"];
  delete environment["PASEO_HUB_AUTH_SECRET"];
  delete environment["PASEO_HUB_CREDENTIAL_MASTER_KEY"];
  return environment;
}

export async function clearZombiePidLock(devHome, procRoot = "/proc") {
  const pidPath = join(devHome, "paseo.pid");
  let lock;
  try {
    lock = JSON.parse(await readFile(pidPath, "utf8"));
  } catch {
    return false;
  }
  if (!Number.isInteger(lock?.pid) || lock.pid <= 0) return false;

  let processState;
  try {
    const processStat = await readFile(join(procRoot, String(lock.pid), "stat"), "utf8");
    processState = processStat.slice(processStat.lastIndexOf(")") + 2).split(" ", 1)[0];
  } catch {
    return false;
  }
  if (processState !== "Z") return false;

  try {
    const confirmed = JSON.parse(await readFile(pidPath, "utf8"));
    if (confirmed?.pid !== lock.pid) return false;
    await unlink(pidPath);
    return true;
  } catch {
    return false;
  }
}

async function assertPortAvailable(host, port, label) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      reject(
        error?.code === "EADDRINUSE"
          ? new Error(`${label} port ${host}:${port} is already in use`)
          : error,
      );
    });
    server.listen({ host, port, exclusive: true }, () => server.close(resolvePromise));
  });
}

async function waitForPort(host, port, deadline, signal) {
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const connected = await new Promise((resolvePromise) => {
      const socket = createConnection({ host, port, signal });
      socket.setTimeout(1_000);
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => resolvePromise(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolvePromise(false);
      });
    });
    if (connected) return;
    await delay(1_000, undefined, { signal });
  }
  throw new Error(`daemon did not open port ${port} within ${READY_TIMEOUT_MS / 1_000}s`);
}

export async function waitForHttp(url, label, deadline, signal) {
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await delay(1_000, undefined, { signal });
  }
  throw new Error(`${label} did not become ready within ${READY_TIMEOUT_MS / 1_000}s`);
}

async function waitForWebApp(deadline, signal) {
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const requestTimeout = Math.max(1_000, deadline - Date.now());
      const documentResponse = await fetch(`http://127.0.0.1:${APP_PORT}/`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeout)]),
      });
      if (!documentResponse.ok) throw new Error(`Web App returned ${documentResponse.status}`);
      const document = await documentResponse.text();
      const bundlePath = document
        .match(/src="([^"]+\.bundle[^"]*)"/u)?.[1]
        ?.replaceAll("&amp;", "&");
      if (!bundlePath) throw new Error("Web App document did not contain a bundle URL");

      const bundleResponse = await fetch(new URL(bundlePath, documentResponse.url), {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
        ]),
      });
      if (!bundleResponse.ok) throw new Error(`Web App bundle returned ${bundleResponse.status}`);
      for await (const _chunk of bundleResponse.body ?? []) {
        // Drain the response without retaining the development bundle in memory.
      }
      return;
    } catch {
      // Metro may still be compiling the first bundle.
    }
    await delay(1_000, undefined, { signal });
  }
  throw new Error(`Web App did not bundle within ${READY_TIMEOUT_MS / 1_000}s`);
}

// HTTP health alone does not prove that Vite forwards daemon WebSocket upgrades.
// An unauthenticated upgrade must reach Hub's existing authentication boundary.
export async function verifyHubDaemonSocket(origin, signal) {
  await new Promise((resolvePromise, reject) => {
    const request = httpRequest(new URL("/api/daemons/socket", origin), {
      signal,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": randomBytes(16).toString("base64"),
      },
    });
    request.setTimeout(10_000, () => {
      request.destroy(new Error("Hub daemon WebSocket handshake timed out"));
    });
    request.once("error", reject);
    request.once("response", (response) => {
      response.resume();
      if (response.statusCode === 401) resolvePromise();
      else reject(new Error(`Hub daemon WebSocket returned ${response.statusCode}; expected 401`));
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("Hub daemon WebSocket accepted an unauthenticated connection"));
    });
    request.end();
  });
}

function concurrentlyExecutable() {
  return join(
    ROOT_DIRECTORY,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "concurrently.cmd" : "concurrently",
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    throw new Error("usage: npm run dev:clisbot -- [Hub URL]");
  }

  const hubOrigin = parseHubOrigin(args[0]);
  const paths = resolveDevPaths();
  await mkdir(paths.devHome, { recursive: true, mode: 0o700 });
  await mkdir(paths.hubDataDirectory, { recursive: true, mode: 0o700 });
  await ensureCredentialKeyFile(paths.credentialKeyFile);
  if (await clearZombiePidLock(paths.devHome)) {
    console.log("Removed a stale dev daemon PID lock owned by a zombie process.");
  }

  await Promise.all([
    assertPortAvailable("127.0.0.1", DAEMON_PORT, "Daemon"),
    assertPortAvailable("127.0.0.1", HUB_PORT, "Hub"),
    assertPortAvailable("0.0.0.0", APP_PORT, "App"),
  ]);

  const environment = createDevEnvironment(process.env, paths, hubOrigin);
  console.log("Clisbot dev");
  console.log(`  Home:   ${paths.devHome}`);
  console.log(`  Hub DB: ${paths.hubDataDirectory}`);
  console.log(`  App:    ${hubOrigin}`);
  console.log("  Waiting for Daemon, Hub, and Web App...");

  const stack = spawn(
    concurrentlyExecutable(),
    [
      "--kill-others",
      "--names",
      "daemon,hub,app",
      "npm run dev:server:raw",
      `npm run dev --workspace=@getpaseo/hub -- --host 127.0.0.1 --port ${HUB_PORT} --strictPort`,
      `npm run web:expo --workspace=@getpaseo/app -- --port ${APP_PORT} --max-workers 1`,
    ],
    { cwd: ROOT_DIRECTORY, env: environment, stdio: "inherit" },
  );

  const exit = new Promise((resolvePromise, reject) => {
    stack.once("error", reject);
    stack.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => stack.kill(signal));
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  const readinessController = new AbortController();
  const { signal } = readinessController;
  const readiness = Promise.all([
    waitForPort("127.0.0.1", DAEMON_PORT, deadline, signal),
    waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, "Hub", deadline, signal).then(() =>
      verifyHubDaemonSocket(`http://127.0.0.1:${HUB_PORT}`, signal),
    ),
    waitForWebApp(deadline, signal),
  ]);

  const first = await Promise.race([
    readiness.then(
      () => ({ type: "ready" }),
      (error) => ({ type: "readiness_error", error }),
    ),
    exit.then((result) => ({ type: "exit", result })),
  ]).finally(() => readinessController.abort());
  if (first.type === "exit") {
    process.exitCode = first.result.code ?? 1;
    return;
  }
  if (first.type === "readiness_error") {
    stack.kill("SIGTERM");
    await exit;
    throw first.error;
  }

  console.log(`\nReady: ${hubOrigin}\n`);
  const result = await exit;
  process.exitCode = result.code ?? (result.signal ? 1 : 0);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
