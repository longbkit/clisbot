import { describe, expect, test } from "vitest";
import { createAutostartCommand } from "./index.js";
import { resolveAutostartContext, resolveAutostartTargets } from "./targets.js";

/** Runs the real commander wiring for `install`, with the action replaced so no
 * launchd call happens. Regression guard for option keys (`--target` lands on
 * `options.target`) and for the values the plan is built from. */
function parseInstall(argv: string[]): Record<string, unknown> {
  const autostart = createAutostartCommand();
  const install = autostart.commands.find((command) => command.name() === "install");
  if (install === undefined) throw new Error("install command is not registered");
  let captured: Record<string, unknown> = {};
  install.action((options: Record<string, unknown>) => {
    captured = options;
  });
  autostart.exitOverride().parse(["install", ...argv], { from: "user" });
  return captured;
}

describe("autostart command wiring", () => {
  test("--target picks one target instead of both", () => {
    const options = parseInstall(["--target", "hub", "--home", "/srv/fusion"]);
    const context = resolveAutostartContext({
      options,
      platform: "darwin",
      userHome: "/Users/tester",
      nodePath: "/usr/bin/node",
      cliBinPath: "/opt/paseo/bin/paseo",
      environment: { PATH: "/usr/bin" },
    });

    expect(options.target).toEqual(["hub"]);
    expect(resolveAutostartTargets(context).map((target) => target.name)).toEqual(["hub"]);
  });

  test("--listen, --env, and --label-prefix reach the generated job", () => {
    const options = parseInstall([
      "--target",
      "daemon",
      "--home",
      "/srv/fusion",
      "--label-prefix",
      "ai.clisbot.fusion",
      "--listen",
      "127.0.0.1:6770",
      "--env",
      "PASEO_AGENT_SESSION_STORAGE=1",
    ]);
    const [daemon] = resolveAutostartTargets(
      resolveAutostartContext({
        options,
        platform: "darwin",
        userHome: "/Users/tester",
        nodePath: "/usr/bin/node",
        cliBinPath: "/opt/paseo/bin/paseo",
        environment: { PATH: "/usr/bin" },
      }),
    );

    expect(daemon?.label).toBe("ai.clisbot.fusion.daemon");
    expect(daemon?.environment.PASEO_LISTEN).toBe("127.0.0.1:6770");
    expect(daemon?.environment.PASEO_AGENT_SESSION_STORAGE).toBe("1");
  });
});
