import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { installTarget } from "./install.js";
import { statusTarget } from "./status.js";
import { uninstallTarget } from "./uninstall.js";
import type { Launchd, LaunchdJobState, LaunchdResult } from "./launchd.js";
import type { AutostartTarget } from "./targets.js";

const TARGET: AutostartTarget = {
  name: "hub",
  label: "ai.clisbot.fusion.hub",
  argv: ["/usr/bin/node", "/opt/paseo/bin/paseo", "hub", "start", "--foreground"],
  environment: { PASEO_HOME: "/srv/fusion" },
  workingDirectory: "/srv/fusion",
  standardOutPath: "/srv/fusion/state/launchd/hub.out.log",
  standardErrorPath: "/srv/fusion/state/launchd/hub.err.log",
};

interface FakeLaunchd extends Launchd {
  calls: string[];
}

/** The default sequence is what a real install sees: the label is gone after
 * bootout (the settle wait returns at once), then the new job is loaded. */
function fakeLaunchd(input: {
  agentsDirectory: string;
  bootstraps?: LaunchdResult[];
  jobs?: LaunchdJobState[];
}): FakeLaunchd {
  const calls: string[] = [];
  const bootstraps = input.bootstraps ?? [{ status: 0, stdout: "", stderr: "" }];
  const jobs = input.jobs ?? [
    { loaded: false, pid: null, lastExitStatus: null },
    { loaded: true, pid: 4321, lastExitStatus: 0 },
  ];
  const next = <T>(queue: T[]): T => (queue.length > 1 ? (queue.shift() as T) : (queue[0] as T));
  return {
    calls,
    domain: "gui/501",
    agentsDirectory: input.agentsDirectory,
    plistPath: (label) => path.join(input.agentsDirectory, `${label}.plist`),
    bootstrap: async (plist) => {
      calls.push(`bootstrap ${path.basename(plist)}`);
      return next(bootstraps);
    },
    bootout: async (label) => {
      calls.push(`bootout ${label}`);
      return { status: 0, stdout: "", stderr: "" };
    },
    readJob: async () => next(jobs),
  };
}

describe("autostart target lifecycle", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "paseo-autostart-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("install writes the plist, reloads the job, and reports the running pid", async () => {
    const launchd = fakeLaunchd({ agentsDirectory: directory });

    const row = await installTarget(TARGET, launchd);

    expect(launchd.calls).toEqual([
      "bootout ai.clisbot.fusion.hub",
      "bootstrap ai.clisbot.fusion.hub.plist",
    ]);
    expect(row).toEqual({
      target: "hub",
      label: "ai.clisbot.fusion.hub",
      state: "running",
      pid: "4321",
      lastExit: "0",
      plist: path.join(directory, "ai.clisbot.fusion.hub.plist"),
    });
    const plist = await readFile(path.join(directory, "ai.clisbot.fusion.hub.plist"), "utf8");
    expect(plist).toContain("<string>ai.clisbot.fusion.hub</string>");
  });

  // Exhausts the real retry backoff (~5s) before giving up, so it needs its own
  // timeout rather than fake timers.
  test(
    "install surfaces what launchd said when it refuses the job",
    { timeout: 15_000 },
    async () => {
      const launchd = fakeLaunchd({
        agentsDirectory: directory,
        bootstraps: [{ status: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" }],
      });

      await expect(installTarget(TARGET, launchd)).rejects.toMatchObject({
        code: "BOOTSTRAP_FAILED",
        message: "launchd refused ai.clisbot.fusion.hub: Bootstrap failed: 5: Input/output error",
      });
    },
  );

  test("install retries a bootstrap that landed while launchd tore the old job down", async () => {
    const launchd = fakeLaunchd({
      agentsDirectory: directory,
      bootstraps: [
        { status: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" },
        { status: 0, stdout: "", stderr: "" },
      ],
      jobs: [
        { loaded: true, pid: 1, lastExitStatus: 0 },
        { loaded: false, pid: null, lastExitStatus: null },
        { loaded: true, pid: 999, lastExitStatus: 0 },
      ],
    });

    await expect(installTarget(TARGET, launchd)).resolves.toMatchObject({
      state: "running",
      pid: "999",
    });
    expect(launchd.calls.filter((call) => call.startsWith("bootstrap"))).toHaveLength(2);
  });

  test("status reads the loaded job, and a missing plist reads as not installed", async () => {
    const launchd = fakeLaunchd({ agentsDirectory: directory });
    await expect(statusTarget(TARGET, launchd)).resolves.toMatchObject({ state: "not-installed" });

    await writeFile(path.join(directory, "ai.clisbot.fusion.hub.plist"), "plist", "utf8");
    await expect(statusTarget(TARGET, launchd)).resolves.toMatchObject({ state: "running" });
  });

  test("status distinguishes loaded-but-not-running from not loaded", async () => {
    await writeFile(path.join(directory, "ai.clisbot.fusion.hub.plist"), "plist", "utf8");
    const stopped = fakeLaunchd({
      agentsDirectory: directory,
      jobs: [{ loaded: true, pid: null, lastExitStatus: 1 }],
    });
    await expect(statusTarget(TARGET, stopped)).resolves.toMatchObject({
      state: "loaded",
      lastExit: "1",
    });

    const unloaded = fakeLaunchd({
      agentsDirectory: directory,
      jobs: [{ loaded: false, pid: null, lastExitStatus: null }],
    });
    await expect(statusTarget(TARGET, unloaded)).resolves.toMatchObject({ state: "not-loaded" });
  });

  test("uninstall boots the job out and deletes the plist", async () => {
    const plistPath = path.join(directory, "ai.clisbot.fusion.hub.plist");
    await writeFile(plistPath, "plist", "utf8");
    const launchd = fakeLaunchd({ agentsDirectory: directory });

    await expect(uninstallTarget(TARGET, launchd)).resolves.toMatchObject({ state: "removed" });
    expect(launchd.calls).toEqual(["bootout ai.clisbot.fusion.hub"]);
    await expect(readFile(plistPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(uninstallTarget(TARGET, launchd)).resolves.toMatchObject({ state: "absent" });
  });
});
