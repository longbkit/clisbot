import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CHANNEL_BOT_CONTRACTS,
  CHANNEL_CONFIG_TARGET_CONTRACTS,
  CHANNEL_CREDENTIAL_CONTRACTS,
  CHANNEL_INSTALLATIONS,
  CHANNEL_PAIRING_ACCESS_CONTRACTS,
  CHANNEL_ROUTE_CONTRACTS,
  CHANNEL_SURFACE_CONTRACTS,
  CHANNEL_TEMPLATE_CONTRACTS,
} from "../src/channels/integration/channel-installation-inventory.ts";
import { CHANNEL_PLUGINS, listChannelPlugins } from "../src/channels/catalog/registry.ts";

const repoRoot = join(import.meta.dir, "..");
const channelsDir = join(repoRoot, "src", "channels");

function listBuiltInChannelDirectories() {
  return readdirSync(channelsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(channelsDir, entry.name, "plugin.ts")))
    .map((entry) => entry.name)
    .sort();
}

function joinChannels(values: readonly { channel: string }[]) {
  return values.map((value) => value.channel).join(",");
}

function joinCredentialChannels() {
  return listBuiltInChannelDirectories()
    .filter((channel) => channel !== "zalo-personal")
    .join(",");
}

describe("channel installation inventory", () => {
  test("covers every built-in channel through one static installation seam", () => {
    const directories = listBuiltInChannelDirectories();
    const installationInventorySource = readFileSync(
      join(channelsDir, "integration", "channel-installation-inventory.ts"),
      "utf8",
    );

    expect(
      CHANNEL_INSTALLATIONS.map((installation) => installation.surfaceContract.channel).join(","),
    ).toBe(directories.join(","));
    for (const directory of directories) {
      expect(existsSync(join(channelsDir, directory, "installation.ts"))).toBe(true);
    }
    expect(installationInventorySource).not.toContain("plugin.ts");

    expect(CHANNEL_PLUGINS.map((plugin) => plugin.id).join(",")).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_SURFACE_CONTRACTS)).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_CONFIG_TARGET_CONTRACTS)).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_PAIRING_ACCESS_CONTRACTS)).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_CREDENTIAL_CONTRACTS)).toBe(joinCredentialChannels());
    expect(joinChannels(CHANNEL_BOT_CONTRACTS)).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_ROUTE_CONTRACTS)).toBe(directories.join(","));
    expect(joinChannels(CHANNEL_TEMPLATE_CONTRACTS)).toBe(directories.join(","));

    for (const contract of CHANNEL_PAIRING_ACCESS_CONTRACTS) {
      expect(typeof contract.normalizeApprovedPairingId).toBe("function");
    }
    for (const routeContract of CHANNEL_ROUTE_CONTRACTS) {
      const surfaceContract = CHANNEL_SURFACE_CONTRACTS.find(
        (contract) => contract.channel === routeContract.channel,
      );
      expect(surfaceContract?.supportsGroups).toBe(routeContract.supportsGroups);
      expect(surfaceContract?.supportsTopics).toBe(routeContract.supportsTopics);
    }

    expect(listChannelPlugins()).toHaveLength(directories.length);
    expect(new Set(listChannelPlugins().map((plugin) => plugin.id)).size).toBe(directories.length);
  });
});
