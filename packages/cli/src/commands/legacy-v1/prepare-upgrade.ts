import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readPersistedConfig, savePersistedConfig } from "@clisbot/server/configuration";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import { withServiceLaunchLock } from "../../utils/service-launch-lock.js";
import { selectLocalPort } from "../hub/local-port.js";
import {
  legacyAgents,
  parseLegacyConfig,
  pendingLegacySettings,
  upgradeConfig,
  type LegacyUpgradeReport,
} from "./legacy-config.js";
import { stopLegacyRuntime } from "./stop-legacy-runtime.js";

const require = createRequire(import.meta.url);
const reportName = "v1-upgrade.json";

export function readUpgradeReport(home: string): LegacyUpgradeReport | null {
  const file = path.join(home, reportName);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as LegacyUpgradeReport) : null;
}

export function saveUpgradeReport(home: string, report: LegacyUpgradeReport): void {
  const destination = path.join(home, reportName);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, destination);
}

function snapshot(home: string): string {
  const directory = path.join(home, "backups", `v1-upgrade-${Date.now()}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const relative of [
    "clisbot.json",
    "state/runtime-credentials.json",
    "state/clisbot.pid",
    "state/clisbot-monitor.json",
  ]) {
    const source = path.join(home, relative);
    if (!existsSync(source)) continue;
    const destination = path.join(directory, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, readFileSync(source), {
      mode: 0o600,
      flag: "wx",
    });
  }
  return directory;
}

function configStatus(home: string): LegacyUpgradeReport["config"] {
  if (!existsSync(path.join(home, "config.json"))) return "created";
  try {
    readPersistedConfig(home);
    return "preserved";
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[Config] Invalid"))
      return "replaced-invalid";
    throw error;
  }
}

function installedCliEntry(): string {
  const prefix = execFileSync("npm", ["prefix", "--global"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  const packageDir = path.join(
    prefix,
    process.platform === "win32" ? "node_modules" : "lib/node_modules",
    "clisbot",
  );
  const manifest = path.join(packageDir, "package.json");
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      name?: string;
      version?: string;
    };
    if (pkg.name === "clisbot" && Number(pkg.version?.split(".")[0]) >= 2) {
      const entry = path.join(packageDir, "bin", "clisbot");
      if (existsSync(entry)) return entry;
    }
  }
  return require.resolve("@clisbot/cli/bin/clisbot");
}

function replaceLegacyWrapper(home: string, backup: string): void {
  const wrapper = path.join(home, "bin", "clisbot");
  if (!existsSync(wrapper)) return;
  const content = readFileSync(wrapper, "utf8");
  if (!content.includes("--internal-cli-name") || !content.includes("CLISBOT_WRAPPER_PATH")) return;
  const original = path.join(backup, "clisbot-wrapper");
  if (!existsSync(original)) writeFileSync(original, content, { mode: 0o600, flag: "wx" });
  const entry = installedCliEntry();
  const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  const script = `#!/usr/bin/env sh\nexport CLISBOT_HOME=${quote(
    home,
  )}\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`;
  const temporary = `${wrapper}.${randomUUID()}.tmp`;
  writeFileSync(temporary, script, { mode: 0o755, flag: "wx" });
  chmodSync(temporary, 0o755);
  renameSync(temporary, wrapper);
}

async function stopWithReport(home: string, report: LegacyUpgradeReport): Promise<void> {
  await stopLegacyRuntime(
    home,
    report.phase === "prepared"
      ? () => {
          const backup = snapshot(home);
          report.restartBackups = [...(report.restartBackups ?? []), backup];
          saveUpgradeReport(home, report);
          process.stderr.write(`Restarted v1 runtime detected. Backup: ${backup}\n`);
        }
      : undefined,
    (pid) => {
      report.stoppedPids = [...new Set([...report.stoppedPids, pid])];
      saveUpgradeReport(home, report);
    },
  );
}

async function applyConfig(home: string, report: LegacyUpgradeReport): Promise<void> {
  const status = configStatus(home);
  if (status === "replaced-invalid") {
    const filename = existsSync(path.join(report.backup, "config.json"))
      ? `config-${Date.now()}.json`
      : "config.json";
    renameSync(path.join(home, "config.json"), path.join(report.backup, filename));
  }
  if (status !== "preserved")
    savePersistedConfig(home, upgradeConfig(report.agents, await selectLocalPort(6868, true)));
  replaceLegacyWrapper(home, report.backup);
}

async function prepare(home: string): Promise<LegacyUpgradeReport> {
  const previous = readUpgradeReport(home);
  if (previous?.phase === "prepared") {
    await stopWithReport(home, previous);
    return previous;
  }
  const config = parseLegacyConfig(readFileSync(path.join(home, "clisbot.json"), "utf8"));
  const agents = legacyAgents(config, home);
  const status = configStatus(home);
  if (status === "replaced-invalid" && (await readDaemonInstance(home))) {
    throw new Error("Stop the running v2 daemon before replacing its invalid config.json.");
  }
  const backup = previous?.backup ?? snapshot(home);
  const report: LegacyUpgradeReport = previous ?? {
    version: 1,
    phase: "preparing",
    backup,
    config: status,
    stoppedPids: [],
    agents,
    registeredWorkspaces: [],
    pending: pendingLegacySettings(config, agents),
    preparedAt: new Date().toISOString(),
  };
  saveUpgradeReport(home, report);
  await stopWithReport(home, report);
  await applyConfig(home, report);
  report.phase = "prepared";
  saveUpgradeReport(home, report);
  process.stderr.write(
    `Clisbot v1 upgrade prepared. Backup: ${backup}\nReport: ${path.join(
      home,
      reportName,
    )}\n${report.pending.map((item) => `- ${item}`).join("\n")}\n`,
  );
  return report;
}

// COMPAT(v1HomeUpgrade): added in v2.0.0; retained for npm users upgrading from v0.1.x.
export async function prepareV1Upgrade(home: string): Promise<LegacyUpgradeReport | null> {
  if (
    process.env.CLISBOT_V1_MIGRATION_ENABLED === "0" ||
    !existsSync(path.join(home, "clisbot.json"))
  )
    return null;
  return withServiceLaunchLock(path.join(home, "v1-upgrade"), () => prepare(home));
}
