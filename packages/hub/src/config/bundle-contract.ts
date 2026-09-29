export const HUB_RESOURCE_PATH = ".clisbot/hub.yml";
export const WORKFLOW_DIRECTORY = ".clisbot/workflows";
export const WORKFLOW_PARTIAL_DIRECTORY = `${WORKFLOW_DIRECTORY}/partials`;
// COMPAT(clisbot-channels): fork-owned channel control-plane directory
// (implementation doc §4.3): `.clisbot/channels/policy.yml` + one account file per
// bot, `.clisbot/channels/<channel>/<accountId>.yml`. Compiled by the fork's
// channel pass; upstream compilation of hub.yml/workflows stays untouched.
export const CHANNELS_DIRECTORY = ".clisbot/channels";
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
