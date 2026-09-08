// upstream: src/channels/plugins/media-limits.ts@5d8067a4483
// Fusion-owned boundary for `resolveChannelMediaMaxBytes` (D-ZU-022).
//
// Upstream's barrel `plugin-sdk/account-helpers` re-exports it;
// `@getpaseo/channels-core` deliberately omits that member (D-CORE-303, "the
// Hub owns media ceilings"). The ported `accounts.ts` and `tool.ts` still need
// the ACCOUNT-level ceiling, which is channel config and not a Hub policy, so
// the function is carried here with its upstream body and call shape. The
// agents-default fallback it reads (`cfg.agents.defaults.mediaMaxMb`) stays,
// because the Hub compiles the same config graph.
import type { OpenClawConfig } from "../runtime-api.js";

const MB = 1024 * 1024;

/** Resolves channel media limit bytes from account-specific config or agent defaults. */
export function resolveChannelMediaMaxBytes(params: {
  cfg: OpenClawConfig;
  // Channel-specific config lives under different keys; keep this helper generic
  // so shared plugin helpers don't need channel-id branching.
  resolveChannelLimitMb: (params: { cfg: OpenClawConfig; accountId: string }) => number | undefined;
  accountId?: string | null;
}): number | undefined {
  const accountId = (params.accountId ?? "").trim() || "default";
  const channelLimit = params.resolveChannelLimitMb({
    cfg: params.cfg,
    accountId,
  });
  if (channelLimit) {
    return channelLimit * MB;
  }
  if (params.cfg.agents?.defaults?.mediaMaxMb) {
    return params.cfg.agents.defaults.mediaMaxMb * MB;
  }
  return undefined;
}
