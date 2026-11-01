import { describe, expect, it } from "vitest";
import type { AgentFeature, AgentMode, AgentSelectOption } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import { normalizeComposerOptions, type ComposerOptionsInput } from "./normalize";

/**
 * One case per provider, with modes, efforts and features shaped as each provider's daemon
 * adapter delivers them (after `provider-modes.ts` marks the no-prompt mode). The source of
 * each fixture is named beside it.
 */
const COPILOT = "https://agentclientprotocol.com/protocol/session-modes#";

function mode(id: string, extra: Partial<AgentMode> = {}): AgentMode {
  return { id, label: id, ...extra };
}
function efforts(
  ids: string[],
  defaultId?: string,
): { thinkingOptions: AgentSelectOption[]; defaultThinkingOptionId?: string } {
  return {
    thinkingOptions: ids.map((id) => ({ id, label: id })),
    defaultThinkingOptionId: defaultId,
  };
}
const fastToggle = (value = false): AgentFeature => ({
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  value,
});
const autoAccept: AgentFeature = {
  type: "toggle",
  id: "auto_accept",
  label: "Auto Accept",
  value: false,
};
function select(
  id: string,
  value: string,
  options: Array<[string, string, boolean?]>,
): AgentFeature {
  return {
    type: "select",
    id,
    label: id,
    value,
    options: options.map(([optionId, label, isDefault]) => ({
      id: optionId,
      label,
      ...(isDefault ? { isDefault } : {}),
    })),
  };
}

const CLAUDE_MODES = [
  mode("plan", { colorTier: "planning" }),
  mode("default", { colorTier: "safe" }),
  mode("acceptEdits", { colorTier: "moderate" }),
  mode("auto", { colorTier: "moderate" }),
  mode("bypassPermissions", { colorTier: "dangerous", isUnattended: true }),
];
const CODEX_MODES = [
  mode("auto", { colorTier: "moderate" }),
  mode("auto-review", { colorTier: "moderate" }),
  mode("full-access", { colorTier: "dangerous", isUnattended: true }),
];
const CODEX_TIERS = select("service_tier", "default", [
  ["default", "Normal", true],
  ["priority", "Fast"],
  ["ultrafast", "Ultrafast"],
]);

interface Case {
  name: string;
  input: Omit<ComposerOptionsInput, "fullAutoAcceptSupported" | "currentModeId"> & {
    currentModeId?: string;
  };
  modes: string[];
  plan: string | null;
  runsOn: string | null;
  reasoning: string[];
  defaultEffort?: string;
  /** The speed control as level key → the value it writes. */
  speed: { featureId: string; levels: Record<string, unknown> } | null;
  more: string[];
}

const CASES: Case[] = [
  {
    // claude/agent.ts DEFAULT_MODES, claude/model-manifest.ts, claude/feature-definitions.ts
    name: "Claude (Anthropic API, Opus with Fast)",
    input: {
      provider: "claude",
      modes: CLAUDE_MODES,
      model: efforts(["low", "medium", "high", "max"], "high"),
      features: [fastToggle()],
    },
    modes: ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
    plan: "plan",
    runsOn: "bypassPermissions",
    reasoning: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    speed: { featureId: "fast_mode", levels: { standard: false, fast: true } },
    more: [],
  },
  {
    name: "Claude on Bedrock or Vertex (no Auto mode, no Fast)",
    input: {
      provider: "claude",
      modes: CLAUDE_MODES.filter((entry) => entry.id !== "auto"),
      model: efforts(["low", "high"], "high"),
      features: [],
    },
    modes: ["plan", "default", "acceptEdits", "bypassPermissions"],
    plan: "plan",
    runsOn: "bypassPermissions",
    reasoning: ["low", "high"],
    defaultEffort: "high",
    speed: null,
    more: [],
  },
  {
    name: "Claude Haiku (no effort)",
    input: {
      provider: "claude",
      modes: CLAUDE_MODES,
      model: { thinkingOptions: [] },
      features: [],
    },
    modes: ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
    plan: "plan",
    runsOn: "bypassPermissions",
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    // codex-app-server-agent.ts codexModeList + codex-feature-definitions.ts
    name: "Codex with Plan and service tiers",
    input: {
      provider: "codex",
      modes: [mode("plan", { colorTier: "planning" }), ...CODEX_MODES],
      model: efforts(["low", "medium", "high", "xhigh"], "medium"),
      features: [CODEX_TIERS],
    },
    modes: ["plan", "auto", "auto-review", "full-access"],
    plan: "plan",
    runsOn: "full-access",
    reasoning: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    speed: {
      featureId: "service_tier",
      levels: { standard: "default", fast: "priority", ultra: "ultrafast" },
    },
    more: [],
  },
  {
    name: "Codex without a plan collaboration mode or tiers (older Codex, no collaborationMode/list)",
    input: {
      provider: "codex",
      modes: CODEX_MODES,
      model: efforts(["medium"], "medium"),
      features: [],
    },
    modes: ["auto", "auto-review", "full-access"],
    plan: null,
    runsOn: "full-access",
    reasoning: ["medium"],
    defaultEffort: "medium",
    speed: null,
    more: [],
  },
  {
    // An older daemon still sends plan_mode; this app leaves it in More rather than lose it.
    name: "Codex on an older daemon (plan_mode feature)",
    input: {
      provider: "codex",
      modes: CODEX_MODES,
      model: null,
      features: [{ type: "toggle", id: "plan_mode", label: "Plan", value: false }],
    },
    modes: ["auto", "auto-review", "full-access"],
    plan: null,
    runsOn: "full-access",
    reasoning: [],
    speed: null,
    more: ["plan_mode"],
  },
  {
    // copilot-acp-agent.ts, provider-manifest.ts COPILOT_MODES, ACP thought_level, agent select
    name: "Copilot (ACP)",
    input: {
      provider: "copilot",
      modes: [
        mode(`${COPILOT}agent`, { colorTier: "moderate" }),
        mode(`${COPILOT}plan`, { colorTier: "planning" }),
        mode("allow-all", { colorTier: "dangerous", isUnattended: true }),
      ],
      currentModeId: `${COPILOT}agent`,
      model: efforts(["low", "medium", "high"], "medium"),
      features: [
        autoAccept,
        select("agent", "", [
          ["", "Copilot", true],
          ["reviewer", "Reviewer"],
        ]),
      ],
    },
    modes: [`${COPILOT}agent`, `${COPILOT}plan`, "allow-all"],
    plan: `${COPILOT}plan`,
    runsOn: "allow-all",
    reasoning: ["low", "medium", "high"],
    defaultEffort: "medium",
    speed: null,
    more: ["agent"],
  },
  {
    // opencode-agent.ts runtime agents (v1) and opencode/v2/configuration.ts (v2)
    name: "OpenCode v1 (runtime agents, auto_accept)",
    input: {
      provider: "opencode",
      modes: [
        mode("build", { colorTier: "moderate" }),
        mode("plan", { colorTier: "planning" }),
        mode("orchestrator"),
      ],
      currentModeId: "build",
      model: efforts(["high", "max"]),
      features: [autoAccept],
    },
    modes: ["build", "plan", "orchestrator"],
    plan: "plan",
    runsOn: "build",
    reasoning: ["high", "max"],
    speed: null,
    more: [],
  },
  {
    name: "OpenCode v2 (Build and Plan)",
    input: {
      provider: "opencode",
      modes: [mode("build"), mode("plan")],
      currentModeId: "plan",
      model: null,
      features: [autoAccept],
    },
    modes: ["build", "plan"],
    plan: "plan",
    runsOn: "plan",
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    name: "Pi (no modes)",
    input: { provider: "pi", modes: [], model: efforts(["off", "low", "high"]), features: [] },
    modes: [],
    plan: null,
    runsOn: null,
    reasoning: ["off", "low", "high"],
    speed: null,
    more: [],
  },
  {
    // provider-manifest.ts OMP_MODES; omp/agent.ts fast_mode on a running session only
    name: "Oh My Pi, running",
    input: {
      provider: "omp",
      modes: [
        mode("full", { colorTier: "dangerous", isUnattended: true }),
        mode("write"),
        mode("ask"),
      ],
      currentModeId: "write",
      model: null,
      features: [fastToggle(true)],
    },
    modes: ["full", "write", "ask"],
    plan: null,
    runsOn: "full",
    reasoning: [],
    speed: { featureId: "fast_mode", levels: { standard: false, fast: true } },
    more: [],
  },
  {
    name: "Oh My Pi, draft (no Fast before it runs)",
    input: {
      provider: "omp",
      modes: [mode("full", { isUnattended: true }), mode("write"), mode("ask")],
      model: null,
      features: [],
    },
    modes: ["full", "write", "ask"],
    plan: null,
    runsOn: "full",
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    // plugins/antigravity-provider/server/internal/catalog.ts
    name: "Antigravity (one Full access mode, no effort)",
    input: {
      provider: "antigravity",
      modes: [mode("full-access", { colorTier: "dangerous", isUnattended: true })],
      model: { thinkingOptions: [] },
      features: [],
    },
    modes: ["full-access"],
    plan: null,
    runsOn: "full-access",
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    // plugins/muse-provider/server/catalog.ts
    name: "Muse Code",
    input: {
      provider: "muse",
      modes: [
        mode("onRequest", { colorTier: "safe" }),
        mode("promptUnmatched"),
        mode("denyUnmatched"),
        mode("allowAll", { colorTier: "dangerous", isUnattended: true }),
      ],
      model: efforts(["low", "medium", "high"], "medium"),
      features: [],
    },
    modes: ["onRequest", "promptUnmatched", "denyUnmatched", "allowAll"],
    plan: null,
    runsOn: "allowAll",
    reasoning: ["low", "medium", "high"],
    defaultEffort: "medium",
    speed: null,
    more: [],
  },
  {
    // generic-acp-agent.ts: modes and thought_level from session/new, extra config options
    name: "Generic ACP (Gemini CLI, Qwen, Kiro style)",
    input: {
      provider: "gemini",
      modes: [mode("default"), mode("autoEdit"), mode("yolo")],
      currentModeId: "default",
      model: efforts(["low", "high"]),
      features: [
        autoAccept,
        select("sandbox", "off", [
          ["off", "Off"],
          ["on", "On"],
        ]),
      ],
    },
    modes: ["default", "autoEdit", "yolo"],
    plan: null,
    runsOn: "default",
    reasoning: ["low", "high"],
    speed: null,
    more: ["sandbox"],
  },
  {
    // cursor-acp-agent.ts: per-model thought_level and CURSOR_FAST_FEATURE_OPTION
    name: "Cursor (ACP)",
    input: {
      provider: "cursor",
      modes: [mode("agent"), mode("plan"), mode("ask")],
      currentModeId: "agent",
      model: efforts(["low", "medium", "high"], "medium"),
      features: [
        autoAccept,
        select("fast", "false", [
          ["false", "Off"],
          ["true", "On"],
        ]),
      ],
    },
    modes: ["agent", "plan", "ask"],
    plan: "plan",
    runsOn: "agent",
    reasoning: ["low", "medium", "high"],
    defaultEffort: "medium",
    speed: { featureId: "fast", levels: { standard: "false", fast: "true" } },
    more: [],
  },
  {
    // kimi-acp-agent.ts
    name: "Kimi (ACP)",
    input: {
      provider: "kimi",
      modes: [mode("default"), mode("plan")],
      currentModeId: "default",
      model: null,
      features: [autoAccept],
    },
    modes: ["default", "plan"],
    plan: "plan",
    runsOn: "default",
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    // plugins/hoplite-provider: an ACP bridge with no modes of its own
    name: "Hoplite (plugin ACP)",
    input: { provider: "hoplite", modes: [], model: null, features: [autoAccept] },
    modes: [],
    plan: null,
    runsOn: null,
    reasoning: [],
    speed: null,
    more: [],
  },
  {
    // A custom provider `extends: "claude"` inherits Claude's manifest modes on the daemon.
    name: "Custom provider extending Claude",
    input: {
      provider: "work-claude",
      modes: CLAUDE_MODES,
      model: efforts(["high"], "high"),
      features: [],
    },
    modes: ["plan", "default", "acceptEdits", "auto", "bypassPermissions"],
    plan: "plan",
    runsOn: "bypassPermissions",
    reasoning: ["high"],
    defaultEffort: "high",
    speed: null,
    more: [],
  },
  {
    name: "Custom provider extending ACP",
    input: {
      provider: "my-acp",
      modes: [mode("ask"), mode("yolo", { colorTier: "dangerous" })],
      currentModeId: "ask",
      model: null,
      features: [autoAccept],
    },
    modes: ["ask", "yolo"],
    plan: null,
    runsOn: "ask",
    reasoning: [],
    speed: null,
    more: [],
  },
];

describe("normalized composer options, per provider", () => {
  it.each(CASES)("$name", (entry) => {
    const options = normalizeComposerOptions({
      ...entry.input,
      currentModeId: entry.input.currentModeId ?? entry.input.modes[0]?.id ?? null,
      fullAutoAcceptSupported: true,
    });
    const fullAuto = entry.modes.length > 0 ? [FULL_AUTO_ACCEPT_MODE_ID] : [];
    expect(options.modes.map((item) => item.id)).toEqual([...entry.modes, ...fullAuto]);
    expect(options.planModeId).toBe(entry.plan);
    expect(options.fullAutoAcceptRunsOn).toBe(entry.runsOn);
    expect(options.reasoning.options.map((item) => item.id)).toEqual(entry.reasoning);
    expect(options.reasoning.defaultId).toBe(entry.defaultEffort);
    expect(
      options.speed && {
        featureId: options.speed.featureId,
        levels: Object.fromEntries(options.speed.options.map((item) => [item.key, item.value])),
      },
    ).toEqual(entry.speed);
    expect(options.more.map((feature) => feature.id)).toEqual(entry.more);
  });

  it.each(CASES)(
    "$name on an older Host keeps the provider's own list and auto_accept",
    (entry) => {
      const options = normalizeComposerOptions({
        ...entry.input,
        currentModeId: entry.input.currentModeId ?? null,
        fullAutoAcceptSupported: false,
      });
      expect(options.modes.map((item) => item.id)).toEqual(entry.modes);
      const hasAutoAccept = entry.input.features.some((feature) => feature.id === "auto_accept");
      expect(options.more.some((feature) => feature.id === "auto_accept")).toBe(hasAutoAccept);
    },
  );

  it("shows Full auto-accept as the current mode while the agent runs it", () => {
    const options = normalizeComposerOptions({
      provider: "claude",
      modes: CLAUDE_MODES,
      currentModeId: "bypassPermissions",
      fullAutoAccept: true,
      fullAutoAcceptSupported: true,
      model: null,
      features: [],
    });
    expect(options.selectedModeId).toBe(FULL_AUTO_ACCEPT_MODE_ID);
  });
});
