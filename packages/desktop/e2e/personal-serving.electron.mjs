import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "playwright/test";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import { editPersistedConfig } from "@clisbot/server/configuration";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const scratch = path.join(repo, ".debug/scratch/device-pairing");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(path.join(scratch, "electron-"));
const home = path.join(root, "home");
const userData = path.join(root, "user-data");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("CLISBOT_") && !key.startsWith("PASEO_") && key !== "ELECTRON_RUN_AS_NODE",
  ),
);
// Isolated homes must never select an operator's shared PostgreSQL database.
delete env.DATABASE_URL;
if (process.env.CLISBOT_E2E_SECRET_SERVICE === "1") env.CLISBOT_E2E_SECRET_SERVICE = "1";
Object.assign(env, {
  CLISBOT_HOME: home,
  CLISBOT_TAILSCALE_BIN: path.join(root, "missing-tailscale"),
  CLISBOT_HUB_CHANNELS_ENABLED: "0",
  CLISBOT_DICTATION_ENABLED: "false",
  CLISBOT_VOICE_MODE_ENABLED: "false",
  CLISBOT_USAGE_REPORTING: "0",
});
const main = path.join(root, "fixture.cjs");
const preload = path.join(root, "preload.cjs");
await writeFile(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('secrets', { read: key => ipcRenderer.invoke('clisbot:device-secret:read',key), write: (key,value) => ipcRenderer.invoke('clisbot:device-secret:write',key,value), remove: key => ipcRenderer.invoke('clisbot:device-secret:delete',key) });`,
);
await writeFile(
  main,
  `
const { app, protocol, BrowserWindow, safeStorage } = require('electron');
// Playwright's preload forces password-store=basic, overriding launch arguments.
// The owned Secret Service fixture must select its real keyring before app ready.
if (process.env.CLISBOT_E2E_SECRET_SERVICE === '1') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
app.setPath('userData', ${JSON.stringify(userData)});
protocol.registerSchemesAsPrivileged([{ scheme:'clisbot', privileges:{ standard:true, secure:true } }]);
app.whenReady().then(async () => {
 await require(${JSON.stringify(path.join(repo, "packages/desktop/dist/daemon/personal-serving.js"))}).preparePersonalDesktopHome(${JSON.stringify(home)});
 protocol.handle('clisbot', () => new Response('<html><body>Device credential fixture</body></html>',{headers:{'content-type':'text/html'}}));
 require(${JSON.stringify(path.join(repo, "packages/desktop/dist/features/device-credentials.js"))}).registerDeviceCredentialHandlers();
 global.fixture = require(${JSON.stringify(path.join(repo, "packages/desktop/dist/daemon/daemon-manager.js"))});
 const window = new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)}}});
 await window.loadURL('clisbot://app');
 global.fixtureReady = true;
});
`,
);
async function cli(args) {
  const child = spawn(
    process.execPath,
    [path.join(repo, "packages/cli/dist/index.js"), ...args, "--home", home],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    },
  );
  let output = "";
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.resume();
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`CLI cleanup failed (${code})`);
  return output;
}
let desktop;
let completed = false;
try {
  desktop = await electron.launch({
    args: [
      "--no-sandbox",
      ...(env.CLISBOT_E2E_SECRET_SERVICE === "1" ? ["--password-store=gnome-libsecret"] : []),
      main,
    ],
    env,
  });
  await expect
    .poll(() => desktop.evaluate(() => global.fixtureReady === true), { timeout: 15_000 })
    .toBe(true);
  // Managed daemon launches deliberately discard setting environment overrides.
  // Persist fixture speech settings so onboarding cannot download real models.
  editPersistedConfig(home, "features.dictation.enabled", { value: false });
  editPersistedConfig(home, "features.voiceMode.enabled", { value: false });
  if (env.CLISBOT_E2E_SECRET_SERVICE === "1") {
    assert.equal(process.platform, "linux");
    assert.equal(
      await desktop.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()),
      true,
    );
    assert.equal(
      await desktop.evaluate(({ safeStorage }) => safeStorage.getSelectedStorageBackend()),
      "gnome_libsecret",
    );
  }
  const status = await desktop.evaluate(() =>
    global.fixture.createDaemonCommandHandlers().start_desktop_daemon(),
  );
  assert.equal(status.status, "running");
  assert.equal(status.ownedByDesktop, true);
  assert.equal(status.servingError, undefined);
  const daemonOnlyOffer = parseDevicePairingOfferFromUrl(status.pairingUrl);
  assert(daemonOnlyOffer?.pairing);
  assert.equal(daemonOnlyOffer.hub, undefined);
  await assert.rejects(readFile(path.join(home, "hub-local.json")));
  const startedHub = await desktop.evaluate(
    (_electron, serverId) =>
      global.fixture
        .createDaemonCommandHandlers()
        .desktop_start_hub({ serverId, transport: "local" }),
    status.serverId,
  );
  const offer = parseDevicePairingOfferFromUrl(startedHub.url);
  assert(offer?.hub?.pairing);
  const first = await readDaemonInstance(home);
  const repeated = await desktop.evaluate(() =>
    global.fixture.createDaemonCommandHandlers().start_desktop_daemon(),
  );
  assert.equal(repeated.pid, first.pid);
  assert.equal(repeated.pairingUrl, status.pairingUrl);
  const shared = await desktop.evaluate(
    (_electron, serverId) =>
      global.fixture.createDaemonCommandHandlers().desktop_daemon_pairing_offer({ serverId }),
    status.serverId,
  );
  const sharedOffer = parseDevicePairingOfferFromUrl(shared.url);
  assert(sharedOffer?.hub?.pairing);
  assert.equal(sharedOffer.hub.hubId, offer.hub.hubId);
  assert.notEqual(sharedOffer.pairing.token, offer.pairing.token);
  assert.notEqual(sharedOffer.hub.pairing.token, offer.hub.pairing.token);
  assert.equal((await readDaemonInstance(home)).pid, first.pid);
  assert.equal(
    await desktop.evaluate(() =>
      global.fixture
        .createDaemonCommandHandlers()
        .desktop_daemon_pairing_offer({ serverId: "foreign-host" }),
    ),
    null,
  );
  const page = await desktop.firstWindow();
  const storageKey = "clisbot_device.fixture";
  await page.evaluate((key) => window.secrets.write(key, "private-device-fixture"), storageKey);
  assert.equal(
    await page.evaluate((key) => window.secrets.read(key), storageKey),
    "private-device-fixture",
  );
  const stored = await readFile(path.join(userData, "device-credentials", storageKey));
  assert.equal(stored.includes(Buffer.from("private-device-fixture")), false);
  await assert.rejects(
    page.evaluate(() => window.secrets.read("../outside")),
    /Invalid device storage key/,
  );
  await page.goto("clisbot://untrusted");
  await assert.rejects(
    page.evaluate((key) => window.secrets.read(key), storageKey),
    /only to the Clisbot renderer/,
  );
  await page.goto("clisbot://app");
  await page.evaluate((key) => window.secrets.remove(key), storageKey);
  assert.equal(await page.evaluate((key) => window.secrets.read(key), storageKey), null);
  await assert.rejects(stat(path.join(home, "models", "local-speech", ".downloads")), {
    code: "ENOENT",
  });
  console.log(
    "Electron starts daemon only, explicitly starts Hub + gateway without restarting daemon; OS-encrypted credentials and trusted renderer IPC verified.",
  );
  completed = true;
} finally {
  // The Hub and daemon outlive the fixture app; stop them before closing it.
  for (const args of [
    ["hub", "stop", "--web"],
    ["hub", "stop"],
    ["daemon", "stop"],
  ])
    await cli(args).catch((error) => console.error(error.message));
  await closeDesktop(desktop);
  if (completed) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  else console.error(`Isolated fixture retained: ${root}`);
}

// The fixture app is not the product quit path, so a stuck close must not hang CI
// until the job timeout. Report it and kill the fixture instead.
async function closeDesktop(app) {
  if (!app) return;
  let timer;
  const closed = await Promise.race([
    app.close().then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(resolve, 20_000, false);
    }),
  ]).finally(() => clearTimeout(timer));
  if (closed) return;
  console.error("Electron fixture did not exit within 20s of close(); killing it.");
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit", { signal: AbortSignal.timeout(5_000) });
  child.kill("SIGKILL");
  await exited;
}
