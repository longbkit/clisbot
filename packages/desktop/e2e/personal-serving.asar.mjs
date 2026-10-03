import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestServiceShutdown } from "../../cli/dist/commands/serve/service-control.js";
import { stopDaemonInstance } from "@clisbot/server/daemon-control";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const { createPackageWithOptions } = require("@electron/asar");
const electron = require("electron");
const scratch = path.join(repo, ".debug/scratch/device-pairing");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(path.join(scratch, "asar-"));
const source = path.join(root, "source");
const home = path.join(root, "home");
const controlFile = path.join(root, "service-control.json");
const workerState = path.join(root, "worker.json");
let supervisorPid;
let hubSupervisorPid;
const hubHome = path.join(root, "hub-home");
const hubControlFile = path.join(hubHome, "hub-control.json");
let completed = false;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("CLISBOT_") && !key.startsWith("PASEO_"),
  ),
);
Object.assign(env, {
  ELECTRON_RUN_AS_NODE: "1",
  CLISBOT_HOME: home,
  CLISBOT_HUB_DATA_DIR: path.join(hubHome, "data"),
  CLISBOT_HUB_CHANNELS_ENABLED: "0",
  CLISBOT_HUB_LOGIN_REQUIRED: "false",
});
// Never inherit an operator database into this packaging fixture.
delete env.DATABASE_URL;

async function waitFor(read, predicate, detail) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const value = await read().catch(() => undefined);
    if (value && predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${detail}`);
}
const readJson = (file) => readFile(file, "utf8").then(JSON.parse);
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function runEntry(entry, ...args) {
  const child = spawn(electron, [runner, "node-script", entry, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    error = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    error += data;
  });
  const [code] = await once(child, "close");
  assert.equal(code, 0, error);
  return JSON.parse(output.trim());
}
const archive = path.join(root, "app.asar");
const runner = path.join(`${archive}.unpacked`, "dist/daemon/node-entrypoint-runner.js");
const fixtureWorker = `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const server = createServer((req,res) => res.end('fixture'));
server.listen(0,'127.0.0.1',() => {
 const listen = '127.0.0.1:' + server.address().port;
 writeFileSync(process.env.FIXTURE_WORKER_STATE,JSON.stringify({pid:process.pid,listen}));
 process.send?.({type:'clisbot:ready',listen,serverId:'asar-fixture'});
});
process.on('message',msg => { if(msg.type==='clisbot:graceful-shutdown') server.close(() => process.exit(0)); });
process.on('SIGTERM',() => server.close(() => process.exit(0)));
`;
try {
  for (const name of ["cli", "server", "hub"]) {
    const target = path.join(source, `node_modules/@clisbot/${name}`);
    await mkdir(target, { recursive: true });
    await cp(path.join(repo, `packages/${name}/package.json`), path.join(target, "package.json"));
    await cp(path.join(repo, `packages/${name}/dist`), path.join(target, "dist"), {
      recursive: true,
    });
  }
  const archivedHub = path.join(source, "node_modules/@clisbot/hub");
  for (const asset of ["bin", ".output", "drizzle"])
    await cp(path.join(repo, "packages/hub", asset), path.join(archivedHub, asset), {
      recursive: true,
    });
  // Owned CLI/server/Hub code and Hub runtime assets are archived. Keep the
  // checkout's third-party dependency versions physical, as in the npm fixture.
  for (const name of ["hub", "cli", "server"]) {
    const dependencies = path.join(repo, "packages", name, "node_modules");
    const linkDependency = async (dependency) => {
      if (["@clisbot/cli", "@clisbot/server", "@clisbot/hub"].includes(dependency)) return;
      const destination = path.join(root, "node_modules", dependency);
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await symlink(path.join(dependencies, dependency), destination, "junction");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    };
    for (const dependency of await readdir(dependencies).catch(() => [])) {
      if (dependency.startsWith(".")) continue;
      const names = dependency.startsWith("@")
        ? (await readdir(path.join(dependencies, dependency))).map(
            (nestedName) => `${dependency}/${nestedName}`,
          )
        : [dependency];
      await Promise.all(names.map(linkDependency));
    }
  }
  await mkdir(path.join(source, "dist/daemon"), { recursive: true });
  await cp(
    path.join(repo, "packages/desktop/dist/daemon/node-entrypoint-runner.js"),
    path.join(source, "dist/daemon/node-entrypoint-runner.js"),
  );
  await writeFile(path.join(source, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(path.join(source, "worker.js"), fixtureWorker);
  // Exercise the actual foundation daemon supervisor, replacing only the agent
  // worker so no native provider or user configuration participates in this probe.
  await writeFile(
    path.join(source, "node_modules/@clisbot/server/dist/server/server/daemon-worker.js"),
    fixtureWorker,
  );
  await writeFile(
    path.join(source, "launch-service.js"),
    `
import { spawn } from 'node:child_process';
import { serviceSupervisorArguments } from './node_modules/@clisbot/cli/dist/commands/serve/service-process.js';
const child = spawn(process.execPath,serviceSupervisorArguments(process.argv[2],[],process.argv[3]),
 {env:process.env,detached:true,stdio:'ignore'});
child.unref(); console.log(JSON.stringify({pid:child.pid}));
`,
  );
  await writeFile(
    path.join(source, "launch-daemon.js"),
    `
import { launchLocalDaemon } from './node_modules/@clisbot/cli/dist/commands/daemon/local-daemon.js';
console.log(JSON.stringify(await launchLocalDaemon({home:process.env.CLISBOT_HOME,listen:'127.0.0.1:0'})));
`,
  );
  await writeFile(
    path.join(source, "launch-hub.js"),
    `
import { startLocalHubDetached } from './node_modules/@clisbot/cli/dist/commands/hub/local-hub.js';
console.log(JSON.stringify(await startLocalHubDetached({
 home:process.argv[2],port:process.argv[3],personal:true,devicePairing:true,
 initMasterKey:true,supervise:true
})));
`,
  );
  await createPackageWithOptions(source, archive, {
    unpackDir: "dist/daemon",
    globOptions: { dot: true },
  });
  env.FIXTURE_WORKER_STATE = workerState;
  supervisorPid = (
    await runEntry(
      path.join(archive, "launch-service.js"),
      path.join(archive, "worker.js"),
      controlFile,
    )
  ).pid;
  assert(supervisorPid > 0);
  const control = await waitFor(
    () => readJson(controlFile),
    (value) => value.pid === supervisorPid,
    "service control",
  );
  assert.equal(control.pid, supervisorPid);
  const initial = await waitFor(
    () => readJson(workerState),
    (value) => value.pid > 0,
    "archived service worker",
  );
  process.kill(initial.pid, "SIGKILL");
  const recovered = await waitFor(
    () => readJson(workerState),
    (value) => value.pid !== initial.pid && alive(value.pid),
    "service worker crash recovery",
  );
  assert(alive(supervisorPid));
  await requestServiceShutdown(controlFile, supervisorPid);
  await waitFor(
    async () => ({ stopped: !alive(supervisorPid) && !alive(recovered.pid) }),
    (value) => value.stopped,
    "owned service shutdown",
  );
  supervisorPid = undefined;
  await rm(workerState);
  await runEntry(path.join(archive, "launch-daemon.js"));
  const daemonWorker = await waitFor(
    () => readJson(workerState),
    (value) => value.pid > 0,
    "archived daemon worker",
  );
  assert(alive(daemonWorker.pid));
  const stopped = await stopDaemonInstance(home, {
    timeoutMs: 30_000,
    force: process.platform === "win32",
  });
  assert(stopped.action === "stopped" || stopped.action === "not_running", JSON.stringify(stopped));
  assert(!alive(daemonWorker.pid));
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const hubPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const hub = await runEntry(path.join(archive, "launch-hub.js"), hubHome, String(hubPort));
  hubSupervisorPid = hub.pid;
  assert(hubSupervisorPid > 0);
  const capabilities = await waitFor(
    () => fetch(`${hub.url}/api/auth/clisbot/device/identity`).then((response) => response.json()),
    (value) => typeof value.hubId === "string" && value.loginRequired === false,
    "actual archived Hub migrations, production assets and device ingress",
  );
  assert.equal(typeof capabilities.hubId, "string");
  await requestServiceShutdown(hubControlFile, hubSupervisorPid);
  await waitFor(
    async () => ({ stopped: !alive(hubSupervisorPid) }),
    (value) => value.stopped,
    "owned archived Hub shutdown",
  );
  hubSupervisorPid = undefined;
  completed = true;
  console.log(
    "PASS: actual Electron imported archived CLI/service/daemon supervisors, recovered an archived worker crash, booted the actual archived Hub with migrations and production assets, and stopped only owned processes. Third-party dependencies use the physical checkout installation.",
  );
} finally {
  if (hubSupervisorPid)
    await requestServiceShutdown(hubControlFile, hubSupervisorPid).catch(() => undefined);
  if (supervisorPid)
    await requestServiceShutdown(controlFile, supervisorPid).catch(() => undefined);
  await stopDaemonInstance(home, { timeoutMs: 30_000, force: process.platform === "win32" }).catch(
    () => undefined,
  );
  if (completed) await rm(root, { recursive: true, force: true });
  else console.error(`Retained asar fixture: ${root}`);
}
