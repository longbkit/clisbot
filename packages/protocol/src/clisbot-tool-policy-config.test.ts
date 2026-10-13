import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderClisbotToolsPolicySchema } from "./provider-config.js";

describe("provider Clisbot-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderClisbotToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderClisbotToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).clisbotTools).toBeUndefined();
  });

  test("accepts clisbotTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        clisbotTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).clisbotTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts clisbotTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            clisbotTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.clisbotTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            clisbotTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.clisbotTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
