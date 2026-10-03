import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runSecretServiceFixture } from "./linux-secret-service.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "clisbot-keyring-wrapper-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyringReport = path.join(root, "keyring.json");
  const fixtureReport = path.join(root, "fixture.json");
  const keyring = path.join(root, "keyring.mjs");
  const command = path.join(root, "command.mjs");
  await writeFile(
    keyring,
    `
import { writeFileSync } from 'node:fs';
let password='';
process.stdin.on('data', chunk => password += chunk);
process.stdin.on('end', () => writeFileSync(process.env.KEYRING_REPORT,JSON.stringify({
 pid:process.pid,passwordLength:password.length,containsLineBreak:password.includes('\\n'),
 passwordInArgv:process.argv.some(value => value.includes(password)),
 passwordInEnvironment:Object.values(process.env).some(value => value.includes(password)),
 data:process.env.XDG_DATA_HOME,runtime:process.env.XDG_RUNTIME_DIR
})));
setInterval(() => {},1000);
`,
  );
  await writeFile(
    command,
    `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FIXTURE_REPORT,JSON.stringify({
 home:process.env.HOME,data:process.env.XDG_DATA_HOME,runtime:process.env.XDG_RUNTIME_DIR,
 testFlag:process.env.CLISBOT_E2E_SECRET_SERVICE
}));
process.exit(Number(process.argv[2]));
`,
  );
  let report;
  return {
    root,
    command,
    fixtureReport,
    options: {
      environment: { ...process.env, KEYRING_REPORT: keyringReport, FIXTURE_REPORT: fixtureReport },
      launchKeyring: (env) =>
        spawn(process.execPath, [keyring], { env, stdio: ["pipe", "ignore", "ignore"] }),
      waitReady: async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            report = JSON.parse(await readFile(keyringReport, "utf8"));
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        throw new Error("Fake owned keyring did not receive stdin");
      },
    },
    report: () => report,
  };
}

async function assertCleaned(report) {
  assert.equal(report.passwordLength, 43);
  assert.equal(report.containsLineBreak, false);
  assert.equal(report.passwordInArgv, false);
  assert.equal(report.passwordInEnvironment, false);
  assert.throws(() => process.kill(report.pid, 0), /ESRCH/);
  await assert.rejects(stat(report.data), { code: "ENOENT" });
  await assert.rejects(stat(report.runtime), { code: "ENOENT" });
}

test("wrapper preserves HOME, gives only the fixture private XDG paths and forwards its failure status", async (t) => {
  const owned = await fixture(t);
  assert.equal(
    await runSecretServiceFixture(process.execPath, [owned.command, "17"], owned.options),
    17,
  );
  const environment = JSON.parse(await readFile(owned.fixtureReport, "utf8"));
  assert.equal(environment.home, process.env.HOME);
  assert.equal(environment.data, owned.report().data);
  assert.equal(environment.runtime, owned.report().runtime);
  assert.equal(environment.testFlag, "1");
  await assertCleaned(owned.report());
});

test("failed readiness never runs the fixture and still stops the owned keyring/removes its files", async (t) => {
  const owned = await fixture(t);
  const wait = owned.options.waitReady;
  owned.options.waitReady = async (...args) => {
    await wait(...args);
    throw new Error("unlocked collection unavailable");
  };
  await assert.rejects(
    runSecretServiceFixture(process.execPath, [owned.command, "0"], owned.options),
    /unlocked collection unavailable/,
  );
  await assert.rejects(stat(owned.fixtureReport), { code: "ENOENT" });
  await assertCleaned(owned.report());
});
