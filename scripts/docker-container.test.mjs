import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const runner = new URL("../docker/base/rootfs/usr/local/lib/clisbot-container.mjs", import.meta.url)
  .href;

function fixture(t, mode, fail = "", missing = "") {
  const root = mkdtempSync(join(tmpdir(), "clisbot-container-"));
  const entries = {};
  for (const role of ["daemon", "hub"]) {
    entries[role] = join(root, `${role}.mjs`);
    if (role === missing) continue;
    writeFileSync(
      entries[role],
      `
      import { writeFileSync, existsSync } from 'node:fs';
      writeFileSync(${JSON.stringify(join(root, `${role}.pid`))}, String(process.pid));
      process.on('SIGTERM', () => {
        writeFileSync(${JSON.stringify(join(root, `${role}.stopped`))}, 'yes');
        process.exit(0);
      });
      ${role === fail ? `setInterval(() => { if (existsSync(${JSON.stringify(join(root, `${role === "hub" ? "daemon" : "hub"}.pid`))})) process.exit(17); }, 25);` : "setInterval(() => {}, 1000);"}
    `,
    );
  }
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { runServices } from ${JSON.stringify(runner)}; runServices(${JSON.stringify(mode)}, ${JSON.stringify(entries)});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exit = once(child, "exit");
  t.after(async () => {
    child.kill("SIGTERM");
    for (const role of ["daemon", "hub"]) {
      const path = join(root, `${role}.pid`);
      if (existsSync(path)) {
        try {
          process.kill(Number(readFileSync(path, "utf8")), "SIGKILL");
        } catch {}
      }
    }
    await exit;
    rmSync(root, { recursive: true, force: true });
  });
  return { child, exit, root, output: () => output };
}

async function ready(root, role) {
  for (let n = 0; n < 80; n++) {
    if (existsSync(join(root, `${role}.pid`))) return;
    await delay(25);
  }
  assert.fail(`${role} did not start`);
}

for (const [mode, active, inactive] of [
  ["daemon", ["daemon"], "hub"],
  ["hub", ["hub"], "daemon"],
  ["all", ["daemon", "hub"], ""],
]) {
  test(
    `${mode} starts only selected services and forwards shutdown`,
    { timeout: 5000 },
    async (t) => {
      const f = fixture(t, mode, "", inactive);
      await Promise.all(active.map((role) => ready(f.root, role)));
      if (inactive) assert.equal(existsSync(join(f.root, `${inactive}.pid`)), false);
      f.child.kill("SIGTERM");
      assert.deepEqual(await f.exit, [0, null]);
      for (const role of active)
        assert.equal(readFileSync(join(f.root, `${role}.stopped`), "utf8"), "yes");
    },
  );
}

for (const failed of ["daemon", "hub"]) {
  test(
    `${failed} failure stops the sibling and fails the container`,
    { timeout: 5000 },
    async (t) => {
      const f = fixture(t, "all", failed);
      assert.deepEqual(await f.exit, [17, null]);
      const sibling = failed === "hub" ? "daemon" : "hub";
      assert.equal(readFileSync(join(f.root, `${sibling}.stopped`), "utf8"), "yes");
    },
  );
}

test("invalid mode fails before starting any service", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "typo");
  assert.deepEqual(await f.exit, [1, null]);
  assert.match(f.output(), /Invalid CLISBOT_RUN_MODE/);
  assert.equal(existsSync(join(f.root, "daemon.pid")), false);
});

test(
  "missing Hub entry fails before starting the daemon in all mode",
  { timeout: 5000 },
  async (t) => {
    const f = fixture(t, "all", "", "hub");
    assert.deepEqual(await f.exit, [1, null]);
    assert.equal(existsSync(join(f.root, "daemon.pid")), false);
  },
);
