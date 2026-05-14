import { afterEach, describe, expect, test } from "bun:test";
import { restart } from "../src/control/commands/runtime-management-cli.ts";
import type { RuntimeStatus } from "../src/control/runtime/runtime-process.ts";

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
      sleep: async () => undefined,
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
      sleep: async () => undefined,
      warn: () => undefined,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("did not stop");
  });

  test("continues when stop first still looks running but settles to stopped during bounded recheck", async () => {
    const warnings: string[] = [];
    let statusReadCount = 0;

    await restart({
      stopDetachedRuntime: async () => {
        throw new Error("clisbot did not stop within 10000ms");
      },
      getRuntimeStatus: async () => createStatus((statusReadCount += 1) < 3),
      sleep: async () => undefined,
      warn: (message) => warnings.push(message),
    });

    expect(statusReadCount).toBe(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("status now shows the service is stopped");
  });
});
