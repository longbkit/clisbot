import { describe, expect, test } from "vitest";
import {
  createLaunchd,
  describeLaunchdFailure,
  parseLaunchdJobState,
  type LaunchdResult,
} from "./launchd.js";

const LOADED_JOB = `{
	"StandardOutPath" = "/Users/tester/.paseo/state/launchd/daemon.out.log";
	"LimitLoadToSessionType" = "Aqua";
	"LastExitStatus" = 0;
	"PID" = 870;
	"Label" = "ai.clisbot.fusion.daemon";
	"OnDemand" = false;
};`;

function recordingRunner(results: LaunchdResult[] = []) {
  const calls: string[][] = [];
  return {
    calls,
    run: async (file: string, args: string[]): Promise<LaunchdResult> => {
      calls.push([file, ...args]);
      return results.shift() ?? { status: 0, stdout: "", stderr: "" };
    },
  };
}

describe("parseLaunchdJobState", () => {
  test("reads the pid and last exit status out of a job dictionary", () => {
    expect(parseLaunchdJobState(LOADED_JOB)).toEqual({ loaded: true, pid: 870, lastExitStatus: 0 });
  });

  test("a loaded job that is not running has no pid", () => {
    const stopped = LOADED_JOB.replace('\t"PID" = 870;\n', "");
    expect(parseLaunchdJobState(stopped)).toEqual({ loaded: true, pid: null, lastExitStatus: 0 });
  });
});

describe("launchd client", () => {
  test("addresses the gui domain of the installing user", async () => {
    const runner = recordingRunner();
    const launchd = createLaunchd({ userHome: "/Users/tester", uid: 501, run: runner.run });

    await launchd.bootout("ai.clisbot.fusion.hub");
    await launchd.bootstrap("/Users/tester/Library/LaunchAgents/ai.clisbot.fusion.hub.plist");

    expect(launchd.domain).toBe("gui/501");
    expect(launchd.plistPath("ai.clisbot.fusion.hub")).toBe(
      "/Users/tester/Library/LaunchAgents/ai.clisbot.fusion.hub.plist",
    );
    expect(runner.calls).toEqual([
      ["launchctl", "bootout", "gui/501/ai.clisbot.fusion.hub"],
      [
        "launchctl",
        "bootstrap",
        "gui/501",
        "/Users/tester/Library/LaunchAgents/ai.clisbot.fusion.hub.plist",
      ],
    ]);
  });

  test("a label launchd does not know reads as not loaded", async () => {
    const runner = recordingRunner([{ status: 113, stdout: "", stderr: "Could not find service" }]);
    const launchd = createLaunchd({ userHome: "/Users/tester", uid: 501, run: runner.run });

    await expect(launchd.readJob("sh.paseo.hub")).resolves.toEqual({
      loaded: false,
      pid: null,
      lastExitStatus: null,
    });
  });

  test("a failure message prefers stderr, then stdout, then the exit status", () => {
    expect(
      describeLaunchdFailure(
        { status: 5, stdout: "out", stderr: "Bootstrap failed: 5" },
        "bootstrap",
      ),
    ).toBe("Bootstrap failed: 5");
    expect(describeLaunchdFailure({ status: 5, stdout: "out", stderr: "  " }, "bootstrap")).toBe(
      "out",
    );
    expect(describeLaunchdFailure({ status: 5, stdout: "", stderr: "" }, "bootstrap")).toBe(
      "launchctl bootstrap exited with status 5",
    );
  });
});
