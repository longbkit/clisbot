import { existsSync } from "node:fs";
import { Command } from "commander";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { autostartRow, autostartRowSchema, jobStateWord, type AutostartRow } from "./row.js";
import { resolveHostAutostart, type AutostartOptions } from "./host.js";
import type { Launchd } from "./launchd.js";
import { addTargetOptions } from "./options.js";
import type { AutostartTarget } from "./targets.js";

export async function statusTarget(
  target: AutostartTarget,
  launchd: Launchd,
): Promise<AutostartRow> {
  const plist = launchd.plistPath(target.label);
  const installed = existsSync(plist);
  const job = await launchd.readJob(target.label);
  return autostartRow(target, plist, jobStateWord(job, installed), job);
}

export async function runStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<AutostartRow>> {
  const { targets, launchd } = resolveHostAutostart(options as AutostartOptions);
  const rows: AutostartRow[] = [];
  for (const target of targets) {
    rows.push(await statusTarget(target, launchd));
  }
  return { type: "list", data: rows, schema: autostartRowSchema };
}

export function addStatusCommand(parent: Command): void {
  const command = addTargetOptions(new Command("status")).description(
    "Report the launchd state of each agent",
  );
  command.action(withOutput(runStatusCommand));
  parent.addCommand(command);
}
