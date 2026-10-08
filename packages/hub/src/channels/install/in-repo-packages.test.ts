import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { channelNodeModulesDir, resolveInRepoPackageDir } from "./in-repo-packages.js";
import { loadChannelPins } from "./pins.js";

const PINS_PATH = fileURLToPath(new URL("../../../channel-pins.json", import.meta.url));
const HUB_PACKAGE = fileURLToPath(new URL("../../../package.json", import.meta.url));
// The loader admits these alongside every vertical (load-channel.ts).
const CONTRACT_PACKAGES = [
  "@clisbot/channels-shared",
  "@clisbot/channels-core",
  "@clisbot/channels-markdown-core",
];

function inRepoPackages(): string[] {
  const pins = loadChannelPins(PINS_PATH);
  return Object.values(pins.channels).flatMap((pin) =>
    pin.loadMode === "in-repo" && pin.inRepoPackage ? [pin.inRepoPackage] : [],
  );
}

describe("in-repo channel packages ship with the Hub", () => {
  // Packaged Hubs (npm, Docker, desktop app.asar) install only `dependencies`. A
  // channel listed elsewhere works in the repo and is missing from the release.
  it("lists every in-repo channel and contract package in Hub dependencies", () => {
    const hub = JSON.parse(readFileSync(HUB_PACKAGE, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const listed = Object.keys(hub.dependencies ?? {});
    const expected = [...inRepoPackages(), ...CONTRACT_PACKAGES];
    expect(expected.length).toBeGreaterThan(CONTRACT_PACKAGES.length);
    expect(expected.filter((name) => !listed.includes(name))).toEqual([]);
  });

  it("resolves every in-repo package through the Hub's module resolution", () => {
    for (const name of [...inRepoPackages(), ...CONTRACT_PACKAGES]) {
      expect(existsSync(join(resolveInRepoPackageDir(name), "package.json")), name).toBe(true);
    }
  });

  it("finds the node_modules dir the channel packages are installed into", () => {
    const dir = channelNodeModulesDir("@clisbot/channels-shared");
    expect(existsSync(join(dir, "@clisbot", "channels-shared", "package.json"))).toBe(true);
  });

  it("names the Hub dependencies when a channel package is not installed", () => {
    expect(() => resolveInRepoPackageDir("@clisbot/channels-not-a-channel")).toThrow(
      /@clisbot\/hub dependencies/u,
    );
  });
});
