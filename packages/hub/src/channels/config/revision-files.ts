// The files of one Channel configuration revision: which keys a revision may
// hold, how its `hub.yml` reaches the shared Hub compiler, and the canonical
// order and hash a stored revision carries.

import { createHash } from "node:crypto";
import { compileHubBundle, type CompiledHubBundle } from "../../config/bundle.js";
import {
  CHANNEL_POLICY_PATH,
  CHANNEL_RESOURCE_PATH,
  CHANNELS_DIRECTORY,
  HUB_RESOURCE_PATH,
  type HubBundleFile,
} from "../../config/bundle-contract.js";
import { issue } from "./compile-support.js";

const EMPTY_CHANNEL_RESOURCE = "environments: {}\nagents: {}\n";

/** Rejects a key outside the revision layout in `bundle-contract.ts`. */
export function validateChannelRevisionPaths(files: readonly HubBundleFile[]): void {
  for (const { path } of files) {
    if (path === CHANNEL_RESOURCE_PATH || path === CHANNEL_POLICY_PATH) continue;
    const segments = path.split("/");
    const isAccountFile =
      segments.length === 3 &&
      segments[0] === CHANNELS_DIRECTORY &&
      segments[1] !== "" &&
      segments[2]!.endsWith(".yml");
    if (!isAccountFile) {
      issue(
        [path],
        `Channel configuration files are ${CHANNEL_RESOURCE_PATH}, ${CHANNEL_POLICY_PATH}, or ${CHANNELS_DIRECTORY}/<channel>/<accountId>.yml`,
      );
    }
  }
}

/** The agents and environments a revision's Routes may name. The shared Hub
 * compiler reads them from its repository resource path, so the revision's
 * `hub.yml` is handed over under that path; nothing is stored under it. */
export function compileChannelResource(
  files: readonly HubBundleFile[],
  emptyResource = EMPTY_CHANNEL_RESOURCE,
): CompiledHubBundle {
  const resource = files.find(({ path }) => path === CHANNEL_RESOURCE_PATH);
  return compileHubBundle(
    [{ path: HUB_RESOURCE_PATH, content: resource?.content ?? emptyResource }],
    { requireWorkflow: false },
  );
}

/** The order and content hash a stored revision carries. */
export function canonicalChannelRevision(files: readonly HubBundleFile[]): {
  files: HubBundleFile[];
  contentHash: string;
} {
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: canonical,
    contentHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
