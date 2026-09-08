// upstream: extensions/zalo/src/group-access.ts@5d8067a4483
// Zalo plugin module implements group access behavior.
import type { GroupPolicy } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveOpenProviderRuntimeGroupPolicy } from "@getpaseo/channels-core/plugin-sdk/runtime-group-policy";

const ZALO_ALLOW_FROM_PREFIX_RE = /^(zalo|zl):/i;

export function normalizeZaloAllowEntry(value: string): string {
  return value.trim().replace(ZALO_ALLOW_FROM_PREFIX_RE, "").trim().toLowerCase();
}

export function resolveZaloRuntimeGroupPolicy(params: {
  providerConfigPresent: boolean;
  groupPolicy?: GroupPolicy;
  defaultGroupPolicy?: GroupPolicy;
}): {
  groupPolicy: GroupPolicy;
  providerMissingFallbackApplied: boolean;
} {
  return resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: params.providerConfigPresent,
    groupPolicy: params.groupPolicy,
    defaultGroupPolicy: params.defaultGroupPolicy,
  });
}
