// Fusion-owned host adapter for `src/infra/outbound/outbound-policy.ts` (D-CORE-038).
//
// Upstream reads `tools.message.*` out of OpenClaw's per-agent config: which
// actions an agent may run, whether broadcast is enabled, and whether a message
// may leave the conversation it came from (cross-context egress + its decoration
// marker). Fusion expresses the same authority as Hub grants issued with the
// reply capability, checked before the tool is ever reachable, so these hooks are
// inert here rather than duplicating policy in two places (continues D-CORE-017).
import type { ChannelMessageActionName } from "../../channels/plugins/types.public.js";
import type { MessagePresentation } from "../../interactive/payload.js";

export type EffectiveMessageToolsConfig = {
  broadcast?: { enabled?: boolean };
  actions?: readonly ChannelMessageActionName[];
};

export function resolveEffectiveMessageToolsConfig(_params: {
  cfg: unknown;
  agentId?: string | null;
}): EffectiveMessageToolsConfig | undefined {
  return undefined;
}

/** Hub grants decide the allowlist; core does not re-check it. */
export function enforceMessageActionAllowlist(_params: {
  cfg: unknown;
  agentId?: string | null;
  action: ChannelMessageActionName;
}): void {}

/** Hub grants bind one conversation, so there is no cross-context egress to police. */
export function enforceCrossContextPolicy(_params: {
  channel: string;
  action: ChannelMessageActionName;
  args: Record<string, unknown>;
  toolContext?: unknown;
  cfg: unknown;
  agentId?: string | null;
}): void {}

export type CrossContextDecoration = {
  prefix: string;
  suffix: string;
  presentationBuilder?: (params: { message: string }) => MessagePresentation | undefined;
};

/** Upstream marks cross-conversation sends; Fusion's capability never crosses one. */
export function shouldApplyCrossContextMarker(_action: ChannelMessageActionName): boolean {
  return false;
}

export function buildCrossContextDecoration(_params: unknown): CrossContextDecoration | undefined {
  return undefined;
}

export function applyCrossContextDecoration(params: {
  message: string;
  decoration: CrossContextDecoration;
  preferPresentation: boolean;
}): {
  message: string;
  presentation?: MessagePresentation;
  usedPresentation: boolean;
} {
  return { message: params.message, usedPresentation: false };
}
