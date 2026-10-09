import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { HubDeviceTransport } from "@clisbot/client/internal/hub-device-transport";
import {
  createDeviceKey,
  signDeviceProof,
  digest,
  httpBinding,
} from "@clisbot/device-access/proof";
import { buildRelayWebSocketUrl } from "@clisbot/protocol/daemon-endpoints";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
process.chdir(fileURLToPath(new URL("../../../../", import.meta.url)));
await mkdir(resolvePath(".debug/scratch/device-pairing"), {
  recursive: true,
  mode: 0o700,
});
let completed = false;
const taskHome = await mkdtemp(resolvePath(".debug/scratch/device-pairing/final-v11-runtime-"));
const env = { ...process.env };
for (const key of Object.keys(env))
  if (key.startsWith("CLISBOT_") || key.startsWith("PASEO_")) delete env[key];
// Isolated homes must never select an operator's shared PostgreSQL database.
delete env.DATABASE_URL;
Object.assign(env, {
  CLISBOT_HOME: taskHome,
  CLISBOT_HUB_CHANNELS_ENABLED: "0",
  CLISBOT_USAGE_REPORTING: "0",
  CLISBOT_DICTATION_ENABLED: "false",
  CLISBOT_VOICE_MODE_ENABLED: "false",
  // This test drives the self-hosted web UI, which personal serving starts only when it is on.
  CLISBOT_WEB_UI_ENABLED: "true",
});
const cli = async (args, overrides = {}) => {
  const child = spawn(process.execPath, ["packages/cli/dist/index.js", ...args], {
    env: { ...env, ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`CLI failed: ${stderr}`);
  return stdout;
};
const factory = (url, options) =>
  new WebSocket(url, options?.protocols, { headers: options?.headers });
let daemon;
let hub;
let operator;
let managed;
console.log("Isolated home:", taskHome);
try {
  const testServeFallback = process.env.RUN_SERVE_TAILSCALE_FALLBACK === "1";
  if (testServeFallback) {
    const fakeTailscale = resolvePath(taskHome, "tailscale-fixture.mjs");
    await writeFile(
      fakeTailscale,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'status') console.log(JSON.stringify({BackendState:'Running',Self:{DNSName:'fixture.tail123.ts.net'}}));
else if (args[1] === 'status') console.log('{}');
else { console.error('Fixture Serve permission denied'); process.exit(1); }
`,
    );
    await chmod(fakeTailscale, 0o700);
    env.CLISBOT_TAILSCALE_BIN = fakeTailscale;
  }
  const onboarded = JSON.parse(
    await cli([
      "onboard",
      "--transport",
      "local",
      "--voice",
      "disable",
      "--home",
      taskHome,
      "--json",
    ]),
  );
  assert(parseDevicePairingOfferFromUrl(onboarded.url)?.pairing);
  // Managed daemon launches discard deployment environment overrides. Persist the
  // web UI choice so Start Hub's CLI child uses the same gateway as onboarding.
  await cli(["daemon", "config", "set", "features.webUi.enabled", "true", "--home", taskHome]);
  assert.equal(parseDevicePairingOfferFromUrl(onboarded.url).hub, undefined);
  await assert.rejects(readFile(resolvePath(taskHome, "hub-local.json")));
  const daemonOnlyInstance = await readDaemonInstance(taskHome);
  const daemonOnlyOffer = parseDevicePairingOfferFromUrl(onboarded.url);
  const key = createDeviceKey(randomBytes(32));
  const daemonAccess = {
    backendId: daemonOnlyOffer.serverId,
    key,
    invitationToken: daemonOnlyOffer.pairing.token,
  };
  daemon = new DaemonClient({
    url: `${onboarded.origin.replace(/^http/, "ws")}/ws`,
    clientId: "serve-live-phone",
    deviceAccess: daemonAccess,
    e2ee: {
      enabled: true,
      daemonPublicKeyB64: daemonOnlyOffer.daemonPublicKeyB64,
    },
    webSocketFactory: factory,
    reconnect: { enabled: false },
  });
  await daemon.connect();
  const daemonWorkerPid = (await daemon.getDaemonStatus()).pid;
  assert.equal(daemon.getLastServerInfoMessage().features.localHubStart, true);
  const gatewayBeforeStart = JSON.parse(
    await readFile(resolvePath(taskHome, "gateway-local.json"), "utf8"),
  );
  const startedHub = await daemon.startLocalHub({
    transport: testServeFallback ? "tailscale" : "local",
    label: "My phone",
  });
  if (testServeFallback) {
    assert.equal(startedHub.transport, "relay");
    assert.equal(startedHub.tailscaleState, "unavailable");
    assert.match(startedHub.networkGuidance, /using encrypted relay/);
    assert.deepEqual(
      JSON.parse(await readFile(resolvePath(taskHome, "gateway-local.json"), "utf8")).config
        .origins,
      [],
    );
    console.log(
      "Tailscale ready but Serve refused: relay fallback completed without daemon/gateway restart or false advertised origin.",
    );
  }
  const initialHubState = JSON.parse(
    await readFile(resolvePath(taskHome, "hub-local.json"), "utf8"),
  );
  const result = {
    ...onboarded,
    url: startedHub.url,
    origin: startedHub.origin,
    hub: initialHubState.url,
  };
  assert.equal(result.origin, onboarded.gateway);
  assert.equal((await readDaemonInstance(taskHome)).pid, daemonOnlyInstance.pid);
  assert.equal(
    JSON.parse(await readFile(resolvePath(taskHome, "gateway-local.json"), "utf8")).pid,
    gatewayBeforeStart.pid,
  );
  const offer = parseDevicePairingOfferFromUrl(result.url);
  assert(offer?.hub?.pairing);
  console.log(
    "Paired daemon first; Start Hub RPC kept gateway socket and daemon PID, returning an independently approved Hub grant.",
  );
  const devices = await daemon.devices();
  assert.equal(devices.devices.length, 1);
  assert.equal(devices.devices[0].sessions.filter((value) => value.connected).length, 1);
  console.log("Daemon paired via gateway; own credential and active session verified.");
  hub = new HubDeviceTransport({
    url: `${result.origin.replace(/^http/, "ws")}/api/auth/clisbot/device/socket`,
    publicKey: offer.hub.publicKey,
    webSocketFactory: factory,
  });
  const hubKey = createDeviceKey(randomBytes(32));
  const grant = offer.hub.pairing;
  const pairProof = signDeviceProof({
    key: hubKey,
    proof: {
      backendId: offer.hub.hubId,
      credentialId: "pair",
      timestamp: Date.now(),
      nonce: randomBytes(24).toString("base64url"),
    },
    context: { purpose: "pair", binding: digest(grant.token) },
  });
  const redeemed = await hub.request({
    method: "POST",
    path: "/api/auth/clisbot/device/redeem",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: grant.token,
      publicKey: hubKey.publicKey,
      proof: pairProof,
    }),
  });
  assert.equal(redeemed.status, 200);
  const credential = await redeemed.json();
  assert.notEqual(credential.credentialId, devices.devices[0].id);
  const requestHub = async (path, method = "GET", value, cookie) => {
    const body = value === undefined ? "" : JSON.stringify(value);
    const proof = signDeviceProof({
      key: hubKey,
      proof: {
        backendId: offer.hub.hubId,
        credentialId: credential.credentialId,
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context: {
        purpose: "http",
        binding: httpBinding({ method, path, body }),
      },
    });
    return hub.request({
      method,
      path,
      headers: {
        "x-clisbot-device-proof": JSON.stringify(proof),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body } : {}),
    });
  };
  const capabilitiesResponse = await requestHub("/api/auth/clisbot/device/capabilities");
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.accountAuthentication, "personal");
  assert.equal(capabilities.capabilities.manageResources, true);
  const account = await requestHub("/api/auth/clisbot/state");
  assert.equal(account.status, 200);
  assert.equal((await account.json()).status, "active");
  const listed = await requestHub("/api/auth/clisbot/device/devices");
  assert.equal(listed.status, 200);
  console.log(
    "Hub paired via gateway; personal management authority and account-independent UI state verified.",
  );
  const daemonStateBefore = await readDaemonInstance(taskHome);
  const orgPath = `/api/management/v1/organizations/${capabilities.organization.id}`;
  const inventory = await requestHub(`${orgPath}/daemons`);
  assert.equal(inventory.status, 200);
  const hosts = (await inventory.json()).daemons;
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].connectionOffer.v, 5);
  if (testServeFallback) assert(hosts[0].connectionOffer.relay);
  else assert.equal(hosts[0].connectionOffer.relay, undefined);
  assert.equal(hosts[0].connectionOffer.direct.endpoint, offer.direct.endpoint);
  const reopened = JSON.parse(
    await cli([
      "onboard",
      "--transport",
      "local",
      "--voice",
      "disable",
      "--home",
      taskHome,
      "--json",
    ]),
  );
  assert.equal(reopened.hub, undefined);
  assert.equal(
    JSON.parse(await readFile(resolvePath(taskHome, "gateway-local.json"), "utf8")).pid,
    gatewayBeforeStart.pid,
  );
  assert.equal((await fetch(`${result.origin}/api/auth/clisbot/device/identity`)).status, 200);
  assert.equal((await daemon.getDaemonStatus()).pid, daemonWorkerPid);
  assert.equal((await readDaemonInstance(taskHome)).pid, daemonOnlyInstance.pid);
  console.log(
    "Reopening daemon-only onboarding reuses the Host and retains its already-enabled Hub route.",
  );
  const hubState = JSON.parse(await readFile(`${taskHome}/hub-local.json`));
  const gatewayState = JSON.parse(await readFile(`${taskHome}/gateway-local.json`));
  assert.equal(gatewayState.config.hubOrigin, result.hub);
  const worker = async (pid) => {
    assert(Number.isSafeInteger(pid) && pid > 0);
    const { stdout } =
      process.platform === "win32"
        ? await promisify(execFile)(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`,
            ],
            { windowsHide: true },
          )
        : await promisify(execFile)("pgrep", ["-P", String(pid)]);
    const values =
      process.platform === "win32"
        ? JSON.parse(stdout.trim() || "null")
        : stdout.trim().split("\n").map(Number);
    const children = Array.isArray(values) ? values : [values];
    assert.equal(children.length, 1, "Fixture supervisor must own exactly one worker");
    assert(Number.isSafeInteger(children[0]) && children[0] > 0 && children[0] !== pid);
    return children[0];
  };
  const wait = async (check, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        if (await check()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const gatewayWorker = await worker(gatewayState.pid);
  process.kill(gatewayWorker, "SIGKILL");
  await wait(
    async () =>
      (await worker(gatewayState.pid)) !== gatewayWorker &&
      (await fetch(`${result.origin}/api/gateway/health`)).ok,
    "gateway restart",
  );
  const hubWorker = await worker(hubState.pid);
  process.kill(hubWorker, "SIGKILL");
  await wait(
    async () =>
      (await worker(hubState.pid)) !== hubWorker &&
      (await fetch(`${result.hub}/api/auth/clisbot/device/identity`)).ok,
    "Hub restart",
  );
  const after = await readDaemonInstance(taskHome);
  assert.equal(after.pid, daemonStateBefore.pid);
  assert.equal(after.startedAt, daemonStateBefore.startedAt);
  assert.equal(after.serverId, daemonStateBefore.serverId);
  assert.equal(
    (await (await requestHub("/api/auth/clisbot/device/capabilities")).json()).hubId,
    offer.hub.hubId,
  );
  console.log(
    "Hub and gateway recovered from independent crashes; daemon PID/start time and Hub identity preserved.",
  );
  const repeated = JSON.parse(
    await cli(["hub", "start", "--personal", "--transport", "local", "--home", taskHome, "--json"]),
  );
  assert.equal(repeated.gateway, result.gateway);
  assert.equal(repeated.hub, result.hub);
  if (process.env.RUN_SERVE_BROWSER === "1") {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const failures = [];
      page.on("pageerror", (error) => {
        failures.push(error.message);
        console.log("Page error:", error.message.replace(/#offer=[^\s]+/g, "#offer=[private]"));
      });
      // Pairing links open the official app; this test loads the self-hosted copy instead.
      await page.goto(`${repeated.origin}/${new URL(repeated.url).hash}`);
      await page
        .getByText("Personal Hub access; no account login required", {
          exact: true,
        })
        .waitFor({ timeout: 30000 });
      assert.equal(new URL(page.url()).pathname, "/settings/hub/overview");
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          console.log(
            "Browser console:",
            message
              .text()
              .slice(0, 1500)
              .replace(/#offer=[^\s]+/g, "#offer=[private]"),
          );
      });
      await page
        .getByText("Personal Hub access; no account login required", {
          exact: true,
        })
        .waitFor({ timeout: 30000 });
      assert.equal((await page.getByText("Personal Hub", { exact: true }).count()) > 0, true);
      await page
        .getByTestId("settings-host-picker")
        .getByRole("img", { name: "Online", exact: true })
        .waitFor({ timeout: 30000 });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-personal-web-pre-reload.png",
        fullPage: true,
      });
      await page.reload();
      await page
        .getByText("Personal Hub access; no account login required", {
          exact: true,
        })
        .waitFor({ timeout: 30000 });
      await page
        .getByTestId("settings-host-picker")
        .getByRole("img", { name: "Online", exact: true })
        .waitFor({ timeout: 30000 });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-personal-web.png",
        fullPage: true,
      });
      const titleHubPicker = page.getByTestId("hub-title-picker").and(page.locator(":visible"));
      const sidebarHubPicker = page.getByTestId("hub-sidebar-picker").and(page.locator(":visible"));
      const waitSavedHubReady = async () => {
        const savedHub = page
          .getByRole("button", { name: "Open Hub", exact: true })
          .locator("../..");
        await savedHub.getByText("Connected", { exact: true }).waitFor({ timeout: 30000 });
        await savedHub
          .getByText("No account sign-in required", { exact: true })
          .waitFor({ timeout: 30000 });
        if (page.viewportSize().width >= 1000) {
          await page
            .getByTestId("settings-host-picker")
            .waitFor({ state: "visible", timeout: 30000 });
          await page
            .getByTestId("settings-host-picker")
            .getByRole("img", { name: "Online", exact: true })
            .waitFor({ timeout: 30000 });
        }
      };
      const assertHubPickersLocked = async () => {
        await page
          .getByRole("button", {
            name: "Save or cancel before switching Hub",
            exact: true,
          })
          .first()
          .waitFor({ state: "visible" });
        assert.equal(await titleHubPicker.isDisabled(), true);
        assert.equal(await sidebarHubPicker.isDisabled(), true);
      };
      await titleHubPicker.waitFor({ state: "visible" });
      await sidebarHubPicker.waitFor({ state: "visible" });
      const pageTitle = page.getByTestId("settings-detail-header-title");
      const headerBounds = await pageTitle.locator("..").boundingBox();
      const pickerBounds = await titleHubPicker.boundingBox();
      assert(headerBounds && pickerBounds);
      assert(
        Math.abs(pickerBounds.x + pickerBounds.width - headerBounds.x - headerBounds.width) <= 8,
        "Desktop Hub switcher aligns to the title row's right edge",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      await pageTitle.waitFor({ state: "hidden" });
      const narrowTitle = page.getByText("Overview", { exact: true }).last();
      await narrowTitle.waitFor({ state: "visible" });
      assert.equal(
        await narrowTitle.evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
        "Overview title fits without truncation on a narrow viewport",
      );
      await page
        .getByText("Personal Hub access; no account login required", {
          exact: true,
        })
        .waitFor({ timeout: 30000 });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-overview-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await sidebarHubPicker.waitFor({ state: "visible" });
      const selectedHubLabel = (await titleHubPicker.innerText()).split("\n")[0].trim();
      await titleHubPicker.click();
      const hubSearch = page.getByPlaceholder("Search Hubs…", { exact: true });
      await hubSearch.waitFor({ state: "visible" });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-hub-dropdown.png",
        fullPage: true,
      });
      await hubSearch.fill("__no_matching_hub_fixture__");
      await page
        .getByRole("button", { name: selectedHubLabel, exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        await page.getByRole("button", { name: selectedHubLabel, exact: true }).count(),
        0,
      );
      await hubSearch.fill(selectedHubLabel);
      await page.getByRole("button", { name: selectedHubLabel, exact: true }).click();
      await hubSearch.waitFor({ state: "hidden" });
      await page.getByTestId("settings-host-picker").click();
      const hostSearch = page.getByPlaceholder("Search hosts", { exact: true });
      await hostSearch.waitFor({ state: "visible" });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-host-dropdown.png",
        fullPage: true,
      });
      await hostSearch.fill("__no_matching_host_fixture__");
      await page
        .getByTestId(`settings-host-picker-item-${offer.serverId}`)
        .waitFor({ state: "hidden" });
      assert.equal(
        await page.getByTestId(`settings-host-picker-item-${offer.serverId}`).count(),
        0,
      );
      await hostSearch.fill("");
      await page
        .getByTestId(`settings-host-picker-item-${offer.serverId}`)
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await hostSearch.waitFor({ state: "hidden" });
      const help = page.getByRole("button", {
        name: "What is a Hub?",
        exact: true,
      });
      assert.equal(await help.getAttribute("aria-expanded"), "true");
      await help.click();
      await page.reload();
      await help.and(page.locator('[aria-expanded="false"]')).waitFor({ state: "visible" });
      assert.equal(await help.getAttribute("aria-expanded"), "false");
      await help.click();
      await page.goto(new URL("/settings/hub/hubs", page.url()).href);
      await page.getByRole("button", { name: "What is a Hub?", exact: true }).waitFor();
      await waitSavedHubReady();
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-hubs-list.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await waitSavedHubReady();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        true,
      );
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-hubs-list-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(new URL("/settings/appearance", page.url()).href);
      await page.getByLabel(/^Theme:/).click();
      await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
      await page.getByLabel("Theme: Dark", { exact: true }).waitFor();
      await page.goto(new URL("/settings/hub/hubs", page.url()).href);
      await page.getByRole("button", { name: "What is a Hub?", exact: true }).waitFor();
      await waitSavedHubReady();
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-hubs-dark.png",
        fullPage: true,
      });
      await page.goto(new URL("/settings/appearance", page.url()).href);
      await page.getByLabel("Theme: Dark", { exact: true }).click();
      await page.getByRole("menuitem", { name: "Light", exact: true }).click();
      await page.getByLabel("Theme: Light", { exact: true }).waitFor();
      await page.goto(new URL("/settings/hub/overview", page.url()).href);
      await page
        .getByText("Personal Hub access; no account login required", {
          exact: true,
        })
        .waitFor({ timeout: 30000 });
      await page
        .getByTestId("settings-host-picker")
        .getByRole("img", { name: "Online", exact: true })
        .waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Edit connection", exact: true }).click();
      await assertHubPickersLocked();
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-hub-edit.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Switch Hub", exact: true })
        .first()
        .waitFor({ state: "visible" });
      await page.getByRole("button", { name: "View paired devices", exact: true }).click();
      await page.getByRole("button", { name: "Rename", exact: true }).first().click();
      await assertHubPickersLocked();
      await page.getByLabel("Device label", { exact: true }).fill("Renamed test device");
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-device-edit.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Save label", exact: true }).click();
      await page.getByLabel("Device label", { exact: true }).waitFor({ state: "hidden" });
      await page.getByText("Renamed test device", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Revoke device", exact: true }).first().click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual(failures, []);
      console.log(
        "Built web app paired both backends and restored personal Hub after reload in Chromium.",
      );
      await page.getByRole("button", { name: "Back to Overview", exact: true }).click();
      await page.getByRole("button", { name: "Account sign-in settings", exact: true }).click();
      await page.getByLabel("Owner email", { exact: true }).waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).pathname, "/settings/hub/instance");
      await page.getByLabel("Owner email", { exact: true }).fill("invalid-owner-email");
      await page.getByLabel("Owner password", { exact: true }).fill("explicit-owner-password");
      await page.getByRole("button", { name: "Require account login", exact: true }).click();
      await page.getByText(/Owner login configuration failed/).waitFor();
      await assertHubPickersLocked();
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-policy-failed-save.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Switch Hub", exact: true })
        .first()
        .waitFor({ state: "visible" });
      assert.equal(await titleHubPicker.isDisabled(), false);
      assert.equal(await sidebarHubPicker.isDisabled(), false);
      await page.getByLabel("Owner email", { exact: true }).fill("owner@example.test");
      await page.getByLabel("Owner password", { exact: true }).fill("explicit-owner-password");
      const lockedHubPickers = await page
        .getByRole("button", {
          name: "Save or cancel before switching Hub",
          exact: true,
        })
        .and(page.locator(":visible"))
        .all();
      assert(
        lockedHubPickers.length >= 2,
        "Both title and sidebar Hub selectors are locked while editing",
      );
      for (const picker of lockedHubPickers) assert.equal(await picker.isDisabled(), true);
      await page.getByRole("button", { name: "Require account login", exact: true }).click();
      // Account sign-in uses the existing Account navigation, regardless of
      // whether Instance settings already presents its required sign-in form.
      await page.getByRole("button", { name: "Account", exact: true }).waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 30000 });
      const denied = await requestHub(`${orgPath}/daemons`);
      assert.equal(denied.status, 401);
      console.log(
        "Web operator enabled mandatory account login; paired-only management denied at production API route.",
      );
      await page.getByPlaceholder("you@example.com").fill("owner@example.test");
      await page.locator("input[type=password]").fill("explicit-owner-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByText("owner@example.test", { exact: true })
        .first()
        .waitFor({ timeout: 30000 });
      await page.reload();
      await page
        .getByText("owner@example.test", { exact: true })
        .first()
        .waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Sessions", exact: true }).click();
      await page.getByText(/sign-in sessions for your account on this Hub/).waitFor();
      await page.getByText(/· This device/).waitFor({ timeout: 30000 });
      await page
        .getByTestId("settings-host-picker")
        .getByRole("img", { name: "Online", exact: true })
        .waitFor({ timeout: 30000 });
      await page.screenshot({
        path: ".debug/scratch/device-pairing/final-v11-runtime-account-sessions.png",
        fullPage: true,
      });
      const emptyContext = await browser.newContext();
      try {
        const emptyPage = await emptyContext.newPage();
        await emptyPage.goto(new URL("/settings/hub/hubs", repeated.origin).href);
        await emptyPage.getByRole("button", { name: "What is a Hub?", exact: true }).waitFor();
        await emptyPage.screenshot({
          path: ".debug/scratch/device-pairing/final-v11-empty-hubs.png",
          fullPage: true,
        });
        await emptyPage.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await emptyPage.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          true,
        );
        await emptyPage.screenshot({
          path: ".debug/scratch/device-pairing/final-v11-empty-hubs-mobile.png",
          fullPage: true,
        });
      } finally {
        await emptyContext.close();
      }
      console.log(
        "Paired web device signed in and restored its account session after reload; Account reuses Profile/Sessions tabs.",
      );
      await cli(["hub", "login-policy", "off", "--home", taskHome]);
    } catch (error) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page
          .screenshot({
            path: ".debug/scratch/device-pairing/final-v11-web-failure.png",
            fullPage: true,
          })
          .catch(() => {});
        console.log(
          "Browser state:",
          new URL(page.url()).pathname,
          (await page.locator("body").innerText())
            .slice(0, 2200)
            .replace(/#offer=[^\s]+/g, "#offer=[private]"),
        );
      }
      throw error;
    } finally {
      await browser.close();
    }
  }

  const published = JSON.parse(
    await cli([
      "hub",
      "start",
      "--personal",
      "--transport",
      "https",
      "--public-url",
      "https://personal.example.test",
      "--home",
      taskHome,
      "--json",
    ]),
  );
  assert.equal(published.gateway, result.gateway);
  const publicOffer = parseDevicePairingOfferFromUrl(published.url);
  assert.equal(new URL(published.url).origin, "https://app.clisbot.com");
  assert.deepEqual(publicOffer.direct, { endpoint: "personal.example.test:443", useTls: true });
  assert.equal(publicOffer.hub.hubId, offer.hub.hubId);
  const forwarded = new DaemonClient({
    url: `${published.gateway.replace(/^http/, "ws")}/ws`,
    clientId: "public-origin",
    deviceAccess: {
      backendId: offer.serverId,
      key,
      credentialId: devices.devices[0].id,
    },
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, {
        headers: {
          ...options?.headers,
          host: "personal.example.test",
          origin: "https://personal.example.test",
        },
      }),
    reconnect: { enabled: false },
  });
  try {
    await forwarded.connect();
    assert.equal(forwarded.getLastServerInfoMessage().serverId, offer.serverId);
  } finally {
    await forwarded.close();
  }
  assert.equal((await readDaemonInstance(taskHome)).pid, after.pid);
  console.log(
    "Public HTTPS forwarding policy accepts its Host/Origin after reconfiguration; Hub/gateway ports and daemon PID preserved.",
  );
  if (process.env.RUN_SERVE_RELAY === "1") {
    const relayed = JSON.parse(
      await cli([
        "hub",
        "start",
        "--personal",
        "--transport",
        "relay",
        "--home",
        taskHome,
        "--json",
      ]),
    );
    const relayOffer = parseDevicePairingOfferFromUrl(relayed.url);
    assert(relayOffer.hub.relay);
    assert.equal(relayOffer.hub.hubId, offer.hub.hubId);
    assert.equal((await readDaemonInstance(taskHome)).pid, after.pid);
    hub.close();
    hub = new HubDeviceTransport({
      url: buildRelayWebSocketUrl({
        ...relayOffer.hub.relay,
        useTls: relayOffer.hub.relay.useTls ?? true,
        serverId: `hub-${offer.hub.hubId}`,
        role: "client",
      }),
      relay: true,
      publicKey: offer.hub.publicKey,
      webSocketFactory: factory,
    });
    const response = await requestHub("/api/auth/clisbot/device/capabilities");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).hubId, offer.hub.hubId);
    console.log(
      "Existing Hub credential worked via its own production relay ingress; daemon PID preserved on local→relay.",
    );
    if (process.env.RUN_SERVE_BROWSER_RELAY === "1") {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        await page.route("https://app.clisbot.com/**", async (route) => {
          const source = new URL(route.request().url());
          const assetResponse = await fetch(`${relayed.gateway}${source.pathname}${source.search}`);
          await route.fulfill({
            status: assetResponse.status,
            headers: {
              "content-type":
                assetResponse.headers.get("content-type") ?? "application/octet-stream",
            },
            body: Buffer.from(await assetResponse.arrayBuffer()),
          });
        });
        const { direct: _direct, ...relayOnly } = relayOffer;
        const { origin: _origin, ...relayHub } = relayOnly.hub;
        relayOnly.hub = relayHub;
        const url = `https://app.clisbot.com/#offer=${Buffer.from(JSON.stringify(relayOnly)).toString("base64url")}`;
        await page.goto(url);
        await page
          .getByText("Personal Hub access; no account login required", {
            exact: true,
          })
          .waitFor({ timeout: 45000 });
        await page.reload();
        await page
          .getByText("Personal Hub access; no account login required", {
            exact: true,
          })
          .waitFor({ timeout: 45000 });
        assert.deepEqual(failures, []);
        console.log(
          "Built web app at official HTTPS origin paired daemon and Hub over production relay and restored after reload.",
        );
      } finally {
        await browser.close();
      }
    }
  }
  assert.equal((await readDaemonInstance(taskHome)).pid, after.pid);
  const operatorToken = (await readFile(`${taskHome}/local-credential`, "utf8")).trim();
  operator = new DaemonClient({
    url: `${result.daemon.replace(/^http/, "ws")}/ws`,
    clientId: "serve-live-operator",
    localCredential: () => operatorToken,
    webSocketFactory: factory,
    reconnect: { enabled: false },
  });
  await operator.connect();
  const ticketPath = `${orgPath}/daemons/${hosts[0].id}/access-tickets`;
  const ticket = async () => {
    const response = await requestHub(ticketPath, "POST", {
      clientId: "managed-phone",
    });
    assert.equal(response.status, 201);
    return (await response.json()).accessTicket;
  };
  let permanentManagedRevocations = 0;
  const createManaged = (accessTicket) =>
    new DaemonClient({
      url: `${result.origin.replace(/^http/, "ws")}/ws`,
      clientId: "managed-phone",
      resolveAccessTicket: () => accessTicket,
      e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      webSocketFactory: factory,
      reconnect: { enabled: false },
      onAccessRevoked: () => {
        permanentManagedRevocations += 1;
      },
    });
  managed = createManaged(await ticket());
  await assert.rejects(managed.connect());
  await managed.close();
  console.log("Hub owner ticket cannot authorize a daemon in off mode.");
  await operator.patchDaemonConfig({ managedAccess: { mode: "external" } });
  managed = createManaged(await ticket());
  await managed.connect();
  assert(managed.getLastServerInfoMessage().permissions.includes("access.manage"));
  console.log("External mode admits Hub-authorized owner without a daemon pairing credential.");
  const revocationsBeforePolicyChange = permanentManagedRevocations;
  await operator.patchDaemonConfig({ managedAccess: { mode: "off" } });
  await wait(
    () => managed.getConnectionState().status !== "connected",
    "ticket session rebind when switched off",
  );
  await managed.close();
  assert.equal(
    permanentManagedRevocations,
    revocationsBeforePolicyChange,
    "Policy rebind must preserve the saved Host instead of reporting permanent revocation",
  );
  managed = createManaged(await ticket());
  await assert.rejects(managed.connect());
  await managed.close();
  await daemon.close();
  daemon = new DaemonClient({
    url: `${result.origin.replace(/^http/, "ws")}/ws`,
    clientId: "serve-live-phone",
    deviceAccess: {
      backendId: offer.serverId,
      key,
      credentialId: devices.devices[0].id,
    },
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    webSocketFactory: factory,
    reconnect: { enabled: false },
  });
  await daemon.connect();
  assert(daemon.getLastServerInfoMessage().permissions.includes("access.manage"));
  await operator.patchDaemonConfig({ managedAccess: { mode: "external" } });
  managed = createManaged(await ticket());
  await managed.connect();
  console.log(
    "External→off closes ticket sessions and restores own daemon credential; external can be enabled again.",
  );
  const revocationsBeforeDeviceRevoke = permanentManagedRevocations;
  await cli(["hub", "devices", "revoke", credential.credentialId, "--home", taskHome]);
  await wait(() => managed.getConnectionState().status !== "connected", "managed lease revoke");
  assert.equal(
    permanentManagedRevocations,
    revocationsBeforeDeviceRevoke + 1,
    "Real device revocation must report permanent access revocation",
  );
  assert.equal((await readDaemonInstance(taskHome)).pid, after.pid);
  console.log("Hub device revocation closed managed daemon access without restarting daemon.");
  const localAgain = JSON.parse(
    await cli(["hub", "start", "--personal", "--transport", "local", "--home", taskHome, "--json"]),
  );
  const localOffer = parseDevicePairingOfferFromUrl(localAgain.url);
  assert.equal(localAgain.relayEnabled, true);
  assert(localOffer.relay);
  assert.equal(localOffer.hub.relay, undefined);
  assert.equal(localOffer.hub.hubId, offer.hub.hubId);
  assert.equal((await operator.getDaemonConfig()).config.relay.enabled, true);
  assert.equal((await readDaemonInstance(taskHome)).pid, after.pid);
  console.log(
    "Choosing local keeps existing daemon relay connections; Hub relay is reconfigured independently, retaining identity and daemon PID.",
  );
  await verifyRequiredLoginBootstrap();
  completed = true;
} finally {
  hub?.close();
  await managed?.close();
  await operator?.close();
  await daemon?.close();
  for (const args of [
    ["hub", "stop", "--web"],
    ["hub", "stop"],
    ["daemon", "stop"],
  ])
    await cli([...args, "--home", taskHome]).catch((error) =>
      console.error("Cleanup:", error.message),
    );
  console.log("Owned services stopped.");
  if (completed) await rm(taskHome, { recursive: true, force: true });
}

async function verifyRequiredLoginBootstrap() {
  const requiredHome = await mkdtemp(resolvePath(".debug/scratch/device-pairing/login-runtime-"));
  let transport;
  let cookiesReceived = "";
  let verified = false;
  try {
    const served = JSON.parse(
      await cli(
        ["hub", "start", "--personal", "--transport", "local", "--home", requiredHome, "--json"],
        {
          CLISBOT_HUB_LOGIN_REQUIRED: "true",
        },
      ),
    );
    assert.equal(served.enrollment, "account-approval-required");
    const offer = parseDevicePairingOfferFromUrl(served.url);
    const key = createDeviceKey(randomBytes(32));
    const proof = (credentialId, context) =>
      signDeviceProof({
        key,
        proof: {
          backendId: offer.hub.hubId,
          credentialId,
          timestamp: Date.now(),
          nonce: randomBytes(24).toString("base64url"),
        },
        context,
      });
    transport = new HubDeviceTransport({
      url: `${served.origin.replace(/^http/, "ws")}/api/auth/clisbot/device/socket`,
      publicKey: offer.hub.publicKey,
      webSocketFactory: factory,
      cookies: async (values) => {
        cookiesReceived = values.map((value) => value.split(";")[0]).join("; ");
      },
    });
    const paired = await transport.request({
      method: "POST",
      path: "/api/auth/clisbot/device/redeem",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: offer.hub.pairing.token,
        publicKey: key.publicKey,
        proof: proof("pair", {
          purpose: "pair",
          binding: digest(offer.hub.pairing.token),
        }),
      }),
    });
    assert.equal(paired.status, 200);
    const device = await paired.json();
    assert.equal(device.loginRequired, true);
    const request = (path, method = "GET", value, cookie, ownerSetupToken) => {
      const body = value === undefined ? "" : JSON.stringify(value);
      return transport.request({
        path,
        method,
        headers: {
          "x-clisbot-device-proof": JSON.stringify(
            proof(device.credentialId, {
              purpose: "http",
              binding: httpBinding({ method, path, body }),
            }),
          ),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...(ownerSetupToken ? { "x-clisbot-owner-setup": ownerSetupToken } : {}),
        },
        ...(body ? { body } : {}),
      });
    };
    assert.equal(
      (await (await request("/api/auth/clisbot/device/capabilities")).json()).capabilities,
      null,
    );
    assert.equal(
      (await (await request("/api/auth/clisbot/state")).json()).status,
      "instanceSetupRequired",
    );
    const claimBody = {
      email: "operator@example.test",
      password: "explicit-operator-password",
    };
    const deniedClaim = await request("/api/auth/clisbot/claim-instance", "POST", claimBody);
    assert.equal(deniedClaim.status, 403);
    const claim = await request(
      "/api/auth/clisbot/claim-instance",
      "POST",
      claimBody,
      undefined,
      offer.hub.ownerSetupToken,
    );
    assert.equal(claim.status, 200);
    assert(cookiesReceived);
    const state = await (
      await request("/api/auth/clisbot/state", "GET", undefined, cookiesReceived)
    ).json();
    assert.notEqual(state.status, "instanceSetupRequired");
    assert.notEqual(state.status, "signedOut");
    console.log(
      "Fresh env-configured mandatory-login Hub pairs for account setup, admits explicit owner login, and defers Host enrollment for account approval.",
    );
    verified = true;
  } finally {
    transport?.close();
    for (const args of [
      ["hub", "stop", "--web"],
      ["hub", "stop"],
      ["daemon", "stop"],
    ])
      await cli([...args, "--home", requiredHome]).catch((error) =>
        console.error("Login fixture cleanup:", error.message),
      );
    if (verified) await rm(requiredHome, { recursive: true, force: true });
  }
}
