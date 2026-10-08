import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Run the installed SSR bundle against an isolated, empty database. A healthy
// HTTP server alone does not prove that its lazy channel runtime can load.
const packageRoot = process.argv[2] ?? "/usr/local/lib/node_modules/@clisbot/hub";
const channelsEnabled = !process.argv.includes("--channels-disabled");
const root = await mkdtemp(join(tmpdir(), "clisbot-hub-smoke-"));
const origin = "http://localhost:6870";
const executablePath = process.env.PATH;
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, {
  PATH: executablePath,
  HOME: root,
  CLISBOT_HOME: root,
  CLISBOT_HUB_DATA_DIR: join(root, "hub"),
  CLISBOT_HUB_APP_URL: origin,
  CLISBOT_HUB_CHANNELS_ENABLED: channelsEnabled ? "1" : "0",
  CLISBOT_HUB_CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
});

// The image builds for a second architecture under QEMU, where loading every channel takes
// 60-90 s against ~7 s natively; 90 s timed out on an otherwise passing build.
const timeout = setTimeout(() => {
  console.error("Packaged Hub runtime smoke timed out");
  process.exit(1);
}, 240_000);
let build;
try {
  const { configureRuntimeRoot } = await import(
    pathToFileURL(join(packageRoot, "dist/runtime-files.js")).href
  );
  configureRuntimeRoot(packageRoot);
  build = await import(pathToFileURL(join(packageRoot, ".output/server/start-server.js")).href);
  const runtime = await build.startProductionRuntime();
  const claim = await runtime.auth(
    new Request(`${origin}/api/auth/clisbot/claim-instance`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        email: "packaging-smoke@example.test",
        password: randomBytes(24).toString("base64url"),
      }),
    }),
  );
  assert.equal(claim.status, 200, "Could not claim disposable Hub");
  const cookie = claim.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Claim must establish a browser session");
  const stateResponse = await runtime.auth(
    new Request(`${origin}/api/auth/clisbot/state`, { headers: { cookie } }),
  );
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  const organization = state.organization ?? state.memberships?.[0];
  assert.ok(organization?.id, "Claim must create an organization");
  const response = await runtime.managementApi.handle(
    new Request(
      `${origin}/api/management/v1/organizations/${organization.id}/channel-accounts/status`,
      { headers: { cookie } },
    ),
  );
  if (channelsEnabled) {
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.runtimeAvailable, true, "Packaged channel runtime availability");
    assert.deepEqual(status.accounts, []);
    const loadModule = (file) => import(pathToFileURL(join(packageRoot, "dist", file)).href);
    const { loadChannelPins } = await loadModule("channels/install/pins.js");
    const { ensureChannelInstalled } = await loadModule("channels/install/install-channel.js");
    const { loadChannelVertical } = await loadModule("channels/loader/load-channel.js");
    const { createHostRuntime, recordingInboundHandler } =
      await loadModule("channels/loader/host.js");
    const pins = loadChannelPins(join(packageRoot, "channel-pins.json"));
    for (const [channel, pin] of Object.entries(pins.channels)) {
      if (pin.loadMode !== "in-repo") continue;
      const accountId = `packaging-${channel}`;
      const install = await ensureChannelInstalled(pins, channel, accountId, root, {
        noticesPath: join(packageRoot, "THIRD_PARTY_NOTICES"),
      });
      const vertical = await loadChannelVertical({
        ...install,
        organizationId: organization.id,
        plugin: pin.plugin,
        hostRuntime: createHostRuntime({
          onInboundReply: recordingInboundHandler(() => undefined),
        }),
      });
      try {
        assert.equal(typeof vertical.plugin.gateway?.startAccount, "function", channel);
        assert.equal(typeof vertical.plugin.outbound?.sendText, "function", channel);
        console.log(`Packaged channel loaded: ${channel}`);
      } finally {
        vertical.dispose();
      }
    }
  } else {
    // The channel kill switch hides its management resources entirely.
    assert.equal(response.status, 404);
  }
  console.log(`Packaged Hub smoke passed (channels ${channelsEnabled ? "enabled" : "disabled"})`);
} finally {
  try {
    await build?.stopProductionRuntime();
  } finally {
    clearTimeout(timeout);
    await rm(root, { recursive: true, force: true });
  }
}
