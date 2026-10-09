import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releasePackages } from "./npm-release.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(repo, ".debug", "scratch", "npm-installed-smoke");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(path.join(scratch, "v2-"));
const artifacts = path.join(fixture, "artifacts");
const prefix = path.join(fixture, "prefix");
const home = path.join(fixture, "home");
const project = path.join(home, "workspaces", "assistant");
await mkdir(artifacts);
await mkdir(project, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("CLISBOT_") &&
      !key.startsWith("PASEO_") &&
      key !== "ELECTRON_RUN_AS_NODE" &&
      key !== "DATABASE_URL",
  ),
);
Object.assign(env, {
  CLISBOT_HOME: home,
  CLISBOT_HUB_CHANNELS_ENABLED: "0",
  CLISBOT_USAGE_REPORTING: "0",
  CLISBOT_WEB_UI_ENABLED: "true",
  CLISBOT_DICTATION_ENABLED: "false",
  CLISBOT_VOICE_MODE_ENABLED: "false",
  npm_config_prefix: prefix,
});

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    errors += data;
  });
  const [code] = await once(child, "close");
  if (code !== 0)
    throw new Error(`${command} failed (${code}): ${errors.slice(-4000)}${output.slice(-1000)}`);
  return output;
}

const npm = (args) => run("npm", args, { shell: process.platform === "win32" });
const packages = releasePackages();
console.log(`Packing ${packages.length} release packages. Fixture: ${fixture}`);
const packs = JSON.parse(
  await npm([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    artifacts,
    ...packages.flatMap((pkg) => ["--workspace", pkg.workspace]),
  ]),
);
await writeFile(path.join(fixture, "pack-manifest.json"), JSON.stringify(packs, null, 2));

const archiveData = new Map();
for (const pack of packs)
  archiveData.set(pack.filename, await readFile(path.join(artifacts, pack.filename)));
let registryOrigin;
const registry = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
  if (archiveData.has(name)) return response.end(archiveData.get(name));
  const pkg = packages.find((candidate) => candidate.name === name);
  if (!pkg) {
    response.writeHead(302, { Location: `https://registry.npmjs.org${request.url}` });
    return response.end();
  }
  const pack = packs.find((candidate) => candidate.name === name);
  const bytes = archiveData.get(pack.filename);
  const manifest = {
    ...pkg,
    dist: {
      tarball: `${registryOrigin}/${pack.filename}`,
      shasum: createHash("sha1").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    },
  };
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      name,
      "dist-tags": { latest: pkg.version },
      versions: { [pkg.version]: manifest },
    }),
  );
});
registry.listen(0, "127.0.0.1");
await once(registry, "listening");
registryOrigin = `http://127.0.0.1:${registry.address().port}`;
try {
  await npm([
    "install",
    "--global",
    "--prefix",
    prefix,
    "--no-audit",
    "--no-fund",
    "--registry",
    registryOrigin,
    `clisbot@${packages.at(-1).version}`,
  ]);
  const installedModules = path.join(
    prefix,
    process.platform === "win32" ? "node_modules" : "lib/node_modules",
  );
  const entryRequire = createRequire(path.join(installedModules, "clisbot", "package.json"));
  const cliRequire = createRequire(entryRequire.resolve("@clisbot/cli/bin/clisbot"));
  const serverEntry = pathToFileURL(cliRequire.resolve("@clisbot/server/daemon-control"));
  const { npmGlobalClisbotCli } = await import(
    new URL("./session/daemon/npm-global-cli.js", serverEntry).href
  );
  const { DaemonSelfUpdater } = await import(
    new URL("./session/daemon/daemon-self-updater.js", serverEntry).href
  );
  const installed = await npmGlobalClisbotCli.inspect({ prefix });
  assert.equal(installed.packagePath, path.join(installedModules, "clisbot"));
  assert.equal(installed.version, packages.at(-1).version);
  assert.equal(installed.isLinked, false);

  // Exercise the shipped updater with real npm, using only this fixture prefix.
  const npmEnvironment = { npm_config_prefix: prefix, npm_config_registry: registryOrigin };
  const previousEnvironment = Object.fromEntries(
    Object.keys(npmEnvironment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, npmEnvironment);
  try {
    const phases = [];
    const result = await new DaemonSelfUpdater().update({
      daemonVersion: installed.version,
      desktopManaged: false,
      onProgress: (phase) => phases.push(phase),
      logger: {
        error: (_details, message) => console.error(message),
        warn: (_details, message) => console.warn(message),
      },
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.newVersion, installed.version);
    assert.deepEqual(phases, ["starting", "downloading", "installing", "complete"]);
    console.log("PASS: shipped updater inspected and updated clisbot@latest with real npm.");
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
} finally {
  registry.closeAllConnections();
  await new Promise((resolve) => registry.close(resolve));
}

const globalModules = path.join(
  prefix,
  process.platform === "win32" ? "node_modules" : "lib/node_modules",
);
const requireEntry = createRequire(path.join(globalModules, "clisbot", "package.json"));
const require = createRequire(requireEntry.resolve("@clisbot/cli/bin/clisbot"));
const verified = new Set();
async function verifyInstalled(manifest) {
  if (verified.has(manifest)) return;
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(pkg.version, packages.at(-1).version);
  assert(
    (await realpath(manifest)).startsWith(prefix + path.sep),
    `${pkg.name} escaped installation`,
  );
  verified.add(manifest);
  const fromPackage = createRequire(manifest);
  for (const name of Object.keys(pkg.dependencies ?? {}).filter((dependency) =>
    dependency.startsWith("@clisbot/"),
  )) {
    const candidate = fromPackage.resolve
      .paths(name)
      .map((directory) => path.join(directory, name, "package.json"))
      .find(existsSync);
    assert(candidate, `Missing installed dependency: ${pkg.name} -> ${name}`);
    await verifyInstalled(candidate);
  }
}
await verifyInstalled(path.join(globalModules, "clisbot", "package.json"));
assert.equal(verified.size, packages.length);
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const { DaemonClient } = await load("@clisbot/client/internal/daemon-client");
const { createDeviceKey } = await load("@clisbot/device-access/proof");
const { parseDevicePairingOfferFromUrl } = await load("@clisbot/protocol/device-pairing-offer");
const { readDaemonInstance } = await load("@clisbot/server/daemon-control");
const { default: WebSocket } = await load("ws");
const entry = path.join(globalModules, "clisbot", "bin", "clisbot");
const cli = (args) => run(process.execPath, [entry, ...args, "--home", home], { cwd: fixture });
let daemon;
try {
  for (const alias of ["clisbot", "clis"]) {
    const bin = path.join(
      prefix,
      process.platform === "win32" ? "" : "bin",
      alias + (process.platform === "win32" ? ".cmd" : ""),
    );
    assert(
      (
        await run(bin, ["--version"], { cwd: fixture, shell: process.platform === "win32" })
      ).includes(packages.at(-1).version),
    );
  }
  const old = JSON.stringify({
    meta: { schemaVersion: "0.1.53" },
    agents: {
      list: [{ id: "assistant", name: "Migrated assistant", cli: "codex", workspace: project }],
    },
    bots: { slack: { test: { botToken: "fixture-secret-never-log" } } },
  });
  await writeFile(path.join(home, "clisbot.json"), old);
  const onboard = JSON.parse(
    await cli(["onboard", "--transport", "local", "--voice", "disable", "--json"]),
  );
  assert.equal(await readFile(path.join(home, "clisbot.json"), "utf8"), old);
  const reportRaw = await readFile(path.join(home, "v1-upgrade.json"), "utf8");
  assert(!reportRaw.includes("fixture-secret-never-log"));
  const report = JSON.parse(reportRaw);
  assert.equal(report.phase, "prepared");
  assert(report.registeredWorkspaces.includes(project));
  const initial = await readDaemonInstance(home);
  const offer = parseDevicePairingOfferFromUrl(onboard.url);
  assert(offer?.pairing && !offer.hub);
  daemon = new DaemonClient({
    url: `${onboard.origin.replace(/^http/, "ws")}/ws`,
    clientId: "v2-install-smoke",
    deviceAccess: {
      backendId: offer.serverId,
      key: createDeviceKey(randomBytes(32)),
      invitationToken: offer.pairing.token,
    },
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
    reconnect: { enabled: false },
  });
  await daemon.connect();
  const started = await daemon.startLocalHub({ transport: "local", label: "V2 installed smoke" });
  const webApp = await fetch(`${onboard.origin}/`);
  assert(webApp.ok, `Installed shared app returned HTTP ${webApp.status}`);
  assert.match(await webApp.text(), /<html/iu);
  assert.equal((await fetch(`${started.origin}/api/auth/clisbot/device/identity`)).status, 200);
  assert.equal((await readDaemonInstance(home)).pid, initial.pid);
  console.log(
    `PASS: all ${packages.length} real npm artifacts and fresh dependencies installed; both aliases, v1 upgrade, Project registration, pairing, shared app UI and packaged Hub backend passed.`,
  );
} finally {
  await daemon?.close();
  for (const args of [
    ["hub", "stop", "--web"],
    ["hub", "stop"],
    ["daemon", "stop"],
  ])
    await cli(args).catch((error) => console.error("Fixture cleanup:", error.message));
}
