// The inheritance fold (§4.3.2/§4.3.6/§4.3.7): authored `defaults:` layers
// (org < account < route, most-specific last) folded into the one effective
// block every route carries, plus the approval-rule merge that follows the
// same layers. `compile.ts` owns the snapshot shape and the composition; this
// file owns what a leaf resolves to.

import {
  ORG_DEFAULTS,
  TOOL_ACTIVITY_FLOOR,
  type ApprovalRule,
  type ChannelDefaults,
} from "./schema.js";
import type { SyncProgress, SyncProgressGroup, SyncStreaming, SyncToolCalls } from "./schema.js";
import type {
  DmPolicy,
  GroupPolicy,
  OutboundPath,
  QuestionsMode,
  ToolActivityDetail,
  WhenThrottled,
} from "./enums.js";
import { issue } from "./compile-support.js";
import type { AgentControls } from "./agent-controls.js";
import { foldConversationDefaults, type EffectiveConversationDefaults } from "./conversation.js";

export interface EffectiveAccess {
  dmPolicy?: DmPolicy | undefined;
  groupPolicy?: GroupPolicy | undefined;
  allowFrom?: readonly (string | number)[] | undefined;
  groupAllowFrom?: readonly (string | number)[] | undefined;
  groupAllowFromFallbackToAllowFrom?: boolean | undefined;
  deniedReply?: string | undefined;
}

/** The conversation leaves (`whenBusy`, `context`, `batching`) come from
 * `EffectiveConversationDefaults`: each ABSENT until a layer authors it. */
export interface EffectiveDefaults extends EffectiveConversationDefaults {
  requireMention: boolean;
  followUp: { mode: "auto" | "mention-only"; ttlMinutes: number };
  bindingKey: "thread" | "channel" | "dm";
  replyAnchor: "default" | "thread";
  /** Workspace organization (`workspace.organize`). ABSENT — the floor — means
   * on, and keeps a revision authored before the knob existed compiling to the
   * block (and the `routeFingerprint`) it always had. */
  workspace?: { organize: boolean } | undefined;
  /** The reply-path toggle (E4/E6), folded like every other default leaf;
   * `template` stays null at the org floor (= the default injection block). */
  outbound: { path: OutboundPath; template: string | null };
  /** What the plane does with the non-message inbound families
   * (`plane/inbound-kinds.ts` owns the routing table; these are its knobs). */
  inbound: {
    reactionNotifications: "off" | "own" | "all";
    editNotifications: "off" | "all";
  };
  /**
   * The upstream sender-admission gate (`access:`). ABSENT is the floor and
   * means "not authored": the plane runs the RBAC gate alone, exactly as it
   * did before the knob existed. Present = the ported
   * `resolveDmGroupAccessWithLists` decision runs in front of the RBAC gate.
   */
  access?: EffectiveAccess | undefined;
  /** Default Agent controls over the Route's named agent (`agent-controls.ts`).
   * One block, taken whole from the most specific layer that authors it: a
   * model only means something beside the provider it was chosen under.
   * ABSENT when no layer authors it, so existing route fingerprints hold. */
  agentControls?: AgentControls | undefined;
  /** How an agent's question is answered (`QuestionsModeSchema`). ABSENT when
   * no layer authors it, so existing route fingerprints hold. */
  questions?: QuestionsMode | undefined;
  sync: {
    finalAnswers: boolean;
    /** The "the bot is working" group: the relayed progress line, the
     * provider's native typing status, and a temporary reaction on the
     * inbound marker. Folded per leaf; an authored bare boolean normalizes to
     * `progressMessage` only. */
    progress: {
      progressMessage: boolean;
      typingIndicator: boolean;
      /** Resolved: the reserved `"off"`, or the emoji name to react with. */
      messageReaction: string;
    };
    /** The tool-activity surface, as the fold leaves it. Read it through
     * `toolActivity()`, which applies `TOOL_ACTIVITY_FLOOR`. */
    toolCalls: EffectiveToolCalls;
    threadLink: "full" | "final-only" | "none";
    /** The live-draft surface for a running turn (`sync.streaming`). ABSENT is
     * the org floor and means off: nothing streams and the turn's answer is
     * one final post. The compiler omits the key unless a layer authored a
     * leaf, so every revision written before the knob existed compiles to the
     * defaults it always had. The leaves stay optional inside it too — the
     * vertical's own resolver (Slack `resolveSlackStreamingMode` /
     * `resolveSlackNativeStreaming`) owns the per-leaf default, which is how
     * an account authored for OpenClaw keeps upstream's semantics. */
    streaming?: SyncStreaming | undefined;
    /** The subagent (Task tool) relay knobs; off at the org floor. */
    subagents: {
      finalAnswers: boolean;
      progress: boolean;
      toolCalls: boolean;
    };
  };
}

/**
 * Fold the inheritance layers (`org < account < route`, most-specific last):
 * the most specific layer that sets a leaf wins — an account or route override
 * beats the layer below it — and `ORG_DEFAULTS` is the floor when no layer
 * sets the leaf (§4.3.7: "org defaults < account defaults < route
 * overrides").
 */
/** Reads one leaf across the layer chain, most-specific first. */
type LeafPicker = <T>(leaf: (layer: ChannelDefaults | undefined) => T | undefined) => T | undefined;

export function foldDefaults(layers: readonly (ChannelDefaults | undefined)[]): EffectiveDefaults {
  const pick: LeafPicker = (leaf) => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const value = leaf(layers[index]);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const floor = ORG_DEFAULTS;
  const outbound = {
    path: pick((layer) => layer?.outbound?.path) ?? floor.outbound.path,
    template: pick((layer) => layer?.outbound?.template) ?? floor.outbound.template,
  };
  return {
    requireMention:
      pick((layer) => layer?.interaction?.requireMention) ?? floor.interaction.requireMention,
    followUp: {
      mode: pick((layer) => layer?.interaction?.followUp?.mode) ?? floor.interaction.followUp.mode,
      ttlMinutes:
        pick((layer) => layer?.interaction?.followUp?.ttlMinutes) ??
        floor.interaction.followUp.ttlMinutes,
    },
    bindingKey: pick((layer) => layer?.binding?.key) ?? floor.binding.key,
    replyAnchor: pick((layer) => layer?.reply?.anchor) ?? floor.reply.anchor,
    ...optional("workspace", foldWorkspaceDefaults(pick)),
    outbound,
    inbound: {
      reactionNotifications:
        pick((layer) => layer?.inbound?.reactionNotifications) ??
        floor.inbound.reactionNotifications,
      editNotifications:
        pick((layer) => layer?.inbound?.editNotifications) ?? floor.inbound.editNotifications,
    },
    ...foldAccessDefaults(pick),
    ...optional(
      "agentControls",
      pick((layer) => layer?.agentControls),
    ),
    ...optional(
      "questions",
      pick((layer) => layer?.questions),
    ),
    ...foldConversationDefaults(pick),
    sync: toolPathSyncFold(outbound.path, foldSyncDefaults(pick, floor.sync)),
  };
}

/**
 * Fold the `access:` leaves. Like `sync.streaming`, the floor is ABSENCE: the
 * key is omitted unless some layer authored a leaf, so a revision written
 * before the knob existed keeps the admission behaviour it always had. Once
 * ANY leaf is authored the block exists and the ported upstream decision runs,
 * with upstream's own per-leaf defaults for the leaves nobody set.
 */
function foldAccessDefaults(pick: LeafPicker): { access?: EffectiveAccess } {
  const access: EffectiveAccess = {
    ...optional(
      "dmPolicy",
      pick((layer) => layer?.access?.dmPolicy),
    ),
    ...optional(
      "groupPolicy",
      pick((layer) => layer?.access?.groupPolicy),
    ),
    ...optional(
      "allowFrom",
      pick((layer) => layer?.access?.allowFrom),
    ),
    ...optional(
      "groupAllowFrom",
      pick((layer) => layer?.access?.groupAllowFrom),
    ),
    ...optional(
      "deniedReply",
      pick((layer) => layer?.access?.deniedReply),
    ),
    ...optional(
      "groupAllowFromFallbackToAllowFrom",
      pick((layer) => layer?.access?.groupAllowFromFallbackToAllowFrom),
    ),
  };
  return Object.keys(access).length === 0 ? {} : { access };
}

/** `{ [key]: value }` when the value is set, `{}` otherwise — the one spelling
 * the folds use under `exactOptionalPropertyTypes`. */
function optional<K extends string, T>(key: K, value: T | undefined): { [P in K]?: T } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: T };
}

/**
 * Normalize one authored `sync.progress` layer to leaves. A bare boolean is
 * the pre-group spelling and speaks about `progressMessage` ONLY — it never
 * mentioned the other two surfaces, so they stay unset and keep inheriting
 * from the layer below (an already-authored `progress: true` revision gains a
 * typing indicator from the floor, not from this leaf).
 */
function progressLeaf(layer: SyncProgress | undefined): SyncProgressGroup {
  if (layer === undefined) return {};
  if (typeof layer === "boolean") return { progressMessage: layer };
  return layer;
}

/** Fold the `sync` leaves (root + `subagents`) through the layer chain. */
function foldSyncDefaults(pick: LeafPicker, floor: (typeof ORG_DEFAULTS)["sync"]) {
  return {
    finalAnswers: pick((layer) => layer?.sync?.finalAnswers) ?? floor.finalAnswers,
    progress: foldProgressDefaults(pick, floor.progress),
    toolCalls: foldToolCallsDefaults(pick, floor.toolCalls),
    threadLink: pick((layer) => layer?.sync?.threadLink) ?? floor.threadLink,
    ...foldStreamingDefaults(pick),
    subagents: {
      finalAnswers:
        pick((layer) => layer?.sync?.subagents?.finalAnswers) ?? floor.subagents.finalAnswers,
      progress: pick((layer) => layer?.sync?.subagents?.progress) ?? floor.subagents.progress,
      toolCalls: pick((layer) => layer?.sync?.subagents?.toolCalls) ?? floor.subagents.toolCalls,
    },
  };
}

/**
 * Normalize one authored `sync.toolCalls` layer to leaves. A bare boolean is
 * the switch and speaks about nothing else, so the rendering leaves keep
 * inheriting. The OBJECT spelling is the "on" spelling: authoring any leaf of
 * it turns the surface on, which is why it carries no `enabled` key.
 */
function toolCallsLeaf(layer: SyncToolCalls | undefined): Partial<ToolActivityLeaves> {
  if (layer === undefined) return {};
  if (typeof layer === "boolean") return { enabled: layer };
  return { enabled: true, ...layer };
}

/**
 * `sync.toolCalls` as the fold leaves it. A bare boolean is the shape every
 * revision compiled to before the group existed, and is what the fold emits
 * whenever no layer authored a rendering leaf — so a Route that never touched
 * tool activity keeps the `routeFingerprint` it always had. The rendering
 * leaves stay ABSENT until authored, for the same reason; `toolActivity()`
 * applies their floor where they are read.
 */
export type EffectiveToolCalls = boolean | ToolActivityLeaves;

export interface ToolActivityLeaves {
  enabled: boolean;
  detail?: ToolActivityDetail | undefined;
  throttleSeconds?: number | undefined;
  whenThrottled?: WhenThrottled | undefined;
}

/** The tool-activity leaves with their floors applied: what the relay reads. */
export interface ToolActivitySettings {
  enabled: boolean;
  detail: ToolActivityDetail;
  /** Seconds between tool-START lines in one scope; 0 posts every one. */
  throttleSeconds: number;
  whenThrottled: WhenThrottled;
}

/** The tool-activity settings a Route runs with: authored leaves over the floor. */
export function toolActivity(leaves: EffectiveToolCalls): ToolActivitySettings {
  if (typeof leaves === "boolean") return { ...TOOL_ACTIVITY_FLOOR, enabled: leaves };
  return {
    enabled: leaves.enabled,
    detail: leaves.detail ?? TOOL_ACTIVITY_FLOOR.detail,
    throttleSeconds: leaves.throttleSeconds ?? TOOL_ACTIVITY_FLOOR.throttleSeconds,
    whenThrottled: leaves.whenThrottled ?? TOOL_ACTIVITY_FLOOR.whenThrottled,
  };
}

/** Fold the `sync.toolCalls` leaves; each one inherits on its own. */
function foldToolCallsDefaults(pick: LeafPicker, floor: boolean): EffectiveToolCalls {
  const leaf = <K extends keyof ToolActivityLeaves>(key: K) =>
    pick((layer) => toolCallsLeaf(layer?.sync?.toolCalls)[key]);
  const enabled = leaf("enabled") ?? floor;
  const rendering = {
    ...optional("detail", leaf("detail")),
    ...optional("throttleSeconds", leaf("throttleSeconds")),
    ...optional("whenThrottled", leaf("whenThrottled")),
  };
  return Object.keys(rendering).length === 0 ? enabled : { enabled, ...rendering };
}

/** Fold the three `sync.progress` leaves; each one inherits on its own. */
function foldProgressDefaults(
  pick: LeafPicker,
  floor: (typeof ORG_DEFAULTS)["sync"]["progress"],
): EffectiveDefaults["sync"]["progress"] {
  const leaf = <K extends keyof SyncProgressGroup>(key: K) =>
    pick((layer) => progressLeaf(layer?.sync?.progress)[key]);
  return {
    progressMessage: leaf("progressMessage") ?? floor.progressMessage,
    typingIndicator: leaf("typingIndicator") ?? floor.typingIndicator,
    messageReaction: leaf("messageReaction") ?? floor.messageReaction,
  };
}

/** Fold `workspace.organize`; unauthored at every layer stays `undefined`. */
function foldWorkspaceDefaults(pick: LeafPicker): { organize: boolean } | undefined {
  const organize = pick((layer) => layer?.workspace?.organize);
  return organize === undefined ? undefined : { organize };
}

/**
 * Fold the `sync.streaming` leaves. The floor is ABSENCE, not a value: the key
 * is omitted unless some layer authored a leaf, so an unauthored revision
 * compiles to the exact effective defaults it did before the knob existed.
 */
function foldStreamingDefaults(pick: LeafPicker): { streaming?: SyncStreaming } {
  const mode = pick((layer) => layer?.sync?.streaming?.mode);
  const nativeTransport = pick((layer) => layer?.sync?.streaming?.nativeTransport);
  if (mode === undefined && nativeTransport === undefined) return {};
  return {
    streaming: {
      ...(mode === undefined ? {} : { mode }),
      ...(nativeTransport === undefined ? {} : { nativeTransport }),
    },
  };
}

/**
 * The tool-path sync fold (E4/E6): when the effective `outbound.path` is
 * `tool`, the agent's user-visible answer leaves through the hub-attached
 * `message` MCP tool, so the route's relay knobs fold to all-off — the relay
 * must stay silent for tool-path turns (exactly-one outcome: the tool post is
 * the only user-visible answer). That includes `sync.subagents`: subagent
 * (Task tool) output relayed into the thread would be a second user-visible
 * answer on a tool turn. `threadLink` keeps its folded value — it has no
 * effect while the relay is silent and still applies if the path flips back
 * to `relay` on the next revision. `hybrid` keeps the relay's knobs: its text
 * is the answer and the tool only carries what text cannot.
 */
function toolPathSyncFold(
  path: OutboundPath,
  sync: EffectiveDefaults["sync"],
): EffectiveDefaults["sync"] {
  if (path !== "tool") return sync;
  // The draft streams the relay's answer text; on the tool path there is no
  // relayed answer to draft, so the key is dropped rather than set to `off`
  // (absence IS off, and an emitted key would claim the route authored one).
  const withoutStreaming: EffectiveDefaults["sync"] = { ...sync };
  delete withoutStreaming.streaming;
  return {
    ...withoutStreaming,
    finalAnswers: false,
    // Only the relayed TEXT leaf goes quiet. The typing indicator and the
    // reaction are not posts — they are the liveness signal, and a tool-path
    // turn has less visible text than a relay turn, so folding them off would
    // remove the only sign of work. The group shape is what makes this
    // distinction expressible; the old single boolean could not.
    progress: { ...sync.progress, progressMessage: false },
    toolCalls: toolCallsOff(sync.toolCalls),
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  };
}

/** The same tool-activity leaves with the switch off — the shape is kept so a
 * tool-path Route's fingerprint changes only by the switch. */
function toolCallsOff(leaves: EffectiveToolCalls): EffectiveToolCalls {
  return typeof leaves === "boolean" ? false : { ...leaves, enabled: false };
}

/** Approval rules merge by prepending: the most specific layer matches first.
 * An exact-duplicate rule (same match + mode + initiatorOnly) in a specific
 * layer shadows the identical rule below it and is not added again — the doc
 * examples restate org rules in the account file "so the file reads as a
 * full, reviewable config" without changing the decision (§4.3.3). */
export function mergeApproval(
  ...layers: readonly (readonly ApprovalRule[] | undefined)[]
): readonly ApprovalRule[] {
  const merged: ApprovalRule[] = [];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    for (const rule of layers[index] ?? []) {
      const duplicate = merged.some(
        (candidate) =>
          candidate.match === rule.match &&
          candidate.mode === rule.mode &&
          candidate.initiatorOnly === rule.initiatorOnly,
      );
      if (!duplicate) merged.push(rule);
    }
  }
  return merged;
}

/** §4.3.6: when approval rules exist, a `match: "*"` fallback rule is required. */
export function requireStarFallback(
  path: readonly (string | number)[],
  rules: readonly ApprovalRule[],
): void {
  if (rules.length > 0 && !rules.some((rule) => rule.match === "*")) {
    issue(path, 'approval rules require a match: "*" fallback rule');
  }
}
