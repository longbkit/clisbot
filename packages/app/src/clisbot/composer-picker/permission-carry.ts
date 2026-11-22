import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import { resolveModeLabelKey } from "./mode-options";

/**
 * What a provider switch does with the session's permission (docs/features/bots-and-chats/README.md,
 * "Switching provider"). A person chose how much the session may do without asking; the new session
 * keeps that choice only where the target has a mode with the same rights, and never gets more on
 * its own. Visual groups (`mode-options.ts`) are not rights: Claude's Always ask, Codex's
 * workspace Default and OMP's Write approval share an icon but not a scope.
 *
 * The rule, in order:
 * 1. Clisbot's Full auto-accept stays Full auto-accept where the Host offers it. A provider's own
 *    no-prompt mode never becomes Full auto-accept.
 * 2. The same native mode id in the same provider family (a custom provider extending a built-in,
 *    or two providers of one family) is kept.
 * 3. Across families, only scopes with the same rights are matched: plan (`plan` in the families
 *    that have it, and ACP's standard plan mode), strict per-tool asking (`askEachTool`) and
 *    no-prompt (`noPrompt`: the catalog's bypass modes, or the provider's declared `isUnattended`
 *    mode). Every other known mode has rights of its own and matches only itself (rule 2).
 * 4. With no match, Full auto-accept falls to the no-prompt mode, then strict asking; a no-prompt
 *    mode falls to strict asking. These only ever take rights away.
 * 5. Otherwise the person picks in the review, with nothing preselected: plan without a plan,
 *    modes without a counterpart, a mode Clisbot does not know, no mode, a target without modes,
 *    or several target modes of one scope.
 */

export type PermissionScope = "plan" | "askEachTool" | "noPrompt" | "fullAutoAccept";

export type PermissionReason =
  | "equivalent"
  | "fullAutoToNoPrompt"
  | "toAskEachTool"
  | "planUnavailable"
  | "noEquivalent"
  | "ambiguous"
  | "unknownSource"
  | "noSourceMode"
  | "noModes";

const ACP_PLAN = "https://agentclientprotocol.com/protocol/session-modes#plan";

/** `family:modeId` pairs whose rights are comparable across families. */
const SCOPES: Record<string, PermissionScope> = {
  "claude:plan": "plan",
  "codex:plan": "plan",
  "opencode:plan": "plan",
  "claude:default": "askEachTool",
  "omp:ask": "askEachTool",
  "claude:bypassPermissions": "noPrompt",
  "codex:full-access": "noPrompt",
  "copilot:allow-all": "noPrompt",
  "omp:full": "noPrompt",
};

export function permissionScopeOf(
  family: string,
  mode: Pick<AgentMode, "id" | "isUnattended">,
): PermissionScope | null {
  if (mode.id === FULL_AUTO_ACCEPT_MODE_ID) return "fullAutoAccept";
  if (mode.id === ACP_PLAN) return "plan";
  return SCOPES[`${family}:${mode.id}`] ?? (mode.isUnattended === true ? "noPrompt" : null);
}

export interface PermissionOption {
  /** The mode to launch with; null is the provider's own default (a provider without modes). */
  modeId: string | null;
  label: string;
  /** The app's translated label key, for modes it names itself. */
  labelKey: ReturnType<typeof resolveModeLabelKey>;
  scope: PermissionScope | null;
}

export interface PermissionCarry {
  sourceScope: PermissionScope | null;
  options: PermissionOption[];
  /** The option the review starts on; undefined means the person must pick one. */
  selected: PermissionOption | undefined;
  reason: PermissionReason;
}

export interface PermissionCarryInput {
  /** The source provider's family (`resolveModeProvider`: a custom provider's base). */
  sourceFamily: string;
  /** The session's effective mode: Full auto-accept when it is on (`resolveComposerModeId`). */
  sourceModeId: string | null;
  sourceModes: readonly AgentMode[];
  targetFamily: string;
  /** The modes the Host reports for the target provider. */
  targetModes: readonly AgentMode[];
  /** The Host offers Clisbot's Full auto-accept. */
  fullAutoAcceptSupported: boolean;
}

function targetOptions(input: PermissionCarryInput): PermissionOption[] {
  const own = input.targetModes.filter((mode) => mode.id !== FULL_AUTO_ACCEPT_MODE_ID);
  const options: PermissionOption[] = own.map((mode) => ({
    modeId: mode.id,
    label: mode.label,
    labelKey: resolveModeLabelKey(input.targetFamily, mode.id),
    scope: permissionScopeOf(input.targetFamily, mode),
  }));
  if (input.fullAutoAcceptSupported && own.length > 0)
    options.push({
      modeId: FULL_AUTO_ACCEPT_MODE_ID,
      label: "Clisbot Full auto-accept",
      labelKey: "fullAutoAccept",
      scope: "fullAutoAccept",
    });
  return options;
}

const PROVIDER_DEFAULT: PermissionOption = {
  modeId: null,
  label: "Provider default",
  labelKey: null,
  scope: null,
};

/** The single option of the first scope the target has; several of one scope is ambiguous. */
function pick(options: PermissionOption[], ...scopes: PermissionScope[]) {
  for (const scope of scopes) {
    const matches = options.filter((entry) => entry.scope === scope);
    if (matches.length > 1) return "ambiguous" as const;
    if (matches[0]) return matches[0];
  }
  return undefined;
}

type Choice = Pick<PermissionCarry, "selected" | "reason">;

function chosen(found: PermissionOption | "ambiguous" | undefined, reason: PermissionReason) {
  if (found === "ambiguous") return { selected: undefined, reason: "ambiguous" } satisfies Choice;
  return found ? ({ selected: found, reason } satisfies Choice) : null;
}

/** Rule 4: only ever down to a mode with fewer rights. */
function fallback(scope: PermissionScope | null, options: PermissionOption[]): Choice {
  if (scope === "fullAutoAccept") {
    const noPrompt = chosen(pick(options, "noPrompt"), "fullAutoToNoPrompt");
    if (noPrompt) return noPrompt;
  }
  if (scope === "fullAutoAccept" || scope === "noPrompt") {
    const asking = chosen(pick(options, "askEachTool"), "toAskEachTool");
    if (asking) return asking;
  }
  return { selected: undefined, reason: scope === "plan" ? "planUnavailable" : "noEquivalent" };
}

function match(input: PermissionCarryInput, options: PermissionOption[]): Choice | null {
  const sourceId = input.sourceModeId;
  if (!sourceId) return null;
  if (sourceId === FULL_AUTO_ACCEPT_MODE_ID)
    return chosen(pick(options, "fullAutoAccept"), "equivalent");
  if (input.sourceFamily === input.targetFamily) {
    const same = options.find((option) => option.modeId === sourceId);
    if (same) return { selected: same, reason: "equivalent" };
  }
  const scope = permissionScopeOf(input.sourceFamily, sourceMode(input));
  return scope ? chosen(pick(options, scope), "equivalent") : null;
}

function sourceMode(input: PermissionCarryInput): Pick<AgentMode, "id" | "isUnattended"> {
  const id = input.sourceModeId ?? "";
  return input.sourceModes.find((mode) => mode.id === id) ?? { id };
}

export function resolvePermissionCarry(input: PermissionCarryInput): PermissionCarry {
  const sourceScope = input.sourceModeId
    ? permissionScopeOf(input.sourceFamily, sourceMode(input))
    : null;
  const options = targetOptions(input);
  if (options.length === 0)
    return { sourceScope, options: [PROVIDER_DEFAULT], selected: undefined, reason: "noModes" };
  const exact = match(input, options);
  if (exact) return { sourceScope, options, ...exact };
  if (!input.sourceModeId)
    return { sourceScope, options, selected: undefined, reason: "noSourceMode" };
  if (!sourceScope && !knownInFamily(input))
    return { sourceScope, options, selected: undefined, reason: "unknownSource" };
  return { sourceScope, options, ...fallback(sourceScope, options) };
}

/** A mode the app names in its own catalog: its rights are known even if they match nothing. */
function knownInFamily(input: PermissionCarryInput): boolean {
  return resolveModeLabelKey(input.sourceFamily, input.sourceModeId ?? "") !== null;
}
