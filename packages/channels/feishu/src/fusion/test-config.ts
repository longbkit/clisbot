// Shared test config builder for this package's targeted tests. Not production
// code: it only spells the `cfg.channels.feishu` shape the Hub compiles, so a
// test drives the ported account resolver instead of stubbing it.
import type { OpenClawConfig } from "./runtime-api.js";

export function buildFeishuTestConfig(
  overrides: Record<string, unknown> = {},
): OpenClawConfig {
  return {
    channels: {
      feishu: {
        enabled: true,
        appId: "cli_test_app",
        appSecret: "test-secret",
        domain: "feishu",
        ...overrides,
      },
    },
  } as unknown as OpenClawConfig;
}
