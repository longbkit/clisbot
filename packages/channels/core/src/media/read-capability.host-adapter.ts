// Fusion-owned host adapter for `src/media/read-capability.ts` (D-CORE-054).
//
// Upstream builds an outbound media grant from OpenClaw's per-agent, per-sender
// and per-channel media policy: which local roots may be read, which reader to
// use, and the workspace directory. Fusion's Hub already decided the file scope
// (the reply capability's Project root, checked in the Hub's media stager),
// so the default grant is "no extra local roots, no reader" and the caller's
// explicit `mediaAccess`/`workspaceMediaAccess` wins wherever it is supplied.
import type { OutboundMediaAccess } from "./load-options.js";

export function resolveAgentScopedOutboundMediaAccess(params: {
  workspaceMediaAccess?: OutboundMediaAccess;
  workspaceDir?: string;
  [key: string]: unknown;
}): OutboundMediaAccess {
  if (params.workspaceMediaAccess) {
    return params.workspaceMediaAccess;
  }
  return {
    ...(params.workspaceDir === undefined ? {} : { workspaceDir: params.workspaceDir }),
  } as OutboundMediaAccess;
}
