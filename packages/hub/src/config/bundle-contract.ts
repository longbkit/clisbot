export const HUB_RESOURCE_PATH = ".clisbot/hub.yml";
export const WORKFLOW_DIRECTORY = ".clisbot/workflows";
export const WORKFLOW_PARTIAL_DIRECTORY = `${WORKFLOW_DIRECTORY}/partials`;
// COMPAT(clisbot-channels): fork-owned Channel configuration revision layout
// (implementation doc §4.3). A revision lives only in the Hub database, never in
// a repository, so its keys name no directory and no product: `hub.yml` for the
// agents and environments its Routes use, `channels/policy.yml`, and one account
// file per bot at `channels/<channel>/<accountId>.yml`.
export const CHANNEL_RESOURCE_PATH = "hub.yml";
export const CHANNELS_DIRECTORY = "channels";
export const CHANNEL_POLICY_PATH = `${CHANNELS_DIRECTORY}/policy.yml`;

export interface HubBundleFile {
  path: string;
  content: string;
}

export function compareBundlePaths(
  left: Pick<HubBundleFile, "path">,
  right: Pick<HubBundleFile, "path">,
): number {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}
