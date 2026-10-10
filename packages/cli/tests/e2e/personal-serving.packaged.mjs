import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { createDeviceKey } from "@clisbot/device-access/proof";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { readDaemonInstance } from "@clisbot/server/daemon-control";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const scratch = path.join(repo, ".debug/scratch/device-pairing");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(path.join(scratch, "npm-artifacts-"));
const artifacts = path.join(root, "artifacts");
const installation = path.join(root, "installation");
const home = path.join(root, "home");
await mkdir(artifacts);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("CLISBOT_") && !key.startsWith("PASEO_") && key !== "ELECTRON_RUN_AS_NODE",
  ),
);
// Isolated homes must never select an operator's shared PostgreSQL database.
delete env.DATABASE_URL;
Object.assign(env, {
  CLISBOT_HOME: home,
  CLISBOT_HUB_CHANNELS_ENABLED: "0",
  CLISBOT_USAGE_REPORTING: "0",
  CLISBOT_DICTATION_ENABLED: "false",
  CLISBOT_VOICE_MODE_ENABLED: "false",
  CLISBOT_WEB_UI_ENABLED: "true",
});
async function run(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"], ...options });
  let out = "",
    error = "";
  child.stdout.on("data", (data) => {
    out += data;
  });
  child.stderr.on("data", (data) => {
    error += data;
  });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`Artifact command failed (${code}): ${error.slice(-3000)}`);
  return out;
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packages = ["protocol", "relay", "device-access", "client", "server", "hub", "cli"];
const cliEntry = path.join(installation, "node_modules/@clisbot/cli/dist/index.js");
const cli = (args) => run(process.execPath, [cliEntry, ...args, "--home", home]);
let daemon;
let completed = false;
try {
  const packedPaths = {};
  for (const name of packages) {
    // Skip lifecycle scripts so the shared checkout's compiled stack stays frozen.
    const [pack] = JSON.parse(
      await run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], {
        cwd: path.join(repo, "packages", name),
        shell: process.platform === "win32",
      }),
    );
    packedPaths[name] = pack.files.map((file) => file.path);
    const destination = path.join(installation, "node_modules/@clisbot", name);
    await mkdir(destination, { recursive: true });
    await run("tar", [
      "-xzf",
      path.join(artifacts, pack.filename),
      "--strip-components=1",
      "-C",
      destination,
    ]);
    // npm workspaces may keep conflicting third-party versions under a package
    // rather than hoist them. Preserve those versions without replacing any of
    // the seven owned packages under test with checkout symlinks.
    const dependencies = path.join(repo, "packages", name, "node_modules");
    const link = async (dependency) => {
      if (dependency.startsWith("@clisbot/") && packages.includes(dependency.slice(9))) return;
      const target = path.join(destination, "node_modules", dependency);
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(path.join(dependencies, dependency), target, "junction");
    };
    for (const dependency of await readdir(dependencies).catch(() => [])) {
      if (dependency.startsWith(".")) continue;
      const names = dependency.startsWith("@")
        ? (await readdir(path.join(dependencies, dependency))).map(
            (nestedName) => `${dependency}/${nestedName}`,
          )
        : [dependency];
      await Promise.all(names.map(link));
    }
  }
  for (const file of [
    "dist/index.js",
    "dist/commands/serve/service-supervisor-entry.js",
    "dist/commands/serve/service-process.js",
    "dist/commands/serve/service-control.js",
    "dist/commands/serve/gateway-entry.js",
    "dist/utils/node-entrypoint.js",
  ])
    assert(packedPaths.cli.includes(file), `Missing CLI artifact ${file}`);
  for (const file of [
    "dist/scripts/supervisor-entrypoint.js",
    "dist/scripts/supervisor.js",
    "dist/server/server/daemon-worker.js",
  ])
    assert(packedPaths.server.includes(file), `Missing daemon artifact ${file}`);
  for (const file of [
    "bin/clisbot-hub.js",
    "dist/index.js",
    "dist/runtime-files.js",
    "drizzle/meta/_journal.json",
  ])
    assert(packedPaths.hub.includes(file), `Missing Hub artifact ${file}`);
  await writeFile(
    path.join(installation, "resolve.cjs"),
    `
const names = ['@clisbot/protocol/device-pairing-offer','@clisbot/relay','@clisbot/device-access/proof','@clisbot/client',
 '@clisbot/server','@clisbot/hub/package.json','@clisbot/cli/bin/clisbot'];
console.log(JSON.stringify(names.map(name => require.resolve(name))));
`,
  );
  const resolved = JSON.parse(
    await run(process.execPath, [path.join(installation, "resolve.cjs")]),
  );
  for (const file of resolved)
    assert(
      file.startsWith(installation + path.sep),
      `Owned package escaped artifact tree: ${file}`,
    );
  console.log(
    "All seven owned packages resolve from real npm-pack artifacts; third-party dependencies use the checkout installation.",
  );
  const onboard = JSON.parse(
    await cli(["onboard", "--transport", "local", "--voice", "disable", "--json"]),
  );
  // Start Hub is delegated to a managed CLI child, which reads persisted config.
  await cli(["daemon", "config", "set", "features.webUi.enabled", "true"]);
  const initial = await readDaemonInstance(home);
  const offer = parseDevicePairingOfferFromUrl(onboard.url);
  assert(offer?.pairing && !offer.hub);
  daemon = new DaemonClient({
    url: `${onboard.origin.replace(/^http/, "ws")}/ws`,
    clientId: "npm-artifact-phone",
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
  assert.equal(daemon.getLastServerInfoMessage().features.localHubStart, true);
  const started = await daemon.startLocalHub({ transport: "local", label: "Artifact phone" });
  assert(started.hub?.pairing);
  assert.equal(started.origin, onboard.origin);
  assert.equal((await readDaemonInstance(home)).pid, initial.pid);
  assert.equal((await fetch(`${started.origin}/api/auth/clisbot/device/identity`)).status, 200);
  assert((await fetch(`${started.origin}/`)).ok);
  assert.equal((await daemon.devices()).devices.length, 1);
  completed = true;
  console.log(
    "PASS: npm artifact CLI started/reused daemon and gateway, paired device, delegated explicit Start Hub to installed CLI, booted actual packaged Hub migrations/assets and retained daemon PID/socket.",
  );
} finally {
  await daemon?.close();
  for (const args of [
    ["hub", "stop", "--web"],
    ["hub", "stop"],
    ["daemon", "stop"],
  ])
    await cli(args).catch((error) => console.error("Artifact cleanup:", error.message));
  if (completed) await rm(root, { recursive: true, force: true });
  else console.error(`Retained npm artifact fixture: ${root}`);
}
