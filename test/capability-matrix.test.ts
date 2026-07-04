import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_PROVIDERS } from "../src/runners/catalog/index.ts";
import {
  describeProviderBackendSupport,
  renderCapabilityMatrixMarkdown,
} from "../src/runners/catalog/capability-table.ts";

describe("provider capability matrix", () => {
  test("committed capability-matrix.md matches the catalog (run bun run docs:capability-matrix after catalog changes)", () => {
    const committed = readFileSync(
      join(import.meta.dir, "..", "docs", "features", "runners", "capability-matrix.md"),
      "utf8",
    );
    expect(committed).toBe(renderCapabilityMatrixMarkdown());
  });

  test("every provider supports tmux and declares truthful acp support", () => {
    for (const provider of Object.values(CLI_PROVIDERS)) {
      const tmux = describeProviderBackendSupport(provider, "tmux");
      expect(tmux.supported).toBe(true);
      expect(tmux.capabilities?.steer).toBe(true);

      const acp = describeProviderBackendSupport(provider, "acp");
      expect(acp.supported).toBe(Boolean(provider.acp));
      if (provider.acp) {
        expect(acp.capabilities?.steer).toBe(false);
        expect(acp.capabilities?.structuredEvents).toBe(true);
        expect(acp.capabilities?.resume).toBe(provider.acp.expectations.loadSession);
      }
    }
  });

  test("acp presets pin exact adapter versions", () => {
    for (const provider of Object.values(CLI_PROVIDERS)) {
      if (!provider.acp) {
        continue;
      }
      expect(provider.acp.adapterPin.length).toBeGreaterThan(0);
      // npm-published adapters must pin an exact version in the launch args.
      const npmLaunchArg = provider.acp.launch.args.find((arg) => arg.includes("@agentclientprotocol/"));
      if (npmLaunchArg) {
        expect(npmLaunchArg).toMatch(/@\d+\.\d+\.\d+$/);
      }
    }
  });
});
