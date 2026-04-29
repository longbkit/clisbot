import { afterEach, describe, expect, test } from "bun:test";
import { restart } from "../src/control/runtime-management-cli.ts";
import type { RuntimeStatus } from "../src/control/runtime-process.ts";

const originalClisbotConfigPath = process.env.CLISBOT_CONFIG_PATH;

afterEach(() => {
  process.env.CLISBOT_CONFIG_PATH = originalClisbotConfigPath;
});

function createStatus(running: boolean): RuntimeStatus {
  return {
    running,
    configPath: "/tmp/clisbot.json",
    pidPath: "/tmp/clisbot.pid",
    logPath: "/tmp/clisbot.log",
    tmuxSocketPath: "/tmp/clisbot.sock",
    monitorStatePath: "/tmp/clisbot-monitor.json",
    serviceMode: "monitor",
  };
}

describe("restart", () => {
  test("continues to start when stop reports an error but status is stopped", async () => {
    const warnings: string[] = [];

    await restart({
      stopDetachedRuntime: async () => {
        throw new Error("clisbot did not stop within 10000ms");
      },
      getRuntimeStatus: async () => createStatus(false),
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("status now shows the service is stopped");
    expect(warnings[0]).toContain("continuing with start");
  });

  test("does not continue when stop fails and status still shows running", async () => {
    const error = await restart({
      stopDetachedRuntime: async () => {
        throw new Error("clisbot did not stop within 10000ms");
      },
      getRuntimeStatus: async () => createStatus(true),
      warn: () => undefined,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("did not stop");
  });
});
