import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Command } from "commander";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { autostartRow, autostartRowSchema, type AutostartRow } from "./row.js";
import { resolveHostAutostart, type AutostartOptions } from "./host.js";
import type { Launchd } from "./launchd.js";
import { addTargetOptions } from "./options.js";
import type { AutostartTarget } from "./targets.js";

export async function uninstallTarget(
  target: AutostartTarget,
  launchd: Launchd,
): Promise<AutostartRow> {
  const plist = launchd.plistPath(target.label);
  const installed = existsSync(plist);
  // Boot out unconditionally: a job can stay loaded after its plist is gone.
  await launchd.bootout(target.label);
  await rm(plist, { force: true });
  return autostartRow(target, plist, installed ? "removed" : "absent", null);
}

export async function runUninstallCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<AutostartRow>> {
  const { targets, launchd } = resolveHostAutostart(options as AutostartOptions);
  const rows: AutostartRow[] = [];
  for (const target of targets) {
    rows.push(await uninstallTarget(target, launchd));
  }
  return { type: "list", data: rows, schema: autostartRowSchema };
}

export function addUninstallCommand(parent: Command): void {
  const command = addTargetOptions(new Command("uninstall")).description(
    "Unload the launchd agents and delete their plists",
  );
  command.action(withOutput(runUninstallCommand));
  parent.addCommand(command);
}
