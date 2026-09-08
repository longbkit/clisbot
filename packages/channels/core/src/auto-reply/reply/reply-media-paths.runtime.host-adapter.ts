// Fusion-owned host adapter for `src/auto-reply/reply/reply-media-paths.runtime.ts` (D-CORE-052).
//
// Upstream lazily loads the workspace media stager that copies agent-workspace
// files into OpenClaw's media store before a send. Fusion stages media through the
// Hub's own outbound media evaluation, and this path is only reached from the
// internal source-reply sink, which Fusion never selects.
export function createReplyMediaPathNormalizer(
  _params: unknown,
): (payload: unknown) => Promise<never> {
  return async () => {
    throw new Error("Workspace media staging is not available in Fusion.");
  };
}
