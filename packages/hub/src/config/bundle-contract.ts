export const HUB_RESOURCE_PATH = ".paseo/hub.yml";
export const WORKFLOW_DIRECTORY = ".paseo/workflows";
export const WORKFLOW_PARTIAL_DIRECTORY = `${WORKFLOW_DIRECTORY}/partials`;

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
