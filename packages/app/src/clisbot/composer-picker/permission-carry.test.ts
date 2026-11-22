import { describe, expect, test } from "vitest";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@clisbot/protocol/provider-manifest";
import {
  permissionScopeOf,
  resolvePermissionCarry,
  type PermissionCarry,
  type PermissionScope,
} from "./permission-carry";

/**
 * Every provider the catalog can present, as a Host reports it: each built-in and dev definition
 * (Codex with and without its offered Plan), a custom provider extending a built-in, a dynamic
 * ACP provider whose modes Clisbot does not know, a provider without modes, and one that only
 * offers its no-prompt mode.
 */
interface CatalogProvider {
  id: string;
  family: string;
  modes: AgentMode[];
}

const strip = (modes: readonly AgentMode[]): AgentMode[] =>
  modes.map(({ id, label, isUnattended, colorTier }) => ({
    id,
    label,
    ...(isUnattended ? { isUnattended } : {}),
    ...(colorTier ? { colorTier } : {}),
  }));

const BUILT_INS: CatalogProvider[] = [
  ...AGENT_PROVIDER_DEFINITIONS,
  ...DEV_AGENT_PROVIDER_DEFINITIONS,
]
  .filter((definition, index, all) => all.findIndex((d) => d.id === definition.id) === index)
  .map((definition) => ({
    id: definition.id,
    family: definition.id,
    modes: strip(definition.modes),
  }));

const CODEX = BUILT_INS.find((provider) => provider.id === "codex")!;
const CLAUDE = BUILT_INS.find((provider) => provider.id === "claude")!;
const OMP = BUILT_INS.find((provider) => provider.id === "omp")!;

const CATALOG: CatalogProvider[] = [
  ...BUILT_INS,
  {
    id: "codex (no Plan offered)",
    family: "codex",
    modes: CODEX.modes.filter((m) => m.id !== "plan"),
  },
  { id: "my-claude (extends claude)", family: "claude", modes: CLAUDE.modes },
  // Two OMP-based providers whose ask and write come in either order.
  { id: "omp-a (extends omp)", family: "omp", modes: OMP.modes },
  { id: "omp-b (extends omp, reversed)", family: "omp", modes: OMP.modes.toReversed() },
  {
    id: "acp-dynamic",
    family: "acp-dynamic",
    modes: [
      { id: "careful", label: "Always ask", colorTier: "safe" },
      { id: "foo#plan", label: "Plan", colorTier: "planning" },
      { id: "https://example.com/modes#plan", label: "Plan" },
      { id: "yolo", label: "Bypass", colorTier: "dangerous" },
      { id: "unattended", label: "Unattended", isUnattended: true },
    ],
  },
  {
    id: "acp-standard",
    family: "acp-standard",
    modes: [
      { id: "https://agentclientprotocol.com/protocol/session-modes#plan", label: "Plan" },
      { id: "work", label: "Work" },
    ],
  },
  { id: "no-modes", family: "no-modes", modes: [] },
  {
    id: "unattended-only",
    family: "unattended-only",
    modes: [{ id: "run", label: "Run", isUnattended: true }],
  },
];

const RANK: Record<PermissionScope, number> = {
  plan: 0,
  askEachTool: 1,
  noPrompt: 2,
  fullAutoAccept: 3,
};

function sourceModesOf(provider: CatalogProvider): (string | null)[] {
  return [...provider.modes.map((mode) => mode.id), FULL_AUTO_ACCEPT_MODE_ID, null];
}

function carry(source: CatalogProvider, modeId: string | null, target: CatalogProvider, fa = true) {
  return resolvePermissionCarry({
    sourceFamily: source.family,
    sourceModeId: modeId,
    sourceModes: source.modes,
    targetFamily: target.family,
    targetModes: target.modes,
    fullAutoAcceptSupported: fa,
  });
}

function everyCase(fa: boolean) {
  const cases: {
    source: CatalogProvider;
    modeId: string | null;
    target: CatalogProvider;
    result: PermissionCarry;
  }[] = [];
  for (const source of CATALOG)
    for (const modeId of sourceModesOf(source))
      for (const target of CATALOG)
        if (target.id !== source.id)
          cases.push({ source, modeId, target, result: carry(source, modeId, target, fa) });
  return cases;
}

const shown = (result: PermissionCarry) =>
  result.selected ? (result.selected.modeId ?? "provider default") : "— choose —";

describe("permission carry over the whole catalog", () => {
  for (const fa of [true, false]) {
    test(`never broadens and never guesses (Full auto-accept on the Host: ${fa})`, () => {
      const cases = everyCase(fa);
      expect(cases.length).toBeGreaterThan(500);
      for (const { source, modeId, target, result } of cases) {
        const where = `${source.id}:${modeId} → ${target.id}`;
        const selected = result.selected;
        // Every offered option is a mode the Host reports, or Full auto-accept where offered.
        for (const option of result.options) {
          if (option.modeId === FULL_AUTO_ACCEPT_MODE_ID) expect(fa, where).toBe(true);
          else if (option.modeId !== null)
            expect(
              target.modes.map((m) => m.id),
              where,
            ).toContain(option.modeId);
        }
        if (!selected) {
          expect(result.reason, where).not.toBe("equivalent");
          continue;
        }
        // Full auto-accept only ever comes from Full auto-accept.
        if (selected.scope === "fullAutoAccept")
          expect(modeId, where).toBe(FULL_AUTO_ACCEPT_MODE_ID);
        if (result.reason === "equivalent") {
          // The same native mode in one family, or the same comparable scope.
          const sameNative = source.family === target.family && selected.modeId === modeId;
          if (!sameNative) {
            expect(selected.scope, where).not.toBeNull();
            expect(selected.scope, where).toBe(result.sourceScope);
          }
          continue;
        }
        // A fallback only ever takes rights away, to a mode whose rights are known.
        expect(selected.scope, where).not.toBeNull();
        expect(RANK[selected.scope!], where).toBeLessThan(RANK[result.sourceScope!]);
      }
    });
  }

  test("labels, colours, icons and id suffixes never give a mode rights", () => {
    const acp = CATALOG.find((p) => p.id === "acp-dynamic")!;
    expect(acp.modes.map((mode) => permissionScopeOf(acp.family, mode))).toEqual([
      null,
      null,
      null,
      null,
      "noPrompt",
    ]);
    const mockSlow = BUILT_INS.find((p) => p.id === "mock-slow");
    if (mockSlow) expect(permissionScopeOf("mock-slow", mockSlow.modes[0]!)).toBeNull();
    // Visual "ask" peers have different rights: only Claude Always ask and OMP Always ask are strict.
    expect(permissionScopeOf("claude", { id: "default" })).toBe("askEachTool");
    expect(permissionScopeOf("omp", { id: "ask" })).toBe("askEachTool");
    expect(permissionScopeOf("omp", { id: "write" })).toBeNull();
    expect(permissionScopeOf("codex", { id: "auto" })).toBeNull();
    expect(permissionScopeOf("opencode", { id: "build" })).toBeNull();
  });

  test("the carry table for every provider pair", () => {
    const lines = ["| From | Mode | To | Starts in | Why |", "| --- | --- | --- | --- | --- |"];
    for (const { source, modeId, target, result } of everyCase(true))
      lines.push(
        `| ${source.id} | ${modeId ?? "(none)"} | ${target.id} | ${shown(result)} | ${result.reason} |`,
      );
    expect(lines.join("\n")).toMatchSnapshot();
  });
});

describe("permission carry, the cases people meet", () => {
  const byId = (id: string) => CATALOG.find((provider) => provider.id === id)!;
  const cases: [string, string | null, string, string | undefined, string][] = [
    // Codex Full Access is a no-prompt mode: Claude's no-prompt mode, never Full auto-accept.
    ["codex", "full-access", "claude", "bypassPermissions", "equivalent"],
    ["claude", "bypassPermissions", "codex", "full-access", "equivalent"],
    // Clisbot's Full auto-accept is kept as itself.
    ["claude", FULL_AUTO_ACCEPT_MODE_ID, "codex", FULL_AUTO_ACCEPT_MODE_ID, "equivalent"],
    ["codex", FULL_AUTO_ACCEPT_MODE_ID, "claude", FULL_AUTO_ACCEPT_MODE_ID, "equivalent"],
    // Strict per-tool asking is not Codex's workspace Default; the reverse neither.
    ["claude", "default", "codex", undefined, "noEquivalent"],
    ["codex", "auto", "claude", undefined, "noEquivalent"],
    // Classifier and auto-review differ in sandbox and reviewer: the person picks.
    ["claude", "auto", "codex", undefined, "noEquivalent"],
    ["codex", "auto-review", "claude", undefined, "noEquivalent"],
    ["claude", "acceptEdits", "codex", undefined, "noEquivalent"],
    // Strict asking keeps strict asking on OMP, whichever order its modes come in; never Write.
    ["claude", "default", "omp", "ask", "equivalent"],
    ["claude", "default", "omp-b (extends omp, reversed)", "ask", "equivalent"],
    ["omp", "ask", "claude", "default", "equivalent"],
    ["omp", "write", "claude", undefined, "noEquivalent"],
    // Within one family the native mode itself is kept, whatever it is.
    ["omp-a (extends omp)", "write", "omp-b (extends omp, reversed)", "write", "equivalent"],
    ["codex", "auto", "codex (no Plan offered)", "auto", "equivalent"],
    ["my-claude (extends claude)", "acceptEdits", "claude", "acceptEdits", "equivalent"],
    ["codex", "full-access", "my-claude (extends claude)", "bypassPermissions", "equivalent"],
    // Plan stays plan where the target offers it, else the person picks; no suffix guesses.
    ["claude", "plan", "codex", "plan", "equivalent"],
    ["claude", "plan", "codex (no Plan offered)", undefined, "planUnavailable"],
    ["claude", "plan", "omp", undefined, "planUnavailable"],
    ["claude", "plan", "acp-dynamic", undefined, "planUnavailable"],
    ["acp-dynamic", "foo#plan", "claude", undefined, "unknownSource"],
    [
      "copilot",
      "https://agentclientprotocol.com/protocol/session-modes#plan",
      "acp-standard",
      "https://agentclientprotocol.com/protocol/session-modes#plan",
      "equivalent",
    ],
    // No-prompt drops to strict asking, never to a mode of unknown strictness like Build.
    ["codex", "full-access", "opencode", undefined, "noEquivalent"],
    ["codex", "full-access", "omp", "full", "equivalent"],
    // Unknown modes, no mode, no modes, only broader: the person picks.
    ["acp-dynamic", "yolo", "claude", undefined, "unknownSource"],
    ["acp-dynamic", "unattended", "claude", "bypassPermissions", "equivalent"],
    ["claude", null, "codex", undefined, "noSourceMode"],
    ["claude", "default", "no-modes", undefined, "noModes"],
    ["claude", "default", "unattended-only", undefined, "noEquivalent"],
    ["claude", "default", "acp-dynamic", undefined, "noEquivalent"],
  ];
  for (const [from, mode, to, startsIn, reason] of cases) {
    test(`${from}:${mode} → ${to}`, () => {
      const result = carry(byId(from), mode, byId(to));
      expect(result.selected?.modeId).toBe(startsIn);
      expect(result.reason).toBe(reason);
    });
  }

  test("Full auto-accept on a Host without it: the no-prompt mode, else strict asking", () => {
    expect(carry(byId("claude"), FULL_AUTO_ACCEPT_MODE_ID, byId("codex"), false)).toMatchObject({
      selected: { modeId: "full-access" },
      reason: "fullAutoToNoPrompt",
    });
    const noNoPrompt = {
      id: "strict",
      family: "claude",
      modes: CLAUDE.modes.filter((m) => !m.isUnattended),
    };
    expect(carry(byId("codex"), FULL_AUTO_ACCEPT_MODE_ID, noNoPrompt, false)).toMatchObject({
      selected: { modeId: "default" },
      reason: "toAskEachTool",
    });
    expect(carry(byId("claude"), FULL_AUTO_ACCEPT_MODE_ID, byId("opencode"), false)).toMatchObject({
      selected: undefined,
      reason: "noEquivalent",
    });
  });

  test("a provider without modes offers only its own default, to be chosen explicitly", () => {
    const result = carry(byId("codex"), "full-access", byId("no-modes"));
    expect(result.options).toEqual([
      { modeId: null, label: "Provider default", labelKey: null, scope: null },
    ]);
    expect(result.selected).toBeUndefined();
  });
});
