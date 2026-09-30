import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const image = process.argv[2] ?? "clisbot:local";
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
const results = [];

async function waitForHealth(name) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = JSON.parse(docker("inspect", "--format", "{{json .State}}", name));
    if (!state.Running) throw new Error(`${name} exited with status ${state.ExitCode}`);
    try {
      execFileSync("docker", ["exec", name, "node", "/usr/local/lib/clisbot-healthcheck.mjs"], {
        stdio: "pipe",
        timeout: 6_000,
      });
      return;
    } catch {
      await delay(1_000);
    }
  }
  throw new Error(`${name} did not become healthy`);
}

async function assertPort(name, port, active) {
  const origin = `http://${docker("port", name, `${port}/tcp`)}`;
  const url = `${origin}${port === 6868 ? "/api/health" : "/health"}`;
  if (active) {
    // Docker Desktop's host port forward can lag behind container readiness.
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
        assert.equal(response.status, 200, url);
        break;
      } catch (error) {
        if (attempt === 20) throw error;
        await delay(250);
      }
    }
    const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
    assert.equal(page.status, port === 6868 ? 200 : 404, `${origin} web UI ownership`);
    assert.match(
      page.headers.get("content-type") ?? "",
      port === 6868 ? /text\/html/ : /application\/json/,
    );
  } else {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2_000) }));
  }
}

function assertIntegratedHub(name) {
  // Execute inside the container so the default public origin is deterministic
  // while host-published ports stay ephemeral and isolated.
  docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    const origin = 'http://localhost:6868';
    const page = await fetch(origin);
    assert.match(await page.text(), /__CLISBOT_HUB_ENABLED__=true/);
    const headers = { 'content-type': 'application/json', origin };
    const claim = await fetch(origin + '/api/auth/clisbot/claim-instance', { method: 'POST', headers, body: JSON.stringify({ email: 'smoke@example.test', password: 'isolated-smoke-password' }) });
    assert.equal(claim.status, 200, await claim.text());
    const cookie = claim.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie, 'Hub session cookie must cross proxy');
    const account = await fetch(origin + '/api/auth/clisbot/state', { headers: { cookie } });
    assert.equal(account.status, 200);
    const state = await account.json();
    assert.ok(['active', 'appSetupRequired'].includes(state.status), JSON.stringify(state));
    assert.equal((await fetch(origin + '/api/status', { headers: { cookie } })).status, 401, 'Hub cookie must not bypass daemon auth');
    const status = await new Promise((resolve, reject) => {
      const request = http.get(origin + '/api/daemons/socket', { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
      request.on('response', response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(status, 401, 'Hub owns the WebSocket admission, not daemon /ws');
    const malformed = await new Promise((resolve, reject) => {
      const request = http.get(origin + '//', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
      request.on('response', response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(malformed, 400, 'malformed upgrade must not crash the daemon');
    assert.equal((await fetch(origin + '/api/health')).status, 200);
    const authorization = await fetch(origin + '/api/v1/cli-authorizations', { method: 'POST', headers, body: '{}' });
    assert.equal(authorization.status, 201);
    const login = await authorization.json();
    assert.equal(new URL(login.verificationUri).origin, origin, 'CLI login belongs to shared UI');
    assert.equal((await fetch(login.verificationUriComplete)).status, 200);
    async function startAuthorization(port, source, spoof) {
      return new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port, localAddress: source, path: '/api/v1/cli-authorizations', method: 'POST', headers: { 'content-type': 'application/json', 'x-clisbot-proxy-client-ip': spoof } }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject); request.end('{}');
      });
    }
    for (let i = 2; i < 8; i++) assert.equal(await startAuthorization(6868, '127.0.0.' + i, '192.0.2.1'), 201, 'distinct clients retain distinct quotas');
    for (const [port, source] of [[6868, '127.0.0.8'], [6870, '127.0.0.9']]) {
      const statuses = [];
      for (let i = 0; i < 6; i++) statuses.push(await startAuthorization(port, source, '192.0.2.' + (10 + i)));
      assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429], 'spoofed metadata cannot reset a client quota');
    }
  `,
  );
}

function assertDaemonSocket(name) {
  docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    async function connect(protocol) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket('ws://localhost:6868/ws', protocol ? [protocol] : []);
        const timeout = setTimeout(() => { socket.close(); reject(Error('daemon hello timed out')); }, 5000);
        socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', clientId: 'docker-smoke', clientType: 'cli', protocolVersion: 1 })));
        socket.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.message?.payload?.status === 'server_info') {
            clearTimeout(timeout); resolve('server_info'); socket.close();
          }
        });
        socket.addEventListener('close', event => { clearTimeout(timeout); resolve(event.code); });
        socket.addEventListener('error', () => { clearTimeout(timeout); reject(Error('daemon WebSocket failed')); });
      });
    }
    assert.equal(await connect(), 4401, 'daemon hello rejects missing credentials');
    assert.equal(await connect('clisbot.bearer.wrong-password'), 4401, 'daemon rejects wrong password');
    assert.equal(await connect('clisbot.bearer.isolated-container-test'), 'server_info', 'daemon admits its password');
  `,
  );
}

for (const mode of ["daemon", "hub", "all"]) {
  const name = `clisbot-mode-smoke-${mode}-${process.pid}`;
  try {
    docker(
      "run",
      "-d",
      "--name",
      name,
      "--stop-timeout",
      "40",
      "-e",
      `CLISBOT_RUN_MODE=${mode}`,
      "-e",
      "CLISBOT_PASSWORD=isolated-container-test",
      "-e",
      "CLISBOT_RELAY_ENABLED=false",
      "-e",
      "CLISBOT_DICTATION_ENABLED=false",
      "-e",
      "CLISBOT_VOICE_MODE_ENABLED=false",
      "-e",
      `CLISBOT_HUB_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("base64")}`,
      "-p",
      "127.0.0.1::6868",
      "-p",
      "127.0.0.1::6870",
      image,
    );
    await waitForHealth(name);
    await assertPort(name, 6868, mode !== "hub");
    await assertPort(name, 6870, mode !== "daemon");
    if (mode !== "hub") assertDaemonSocket(name);
    if (mode === "all") assertIntegratedHub(name);
    docker("restart", "--time", "40", name);
    await waitForHealth(name);
    if (mode === "all") {
      docker(
        "exec",
        name,
        "node",
        "-e",
        `
        const fs = require('fs');
        const entry = fs.readFileSync('/etc/clisbot-hub-entry', 'utf8').trim();
        const pid = fs.readdirSync('/proc').filter(x => /^\\d+$/.test(x)).find(x => {
          try { return fs.readFileSync('/proc/'+x+'/cmdline', 'utf8').split('\\0')[1] === entry; } catch { return false; }
        });
        if (!pid) throw Error('Hub process missing');
        process.kill(Number(pid), 'SIGKILL');
      `,
      );
      assert.notEqual(docker("wait", name), "0", "Unexpected Hub exit must fail all mode");
    } else {
      docker("stop", "--time", "40", name);
      assert.equal(docker("inspect", "--format", "{{.State.ExitCode}}", name), "0");
    }
    results.push({
      mode,
      health: "passed",
      webUi: mode === "hub" ? "absent (backend only)" : "passed",
      daemonSocket:
        mode === "hub" ? null : "missing/wrong password 4401, valid password server_info",
      hubProxy:
        mode === "all"
          ? "account, cookie, CLI login, WebSocket admission, malformed upgrade and per-client quotas passed"
          : null,
      inactivePortClosed: mode === "all" ? null : true,
      restart: "passed",
      shutdown: mode === "all" ? "fails when Hub exits" : "graceful",
    });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    console.error(docker("logs", name));
    throw error;
  } finally {
    try {
      docker("rm", "--force", "--volumes", name);
    } catch {}
  }
}
const onboardingName = `clisbot-onboarding-smoke-${process.pid}`;
try {
  docker(
    "run",
    "-d",
    "--name",
    onboardingName,
    "--user",
    "clisbot",
    "--entrypoint",
    "node",
    "-e",
    "CLISBOT_HOME=/home/clisbot/onboarding-smoke",
    "-e",
    "CLISBOT_LISTEN=127.0.0.1:7181",
    "-e",
    "CLISBOT_PASSWORD=isolated-onboarding-test",
    "-e",
    "CLISBOT_RELAY_ENABLED=false",
    "-e",
    "CLISBOT_DICTATION_ENABLED=false",
    "-e",
    "CLISBOT_VOICE_MODE_ENABLED=false",
    "-e",
    `CLISBOT_HUB_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("base64")}`,
    image,
    "-e",
    "setInterval(() => {}, 60000)",
  );
  docker(
    "exec",
    onboardingName,
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { createBotStartDeps } from '/usr/local/lib/node_modules/@clisbot/cli/dist/commands/bot/run.js';
    const home = process.env.CLISBOT_HOME;
    const deps = createBotStartDeps(home, process.env);
    assert.equal((await deps.ensureDaemonUp(home, process.env)).daemon, 'started');
    await deps.waitDaemonUp(home);
    const hub = await deps.ensureHubUp(home, process.env);
    await deps.waitHubReady(hub.url);
    const start = await fetch(hub.url + '/api/v1/cli-authorizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(start.status, 201);
    const login = await start.json();
    assert.equal(new URL(login.verificationUri).origin, 'http://127.0.0.1:7181');
    const page = await fetch(login.verificationUriComplete);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /__CLISBOT_HUB_ENABLED__=true/);
    assert.equal((await fetch(hub.url)).status, 404, 'Hub remains backend only');
    const claim = await fetch('http://127.0.0.1:7181/api/auth/clisbot/claim-instance', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:7181' }, body: JSON.stringify({ email: 'onboarding@example.test', password: 'isolated-onboarding-owner' }) });
    assert.equal(claim.status, 200, await claim.text());
  `,
  );
  console.log(
    JSON.stringify({
      localOnboarding:
        "shared UI, CLI verification URL and account claim passed on custom daemon port",
    }),
  );
} finally {
  docker("rm", "--force", "--volumes", onboardingName);
}
console.log(JSON.stringify({ image, results, localOnboarding: "passed" }, null, 2));
