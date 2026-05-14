import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../src/config/core/config-file.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { resolveConfigTimezone } from "../src/config/runtime/timezone.ts";
import { runTimezoneCli } from "../src/control/commands/timezone-cli.ts";

describe("timezone cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("sets, gets, and clears app timezone", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-timezone-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);

    const output: string[] = [];
    console.log = ((value?: unknown) => {
      output.push(String(value ?? ""));
    }) as typeof console.log;

    await runTimezoneCli(["set", "Asia/Ho_Chi_Minh"]);
    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH, "utf8"));
    expect(rawConfig.app.timezone).toBe("Asia/Ho_Chi_Minh");

    output.length = 0;
    await runTimezoneCli(["get"]);
    expect(output.join("\n")).toContain("app.timezone: Asia/Ho_Chi_Minh");
    expect(output.join("\n")).toContain("effective: Asia/Ho_Chi_Minh (app)");

    await runTimezoneCli(["clear"]);
    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH, "utf8"));
    expect(rawConfig.app.timezone).toBeUndefined();
  });

  test("resolves agent timezone before concrete bot fallback", () => {
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.app.timezone = "Asia/Ho_Chi_Minh";
    config.agents.list = [{ id: "support-us", timezone: "America/New_York" }];
    config.bots.telegram.default.timezone = "America/Los_Angeles";

    expect(
      resolveConfigTimezone({
        config,
        agentId: "support-us",
        botTimezone: config.bots.telegram.default.timezone,
      }),
    ).toEqual({
      timezone: "America/New_York",
      source: "agent",
    });

    expect(
      resolveConfigTimezone({
        config,
        agentId: "support-us",
        routeTimezone: "Asia/Singapore",
        botTimezone: config.bots.telegram.default.timezone,
      }),
    ).toEqual({
      timezone: "Asia/Singapore",
      source: "route",
    });
  });

  test("help keeps route timezone guidance generic across channels", async () => {
    const output: string[] = [];
    console.log = ((value?: unknown) => {
      output.push(String(value ?? ""));
    }) as typeof console.log;

    await runTimezoneCli(["--help"]);

    expect(output.join("\n")).toContain(
      "use route timezone when one routed surface needs different wall-clock time",
    );
    expect(output.join("\n")).not.toContain("Slack/Telegram surface");
  });
});
