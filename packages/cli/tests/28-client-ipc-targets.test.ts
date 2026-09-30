#!/usr/bin/env npx tsx

import assert from "node:assert";
import {
  getDaemonHost,
  normalizeDaemonHost,
  resolveDaemonPassword,
  resolveDaemonTarget,
} from "../src/utils/client.js";
import { selectDaemonTarget } from "../src/utils/daemon-target.js";
import { resolveCliVersion } from "../src/version.js";

console.log("=== CLI IPC Target Helpers ===\n");

{
  console.log("Test 1: unix hosts resolve to ws+unix URLs");
  const target = resolveDaemonTarget("unix:///tmp/clisbot.sock");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws+unix:///tmp/clisbot.sock:/ws",
    socketPath: "/tmp/clisbot.sock",
  });
  console.log("✓ unix hosts resolve to ws+unix URLs\n");
}

{
  console.log("Test 1b: bare unix socket paths resolve at the connection boundary");
  const target = resolveDaemonTarget("/tmp/clisbot.sock");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws+unix:///tmp/clisbot.sock:/ws",
    socketPath: "/tmp/clisbot.sock",
  });
  console.log("✓ bare unix socket paths resolve at the connection boundary\n");
}

{
  console.log("Test 2: pipe hosts preserve the Node socketPath transport form");
  const target = resolveDaemonTarget("pipe://\\\\.\\pipe\\clisbot-managed-test");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws://localhost/ws",
    socketPath: "\\\\.\\pipe\\clisbot-managed-test",
  });
  console.log("✓ pipe hosts preserve Node socketPath transport form\n");
}

{
  console.log("Test 3: tcp URI host targets honor ssl=true");
  const target = resolveDaemonTarget("tcp://example.com:6868?ssl=true&password=query-secret");
  assert.deepStrictEqual(target, {
    type: "tcp",
    url: "wss://example.com:6868/ws",
  });
  console.log("✓ tcp URI host targets honor ssl=true\n");
}

{
  console.log("Test 4: tcp URI hosts normalize into canonical direct TCP targets");
  assert.strictEqual(
    normalizeDaemonHost("tcp://Example.com:6868?ssl=true&password=query-secret"),
    "tcp://Example.com:6868?ssl=true&password=query-secret",
  );
  console.log("✓ tcp URI hosts normalize into canonical direct TCP targets\n");
}

{
  console.log("Test 5: local unix socket paths normalize into IPC daemon targets");
  assert.strictEqual(normalizeDaemonHost("/tmp/clisbot.sock"), "unix:///tmp/clisbot.sock");
  console.log("✓ local unix socket paths normalize into IPC daemon targets\n");
}

{
  console.log("Test 5b: Windows absolute paths are NOT treated as unix sockets");
  assert.strictEqual(normalizeDaemonHost("C:\\Users\\foo\\.clisbot\\clisbot.sock"), null);
  assert.strictEqual(normalizeDaemonHost("D:\\project\\socket"), null);
  console.log("✓ Windows absolute paths are not treated as unix sockets\n");
}

{
  const target = selectDaemonTarget(
    { home: "/tmp/selected-home" },
    { CLISBOT_HOST: "ignored:12345", CLISBOT_LISTEN: "ignored:23456" },
  );
  assert.deepStrictEqual(target, { kind: "instance", home: "/tmp/selected-home" });
  assert.strictEqual(getDaemonHost({ target }), "home /tmp/selected-home");
  assert.throws(() =>
    selectDaemonTarget({}, { CLISBOT_HOME: "/tmp/a", CLISBOT_HOST: "unused:12345" }),
  );
}

{
  console.log("Test 8: CLI app version resolves for daemon hello compatibility");
  assert.match(resolveCliVersion(), /^\d+\.\d+\.\d+/);
  console.log("✓ CLI app version resolves for daemon hello compatibility\n");
}

{
  console.log("Test 10: daemon password resolution prefers TCP URI query, falls back to env");
  const previousEnv = process.env.CLISBOT_PASSWORD;
  try {
    delete process.env.CLISBOT_PASSWORD;
    assert.strictEqual(
      resolveDaemonPassword("tcp://example.com:6868?ssl=true&password=query-secret"),
      "query-secret",
    );
    assert.strictEqual(resolveDaemonPassword("tcp://missing.example:6868"), undefined);
    assert.strictEqual(resolveDaemonPassword("example.com:6868"), undefined);

    process.env.CLISBOT_PASSWORD = "env-secret";
    assert.strictEqual(
      resolveDaemonPassword("tcp://example.com:6868?ssl=true&password=query-secret"),
      "query-secret",
      "URI password should take precedence over env var",
    );
    assert.strictEqual(
      resolveDaemonPassword("tcp://missing.example:6868"),
      "env-secret",
      "TCP host without query password should fall back to env var",
    );
    assert.strictEqual(
      resolveDaemonPassword("example.com:6868"),
      "env-secret",
      "Bare host should pick up env var password",
    );
    assert.strictEqual(resolveDaemonPassword("localhost:6868"), "env-secret");

    process.env.CLISBOT_PASSWORD = "";
    assert.strictEqual(
      resolveDaemonPassword("localhost:6868"),
      undefined,
      "Empty env var should be treated as unset",
    );
  } finally {
    if (previousEnv === undefined) {
      delete process.env.CLISBOT_PASSWORD;
    } else {
      process.env.CLISBOT_PASSWORD = previousEnv;
    }
  }
  console.log("✓ daemon password resolution prefers TCP URI query, falls back to env\n");
}

console.log("=== All CLI IPC target tests passed ===");
