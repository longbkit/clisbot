import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Command } from "commander";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { describeLaunchdFailure, type Launchd, type LaunchdResult } from "./launchd.js";
import { renderAutostartPlist } from "./plist.js";
import { autostartRow, autostartRowSchema, jobStateWord, type AutostartRow } from "./row.js";
import { resolveHostAutostart, type AutostartOptions } from "./host.js";
import { autostartError, collectOption, type AutostartTarget } from "./targets.js";
import { addTargetOptions } from "./options.js";

const BOOTOUT_SETTLE_TIMEOUT_MS = 4_000;
const BOOTSTRAP_RETRY_DELAYS_MS = [500, 1_500, 3_000];

/** launchd tears a booted-out job's processes down asynchronously and answers a
 * bootstrap that lands mid-teardown with EIO ("Input/output error"), so wait for
 * the label to disappear before loading the new definition. */
async function bootoutAndSettle(target: AutostartTarget, launchd: Launchd): Promise<void> {
  await launchd.bootout(target.label);
  const deadline = Date.now() + BOOTOUT_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await launchd.readJob(target.label)).loaded) return;
    await delay(150);
  }
}

async function bootstrapWithRetry(plist: string, launchd: Launchd): Promise<LaunchdResult> {
  let result = await launchd.bootstrap(plist);
  for (const waitMs of BOOTSTRAP_RETRY_DELAYS_MS) {
    if (result.status === 0) return result;
    await delay(waitMs);
    result = await launchd.bootstrap(plist);
  }
  return result;
}

export async function installTarget(
  target: AutostartTarget,
  launchd: Launchd,
): Promise<AutostartRow> {
  const plist = launchd.plistPath(target.label);
  await writeFile(plist, renderAutostartPlist(target), { encoding: "utf8", mode: 0o644 });
  // The same command is the reinstall path: drop the loaded definition first so
  // the new one (argv, environment, log paths) is what launchd runs.
  await bootoutAndSettle(target, launchd);
  const bootstrap = await bootstrapWithRetry(plist, launchd);
  if (bootstrap.status !== 0) {
    throw autostartError(
      "BOOTSTRAP_FAILED",
      `launchd refused ${target.label}: ${describeLaunchdFailure(bootstrap, "bootstrap")}`,
      { label: target.label, plist },
    );
  }
  const job = await launchd.readJob(target.label);
  return autostartRow(target, plist, jobStateWord(job, true), job);
}

export async function runInstallCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<AutostartRow>> {
  const { targets, launchd } = resolveHostAutostart(options as AutostartOptions);
  await mkdir(launchd.agentsDirectory, { recursive: true });
  const rows: AutostartRow[] = [];
  for (const target of targets) {
    rows.push(await installTarget(target, launchd));
  }
  return { type: "list", data: rows, schema: autostartRowSchema };
}

export function addInstallCommand(parent: Command): void {
  const command = addTargetOptions(new Command("install"))
    .description("Write the launchd agents and load them now")
    .option("--listen <host:port>", "Listen target for the daemon (default: the daemon's own)")
    .option("--hub-port <port>", "Hub port (default: the port recorded in hub-local.json)")
    .option(
      "--env <KEY=VALUE>",
      "Extra environment for the agents (repeatable)",
      collectOption,
      [],
    );
  command.action(withOutput(runInstallCommand));
  parent.addCommand(command);
}
