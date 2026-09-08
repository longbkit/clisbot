// Fusion-owned host adapter for `src/channels/plugins/message-tool-api.ts` (D-CORE-012).
//
// Upstream resolves a bundled plugin's `message-tool-api.js` artifact from the
// OpenClaw node install layout (`src/plugins/public-surface-loader.ts`). Fusion
// has no bundled-plugin directory: channel verticals are in-repo packages that
// register through `setChannelMessageToolPlugins`. The loader therefore reports
// "no bundled artifact" and discovery falls back to the registered plugin.

/** Always reports a missing bundled public surface, matching upstream's optional-artifact path. */
export function loadBundledPluginPublicArtifactModuleSync<T>(params: {
  dirName: string;
  artifactBasename: string;
}): T | undefined {
  void params;
  return undefined;
}
