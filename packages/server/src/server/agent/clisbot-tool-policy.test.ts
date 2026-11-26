import { describe, expect, test } from "vitest";
import type { ProviderClisbotToolsPolicy } from "@clisbot/protocol/provider-config";

import { isClisbotToolEnabled, resolveClisbotToolPolicy } from "./clisbot-tool-policy.js";

describe("Clisbot tool policy", () => {
  test("defaults to all Clisbot tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderClisbotToolsPolicy;

    expect(
      resolveClisbotToolPolicy("custom-claude", {
        claude: { clisbotTools: { enabled: false } },
        "custom-claude": { clisbotTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(
      resolveClisbotToolPolicy("other-custom", { claude: { clisbotTools: customPolicy } }),
    ).toBe(undefined);
    expect(isClisbotToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isClisbotToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isClisbotToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isClisbotToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isClisbotToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
