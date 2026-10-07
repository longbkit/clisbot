import type { OutputSchema } from "../../output/index.js";
import type { LaunchdJobState } from "./launchd.js";
import type { AutostartTarget } from "./targets.js";

export interface AutostartRow {
  target: string;
  label: string;
  state: string;
  pid: string;
  lastExit: string;
  plist: string;
}

const STATE_COLORS: Record<string, string> = {
  running: "green",
  removed: "green",
  loaded: "yellow",
};

export const autostartRowSchema: OutputSchema<AutostartRow> = {
  idField: "label",
  columns: [
    { header: "TARGET", field: "target" },
    { header: "LABEL", field: "label" },
    { header: "STATE", field: "state", color: (value) => STATE_COLORS[String(value)] },
    { header: "PID", field: "pid" },
    { header: "LAST EXIT", field: "lastExit" },
    { header: "PLIST", field: "plist" },
  ],
};

/** One vocabulary for every verb: a job is running, loaded but not running, or
 * not loaded; a plist with no job is not-installed. */
export function jobStateWord(job: LaunchdJobState | null, installed: boolean): string {
  if (!installed) return "not-installed";
  if (job === null || !job.loaded) return "not-loaded";
  return job.pid === null ? "loaded" : "running";
}

export function autostartRow(
  target: AutostartTarget,
  plist: string,
  state: string,
  job: LaunchdJobState | null,
): AutostartRow {
  return {
    target: target.name,
    label: target.label,
    state,
    pid: job === null || job.pid === null ? "-" : String(job.pid),
    lastExit: job === null || job.lastExitStatus === null ? "-" : String(job.lastExitStatus),
    plist,
  };
}
