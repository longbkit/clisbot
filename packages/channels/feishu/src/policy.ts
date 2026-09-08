// upstream: extensions/feishu/src/policy.ts@5d8067a4483 (partial, D-FS-010)
//
// The three `resolveFeishu*IngressAccess` resolvers and their
// `defineStableChannelIngressIdentity` identity, `createFeishuIngressResolver`
// and `createFeishuIngressSubject` helpers are omitted: they run OpenClaw's
// `channel-ingress-runtime` (the `src/channels/message-access` allowlist/
// admission subsystem), and in Fusion the Hub owns inbound admission, DM/group
// policy and allowlists (goal ledger slice 23). Everything the ported read
// policy and reply policy need is kept, line for line.
// Feishu plugin module implements policy behavior.
import {
  normalizeAccountId,
  resolveMergedAccountConfig,
} from "@getpaseo/channels-core/plugin-sdk/account-resolution";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/core";
import { normalizeOptionalLowercaseString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import type { ChannelGroupContext } from "./fusion/runtime-api.js";
import { detectIdType } from "./targets.js";
import type { FeishuConfig } from "./types.js";

type FeishuDmPolicy = "open" | "pairing" | "allowlist" | "disabled";
type FeishuGroupPolicy = "open" | "allowlist" | "disabled" | "allowall";
type NormalizedFeishuGroupPolicy = Exclude<FeishuGroupPolicy, "allowall">;

const FEISHU_PROVIDER_PREFIX_RE = /^(feishu|lark):/i;
const FEISHU_TYPED_PREFIX_RE = /^(chat|group|channel|user|dm|open_id):/i;
const FEISHU_ID_KIND = "plugin:feishu-id" as const;

export function normalizeFeishuAllowEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "*") {
    return "*";
  }

  let withoutProviderPrefix = trimmed;
  while (FEISHU_PROVIDER_PREFIX_RE.test(withoutProviderPrefix)) {
    withoutProviderPrefix = withoutProviderPrefix.replace(FEISHU_PROVIDER_PREFIX_RE, "").trim();
  }
  if (withoutProviderPrefix === "*") {
    return "*";
  }
  const lowered = normalizeOptionalLowercaseString(withoutProviderPrefix) ?? "";
  if (!lowered) {
    return "";
  }
  const prefixed = lowered.match(FEISHU_TYPED_PREFIX_RE);
  if (prefixed?.[1]) {
    const kind = ["chat", "group", "channel"].includes(prefixed[1]) ? "chat" : "user";
    const value = withoutProviderPrefix.slice(prefixed[0].length).trim();
    return value === "*" ? "*" : value ? `${kind}:${value}` : "";
  }

  const detectedType = detectIdType(withoutProviderPrefix);
  if (detectedType === "chat_id") {
    return `chat:${withoutProviderPrefix}`;
  }
  if (detectedType === "open_id" || detectedType === "user_id") {
    return `user:${withoutProviderPrefix}`;
  }

  return "";
}

function normalizeFeishuDmPolicy(policy: string | null | undefined): FeishuDmPolicy {
  return policy === "open" ||
    policy === "pairing" ||
    policy === "allowlist" ||
    policy === "disabled"
    ? policy
    : "pairing";
}

function normalizeFeishuGroupPolicy(policy: FeishuGroupPolicy): NormalizedFeishuGroupPolicy {
  return policy === "allowall" ? "open" : policy;
}

function resolveFeishuExplicitGroupConfigKey(params: {
  cfg?: FeishuConfig;
  groupId?: string | null;
}): string | undefined {
  const groups = params.cfg?.groups ?? {};
  const groupId = params.groupId?.trim();
  if (!groupId || groupId === "*") {
    return undefined;
  }
  if (Object.hasOwn(groups, groupId)) {
    return groupId;
  }
  const lowered = normalizeOptionalLowercaseString(groupId) ?? "";
  return Object.keys(groups).find(
    (key) => key !== "*" && normalizeOptionalLowercaseString(key) === lowered,
  );
}

export function resolveFeishuGroupConfig(params: { cfg?: FeishuConfig; groupId?: string | null }) {
  if (!params.groupId?.trim()) {
    return undefined;
  }
  const groups = params.cfg?.groups ?? {};
  const key = resolveFeishuExplicitGroupConfigKey(params);
  return key ? groups[key] : groups["*"];
}

export function hasExplicitFeishuGroupConfig(params: {
  cfg?: FeishuConfig;
  groupId?: string | null;
}): boolean {
  return resolveFeishuExplicitGroupConfigKey(params) !== undefined;
}

export function resolveFeishuGroupToolPolicy(params: ChannelGroupContext) {
  // This adapter intentionally reads root channels.feishu without account merge;
  // reply mention policy merges accounts, and changing that asymmetry is product behavior.
  return resolveFeishuGroupConfig({
    cfg: params.cfg.channels?.feishu,
    groupId: params.groupId,
  })?.tools;
}

export function resolveFeishuReplyPolicy(params: {
  isDirectMessage: boolean;
  cfg: OpenClawConfig;
  accountId?: string | null;
  groupId?: string | null;
  /**
   * Effective group policy resolved for this chat. When "open", requireMention
   * defaults to false so that non-text messages (e.g. images) that cannot carry
   * @-mentions are still delivered to the agent.
   */
  groupPolicy?: "open" | "allowlist" | "disabled" | "allowall";
}): { requireMention: boolean } {
  if (params.isDirectMessage) {
    return { requireMention: false };
  }

  const feishuCfg = params.cfg.channels?.feishu;
  const resolvedCfg = resolveMergedAccountConfig<FeishuConfig>({
    channelConfig: feishuCfg,
    accounts: feishuCfg?.accounts as Record<string, Partial<FeishuConfig>> | undefined,
    accountId: normalizeAccountId(params.accountId),
    normalizeAccountId,
    omitKeys: ["defaultAccount"],
  });
  const groupRequireMention = resolveFeishuGroupConfig({
    cfg: resolvedCfg,
    groupId: params.groupId,
  })?.requireMention;

  return {
    requireMention:
      typeof groupRequireMention === "boolean"
        ? groupRequireMention
        : typeof resolvedCfg.requireMention === "boolean"
          ? resolvedCfg.requireMention
          : params.groupPolicy !== "open",
  };
}
