import { describe, expect, test } from "bun:test";
import { listZaloPersonalBots } from "../../src/channels/zalo-personal/config.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";

function createConfig() {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.zaloPersonal.defaults.enabled = true;
  config.bots.zaloPersonal.default.enabled = true;
  return config.bots.zaloPersonal;
}

describe("zalo-personal config", () => {
  test("rejects enabled bots that share one auth session file", () => {
    const config = createConfig();
    config.work = {
      ...config.default,
      enabled: true,
      name: "work",
      tokenFile: (config.default as { tokenFile?: string }).tokenFile,
    } as typeof config.default;

    expect(() => listZaloPersonalBots(config)).toThrow(
      "each bot/account needs a separate tokenFile",
    );
  });
});
