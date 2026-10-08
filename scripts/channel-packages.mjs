import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every vertical builds against these, so they build first, in this order.
const CONTRACT_PACKAGES = ["markdown-core", "core", "shared"];

/**
 * The channel workspaces under `packages/channels/`, in build order: the contract packages, then
 * every vertical the Hub loads from its own packages (`loadMode: "in-repo"` in
 * `packages/hub/channel-pins.json`). A channel added to the pins is built and packed with no
 * second list to keep in step.
 */
export function channelPackageDirs() {
  const pins = JSON.parse(readFileSync(path.join(root, "packages/hub/channel-pins.json"), "utf8"));
  const verticals = Object.values(pins.channels)
    .filter((pin) => pin.loadMode === "in-repo")
    .map((pin) => pin.inRepoPackage.replace(/^@clisbot\/channels-/u, ""));
  return [...CONTRACT_PACKAGES, ...verticals].map((name) => `packages/channels/${name}`);
}
