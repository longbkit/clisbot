// Fusion-owned host adapter for `src/infra/outbound/target-resolver.ts` (D-CORE-033).
//
// Upstream resolves a free-text destination ("#general", "@alice", a saved
// contact) against the provider directory, the plugin's target normalizer and
// OpenClaw's contact cache. Fusion's channel reply capability is bound to one
// conversation the Hub already resolved, so the default resolver is the identity
// on an already-canonical id. A host may install a real directory resolver.
import type { ChannelPlugin, OpenClawConfig } from "../../channels/plugins/types.public.js";

export type ResolvedMessagingTarget = {
  to: string;
  kind?: "user" | "group" | "channel" | "conversation";
  label?: string;
  accountId?: string | null;
};

export type ResolveChannelTargetParams = {
  cfg: OpenClawConfig;
  channel: string;
  input: string;
  accountId?: string;
  preferredKind?: "group" | "user" | "channel";
  plugin?: ChannelPlugin;
};

export type ResolveChannelTargetResult =
  | { ok: true; target: ResolvedMessagingTarget }
  | { ok: false; error: Error };

export type ChannelTargetResolver = (
  params: ResolveChannelTargetParams,
) => Promise<ResolveChannelTargetResult>;

const identityResolver: ChannelTargetResolver = async (params) => {
  const to = params.input.trim();
  return to
    ? { ok: true, target: { to, ...(params.preferredKind ? { kind: params.preferredKind } : {}) } }
    : { ok: false, error: new Error(`Empty ${params.channel} target.`) };
};

let resolver: ChannelTargetResolver = identityResolver;

/** Installs a directory-backed resolver; the default treats input as canonical. */
export function setChannelTargetResolver(next: ChannelTargetResolver | undefined): void {
  resolver = next ?? identityResolver;
}

export async function resolveChannelTarget(
  params: ResolveChannelTargetParams,
): Promise<ResolveChannelTargetResult> {
  return await resolver(params);
}
