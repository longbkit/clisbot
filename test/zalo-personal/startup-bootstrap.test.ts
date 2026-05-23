import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeZaloPersonalAuthSession } from "../../src/channels/zalo-personal/session-file.ts";
import { filterZaloPersonalBootstrapBotsNeedingLogin } from "../../src/control/commands/zalo-personal-bootstrap-cli.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";

function createConfig(tempDir: string) {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.zaloPersonal.defaults.enabled = true;
  config.bots.zaloPersonal.default.enabled = true;
  config.bots.zaloPersonal.default.tokenFile = join(tempDir, "default-session");
  config.bots.zaloPersonal.work = {
    enabled: true,
    credentialType: "tokenFile",
    tokenFile: join(tempDir, "work-session"),
  } as typeof config.bots.zaloPersonal.default;
  return config;
}

describe("zalo-personal startup bootstrap", () => {
  test("skips QR relogin when the selected bot already has a valid session file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-startup-"));
    try {
      const config = createConfig(tempDir);
      await writeZaloPersonalAuthSession(config.bots.zaloPersonal.default.tokenFile as string, {
        version: 1,
        cookie: [{ name: "zpsid", value: "cookie" }],
        imei: "imei-1",
        userAgent: "test-agent",
        savedAt: "2026-05-17T00:00:00.000Z",
      });
      writeFileSync(config.bots.zaloPersonal.work.tokenFile as string, "{}\n");

      const pending = await filterZaloPersonalBootstrapBotsNeedingLogin(config, [
        { botId: "default", qrPath: "./default.png" },
        { botId: "work", qrPath: "./work.png" },
      ]);

      expect(pending).toEqual([
        { botId: "work", qrPath: "./work.png" },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
