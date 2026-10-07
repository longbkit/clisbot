import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseEnvOptions,
  parseTargetNames,
  resolveAutostartContext,
  resolveAutostartTargets,
  type AutostartContext,
} from "./targets.js";

function context(overrides: {
  options?: Record<string, unknown>;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  hubPort?: number;
}): AutostartContext {
  return resolveAutostartContext({
    options: overrides.options ?? {},
    platform: overrides.platform ?? "darwin",
    userHome: "/Users/tester",
    nodePath: "/Users/tester/.nvm/bin/node",
    cliBinPath: "/opt/paseo/bin/paseo",
    hubPort: overrides.hubPort,
    environment: overrides.environment ?? { PATH: "/Users/tester/.local/bin:/usr/bin" },
  });
}

describe("autostart context", () => {
  test("home falls back through PASEO_HOME, CLISBOT_HOME, then ~/.paseo", () => {
    expect(
      context({ environment: { PASEO_HOME: "/srv/paseo", CLISBOT_HOME: "/srv/clisbot" } }).home,
    ).toBe("/srv/paseo");
    expect(context({ environment: { CLISBOT_HOME: "/srv/clisbot" } }).home).toBe("/srv/clisbot");
    expect(context({}).home).toBe("/Users/tester/.paseo");
  });

  test("--home wins over the environment and is made absolute", () => {
    expect(
      context({ options: { home: "./fusion-home" }, environment: { PASEO_HOME: "/srv/paseo" } })
        .home,
    ).toBe(path.resolve("fusion-home"));
  });

  test("labels default to sh.paseo and reject a malformed prefix", () => {
    expect(context({}).labelPrefix).toBe("sh.paseo");
    expect(() => context({ options: { labelPrefix: "bad prefix" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_LABEL_PREFIX" }),
    );
  });

  test("targets default to both and reject an unknown name", () => {
    expect(context({}).targets).toEqual(["daemon", "hub"]);
    expect(parseTargetNames(["hub", "hub", "daemon"])).toEqual(["hub", "daemon"]);
    expect(() => parseTargetNames(["worker"])).toThrowError(
      expect.objectContaining({ code: "INVALID_TARGET" }),
    );
  });

  test("--env needs KEY=VALUE and rejects a bad name", () => {
    expect(parseEnvOptions(["A=1", "B=x=y"])).toEqual({ A: "1", B: "x=y" });
    expect(() => parseEnvOptions(["NOVALUE"])).toThrowError(
      expect.objectContaining({ code: "INVALID_ENV" }),
    );
    expect(() => parseEnvOptions(["1BAD=1"])).toThrowError(
      expect.objectContaining({ code: "INVALID_ENV" }),
    );
  });
});

describe("autostart targets", () => {
  test("a non-macOS host is refused", () => {
    const linux = context({ platform: "linux" });
    expect(() => resolveAutostartTargets(linux)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_PLATFORM" }),
    );
  });

  test("the daemon target carries argv, home environment, PATH, and logs", () => {
    const withListen = context({
      options: { home: "/srv/fusion", labelPrefix: "ai.clisbot.fusion", listen: "127.0.0.1:6770" },
      environment: { PATH: "/Users/tester/.local/bin:/usr/bin", PASEO_HOME: "/srv/ignored" },
    });
    const [daemon] = resolveAutostartTargets(withListen);

    expect(daemon?.label).toBe("ai.clisbot.fusion.daemon");
    expect(daemon?.argv).toEqual([
      "/Users/tester/.nvm/bin/node",
      "/opt/paseo/bin/paseo",
      "daemon",
      "start",
      "--foreground",
    ]);
    expect(daemon?.environment.PASEO_HOME).toBe("/srv/fusion");
    expect(daemon?.environment.CLISBOT_HOME).toBe("/srv/fusion");
    expect(daemon?.environment.PASEO_LISTEN).toBe("127.0.0.1:6770");
    expect(daemon?.environment.HOME).toBe("/Users/tester");
    // launchd's own PATH first, then the installing one, then the system defaults.
    expect(daemon?.environment.PATH?.split(":").slice(0, 4)).toEqual([
      "/Users/tester/.nvm/bin",
      "/Users/tester/.local/bin",
      "/usr/bin",
      "/opt/homebrew/bin",
    ]);
    expect(daemon?.standardOutPath).toBe("/srv/fusion/state/launchd/daemon.out.log");
  });

  test("the hub target runs the hub verb, pins the recorded port, and takes --env overrides", () => {
    const hubContext = context({
      options: { home: "/srv/fusion", target: ["hub"], env: ["CLISBOT_HUB_CHANNELS_ENABLED=1"] },
      hubPort: 6869,
    });
    const targets = resolveAutostartTargets(hubContext);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.label).toBe("sh.paseo.hub");
    expect(targets[0]?.argv.slice(2)).toEqual(["hub", "start", "--foreground", "--port", "6869"]);
    expect(targets[0]?.environment.CLISBOT_HUB_CHANNELS_ENABLED).toBe("1");
    expect(targets[0]?.workingDirectory).toBe("/srv/fusion");
    expect(targets[0]?.standardErrorPath).toBe("/srv/fusion/state/launchd/hub.err.log");
  });

  test("a hub with no recorded port keeps the Hub's own default", () => {
    const targets = resolveAutostartTargets(context({ options: { target: ["hub"] } }));
    expect(targets[0]?.argv.slice(2)).toEqual(["hub", "start", "--foreground"]);
  });
});
