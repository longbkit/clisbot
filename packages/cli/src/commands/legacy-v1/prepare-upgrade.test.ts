import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareV1Upgrade } from "./prepare-upgrade.js";

const homes: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

function home(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "clisbot-v1-upgrade-"));
  homes.push(directory);
  writeFileSync(
    path.join(directory, "clisbot.json"),
    JSON.stringify({
      meta: { schemaVersion: "0.1.53" },
      agents: {
        defaults: { cli: "codex" },
        list: [{ id: "assistant", name: "My assistant" }],
      },
      bots: { slack: { personal: { botToken: "test-secret-never-log" } } },
    }),
  );
  return directory;
}

async function startLegacyProcess(directory: string, configHome = directory) {
  const entry = path.join(directory, "clisbot-fixture", "dist", "main.js");
  mkdirSync(path.dirname(entry), { recursive: true });
  mkdirSync(path.join(directory, "state"), { recursive: true });
  writeFileSync(entry, 'setInterval(()=>{},1000);process.stdout.write("ready\\n");');
  const child = spawn(process.execPath, [entry, "serve-monitor"], {
    env: {
      ...process.env,
      CLISBOT_CONFIG_PATH: path.join(configHome, "clisbot.json"),
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(child);
  await once(child.stdout!, "data");
  writeFileSync(path.join(directory, "state", "clisbot.pid"), String(child.pid));
  return child;
}

afterEach(async () => {
  delete process.env.CLISBOT_V1_MIGRATION_ENABLED;
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  for (const directory of homes.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("v1 home handover", () => {
  it("keeps clisbot.json, creates v2 profiles and a private backup without secrets in the report", async () => {
    const directory = home();
    const original = readFileSync(path.join(directory, "clisbot.json"), "utf8");
    const report = await prepareV1Upgrade(directory);
    expect(readFileSync(path.join(directory, "clisbot.json"), "utf8")).toBe(original);
    expect(readFileSync(path.join(report!.backup, "clisbot.json"), "utf8")).toBe(original);
    const config = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
    expect(config.features.devicePairing).toBe(true);
    expect(config.daemon.managedAccess.mode).toBe("off");
    expect(config.daemon.agentProfiles).toEqual([
      { id: "legacy-v1-0", name: "My assistant", provider: "codex" },
    ]);
    expect(JSON.stringify(report)).not.toContain("test-secret-never-log");
    if (process.platform !== "win32")
      expect(statSync(path.join(report!.backup, "clisbot.json")).mode & 0o777).toBe(0o600);
  });

  it("preserves a valid existing config.json byte-for-byte", async () => {
    const directory = home();
    const original = '{"version":1,"daemon":{"listen":"127.0.0.1:7878"}}\n';
    writeFileSync(path.join(directory, "config.json"), original);
    const report = await prepareV1Upgrade(directory);
    expect(report?.config).toBe("preserved");
    expect(readFileSync(path.join(directory, "config.json"), "utf8")).toBe(original);
  });

  it("backs up invalid v2 configuration before replacing it", async () => {
    const directory = home();
    const original = '{"agents":{"list":["old shape"]}}';
    writeFileSync(path.join(directory, "config.json"), original);
    const report = await prepareV1Upgrade(directory);
    expect(report?.config).toBe("replaced-invalid");
    expect(readFileSync(path.join(report!.backup, "config.json"), "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8")).version).toBe(1);
  });

  it("serializes concurrent preparations and creates one migration receipt", async () => {
    const directory = home();
    const [first, second] = await Promise.all([
      prepareV1Upgrade(directory),
      prepareV1Upgrade(directory),
    ]);
    expect(first?.backup).toBe(second?.backup);
    const config = readFileSync(path.join(directory, "config.json"), "utf8");
    expect((await prepareV1Upgrade(directory))?.backup).toBe(first?.backup);
    expect(readFileSync(path.join(directory, "config.json"), "utf8")).toBe(config);
  });

  it("makes no changes when migration is disabled", async () => {
    const directory = home();
    process.env.CLISBOT_V1_MIGRATION_ENABLED = "0";
    expect(await prepareV1Upgrade(directory)).toBeNull();
    expect(existsSync(path.join(directory, "config.json"))).toBe(false);
    expect(existsSync(path.join(directory, "backups"))).toBe(false);
  });

  it("refuses to stop an unrelated live process referenced by a stale pid file", async () => {
    const directory = home();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(child);
    await once(child, "spawn");
    mkdirSync(path.join(directory, "state"));
    writeFileSync(path.join(directory, "state", "clisbot.pid"), String(child.pid));
    await expect(prepareV1Upgrade(directory)).rejects.toThrow(
      /Cannot verify v1 PID|Stop v1 before upgrading/u,
    );
    expect(child.exitCode).toBeNull();
    expect(existsSync(path.join(directory, "config.json"))).toBe(false);
    const pending = JSON.parse(readFileSync(path.join(directory, "v1-upgrade.json"), "utf8"));
    expect(pending.phase).toBe("preparing");
    const exited = once(child, "exit");
    child.kill();
    await exited;
    const resumed = await prepareV1Upgrade(directory);
    expect(resumed?.backup).toBe(pending.backup);
    expect(resumed?.phase).toBe("prepared");
  });

  it.skipIf(process.platform === "win32")(
    "leaves a v1 process from a different home running",
    async () => {
      const directory = home();
      const child = await startLegacyProcess(directory, home());
      await expect(prepareV1Upgrade(directory)).rejects.toThrow("belongs to this home");
      expect(child.exitCode).toBeNull();
      expect(existsSync(path.join(directory, "config.json"))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "backs up and stops v1 if it restarts after migration",
    async () => {
      const directory = home();
      const first = await prepareV1Upgrade(directory);
      const original = readFileSync(path.join(directory, "config.json"), "utf8");
      const child = await startLegacyProcess(directory);
      writeFileSync(path.join(directory, "state", "runtime-credentials.json"), "new credentials");
      const resumed = await prepareV1Upgrade(directory);
      expect(resumed?.backup).toBe(first?.backup);
      expect(resumed?.stoppedPids).toContain(child.pid);
      expect(
        readFileSync(
          path.join(resumed!.restartBackups![0], "state", "runtime-credentials.json"),
          "utf8",
        ),
      ).toBe("new credentials");
      expect(readFileSync(path.join(directory, "config.json"), "utf8")).toBe(original);
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops a verified monitor and backs up ephemeral credentials first",
    async () => {
      const directory = home();
      const entry = path.join(directory, "clisbot-fixture", "dist", "main.js");
      mkdirSync(path.dirname(entry), { recursive: true });
      mkdirSync(path.join(directory, "state"));
      const credentials = path.join(directory, "state", "runtime-credentials.json");
      writeFileSync(credentials, '{"token":"ephemeral-test-secret"}');
      writeFileSync(
        entry,
        'process.on("SIGTERM",()=>{require("fs").unlinkSync(process.env.CREDENTIALS);process.exit(0)});setInterval(()=>{},1000);process.stdout.write("ready\\n");',
      );
      const child = spawn(process.execPath, [entry, "serve-monitor"], {
        env: {
          ...process.env,
          CLISBOT_CONFIG_PATH: path.join(directory, "clisbot.json"),
          CREDENTIALS: credentials,
        },
        stdio: ["ignore", "pipe", "ignore"],
      });
      children.push(child);
      await once(child.stdout!, "data");
      writeFileSync(path.join(directory, "state", "clisbot.pid"), String(child.pid));
      const report = await prepareV1Upgrade(directory);
      expect(report?.stoppedPids).toContain(child.pid);
      expect(existsSync(credentials)).toBe(false);
      expect(
        readFileSync(path.join(report!.backup, "state", "runtime-credentials.json"), "utf8"),
      ).toContain("ephemeral-test-secret");
      expect(JSON.stringify(report)).not.toContain("ephemeral-test-secret");
    },
  );

  it("backs up and replaces only the recognized old home wrapper", async () => {
    const directory = home();
    const wrapper = path.join(directory, "bin", "clisbot");
    mkdirSync(path.dirname(wrapper));
    const original =
      '#!/bin/sh\nexport CLISBOT_WRAPPER_PATH=x\nexec node old-main.js --internal-cli-name clisbot "$@"\n';
    writeFileSync(wrapper, original);
    chmodSync(wrapper, 0o755);
    const report = await prepareV1Upgrade(directory);
    expect(readFileSync(path.join(report!.backup, "clisbot-wrapper"), "utf8")).toBe(original);
    expect(readFileSync(wrapper, "utf8")).toContain("/bin/clisbot");
  });
});
